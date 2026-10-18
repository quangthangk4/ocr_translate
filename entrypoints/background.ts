import { defineBackground } from 'wxt/utils/define-background';
import { AppError, failure } from '../src/errors';
import { isOcrMethod, methodCatalog, normalizeSettings } from '../src/methods/catalog';
import { requestWindowsOcr, validateWindowsRequest } from '../src/native/windows-client';
import { RecordStore, validAnchor } from '../src/records';
import type { ActiveJob, BackgroundMessage, OffscreenMessage, PageMessage } from '../src/protocol';
import type { PageIdentity, Settings, TranslationRecord } from '../src/types';
import { STALE_JOB_MS } from '../src/limits';

interface Reader { owner: PageIdentity; pageUrl: string }
export default defineBackground(() => {
  const store = new RecordStore();
  const ready = Promise.all([
    chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
    chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
  ]).then(() => store.initialize());
  let queue: Promise<unknown> = Promise.resolve(), creating: Promise<void> | undefined;
  let lastCaptureTime = 0;
  const nativeJobs = new Map<string, AbortController>();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => { const next = queue.then(async () => { await ready; return fn(); }); queue = next.catch(() => {}); return next; };
  const settings = async () => normalizeSettings((await chrome.storage.local.get('settings')).settings);
  const active = async () => (await chrome.storage.session.get<{ active?: ActiveJob }>('active')).active;
  const readers = async () => (await chrome.storage.session.get<{ readers?: Reader[] }>('readers')).readers ?? [];
  const same = (a?: PageIdentity, b?: PageIdentity) => !!a && !!b && a.tabId === b.tabId && a.documentId === b.documentId;
  const page = (owner: PageIdentity, message: PageMessage) => chrome.tabs.sendMessage(owner.tabId, message, { documentId: owner.documentId });
  async function offscreen(message: OffscreenMessage) {
    const url = chrome.runtime.getURL('/offscreen.html');
    if (!(await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] })).length) {
      creating ??= chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: [chrome.offscreen.Reason.BLOBS, chrome.offscreen.Reason.WORKERS], justification: 'Cắt ảnh bằng Blob/canvas, chạy OCR cục bộ bằng Web Worker hoặc gọi dịch vụ dịch.' }).finally(() => { creating = undefined; });
      await creating;
    }
    if (!(await chrome.runtime.sendMessage(message))?.ok) throw new AppError('BUSY');
  }
  async function broadcast() {
    for (const reader of await readers()) await page(reader.owner, { target: 'page', type: 'RECORDS', records: await store.page(reader.pageUrl) }).catch(() => {});
  }
  async function cancel(job: ActiveJob, notify = true) {
    nativeJobs.get(job.id)?.abort();
    // Invalidate first: DONE from an aborted job must never restore a removed record.
    if ((await active())?.id === job.id) await chrome.storage.session.remove('active');
    if (job.phase === 'test') await chrome.storage.session.set({ testStatus: { id: job.id, state: 'done', outcome: { error: failure(new AppError('CANCELLED')) } } });
    if ((await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length) {
      await chrome.runtime.sendMessage({ target: 'offscreen', type: 'CANCEL', jobId: job.id }).catch(() => {});
    }
    if (notify && job.owner) await page(job.owner, { target: 'page', type: 'CANCELLED', jobId: job.id }).catch(() => {});
  }
  function validate(config: Settings) {
    const method = methodCatalog.find(m => m.id === config.methodId); if (!method) throw new AppError('CONFIG');
    const missing = method.fields.find(f => !config.methods[method.id]?.[f.key]?.trim());
    if (missing) throw new AppError('CONFIG', `Chưa điền ${missing.label}. Hãy mở cài đặt và nhập hoặc chọn trường này.`);
    if (method.sourceLanguages && !method.sourceLanguages.includes(config.sourceLang)) throw new AppError('CONFIG', 'OCR cục bộ hiện hỗ trợ tiếng Anh. Hãy chọn ngôn ngữ nguồn là Tiếng Anh.');
  }
  async function idle() {
    const job = await active(); if (!job) return;
    if (job.phase !== 'selecting' && Date.now() - job.startedAt > STALE_JOB_MS) await cancel(job);
    else throw new AppError('BUSY');
  }
  async function inject(): Promise<Reader> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url || !/^https?:\/\//.test(tab.url)) throw new AppError('UNSUPPORTED');
    let documentId: string | undefined;
    try { documentId = (await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content-scripts/translator.js'] }))[0]?.documentId; }
    catch { throw new AppError('UNSUPPORTED'); }
    if (!documentId) throw new AppError('INVALID_CAPTURE');
    const reader = { owner: { tabId: tab.id, documentId }, pageUrl: tab.url };
    await chrome.storage.session.set({ readers: [...(await readers()).filter(r => r.owner.tabId !== tab.id), reader] });
    await page(reader.owner, { target: 'page', type: 'RECORDS', records: await store.page(reader.pageUrl) });
    return reader;
  }
  async function begin(reader: Reader, mode: 'region' | 'viewport' | 'saved', operation: 'translate' | 'rebind', record?: TranslationRecord) {
    await idle(); const config = await settings();
    // Re-extracting an OCR card must not unexpectedly send its image to Gemini.
    if (operation === 'translate' && record && isOcrMethod(record.methodId)) { config.methodId = record.methodId; config.sourceLang = record.sourceLang; }
    if (isOcrMethod(config.methodId)) config.mode = 'quick';
    if (operation === 'translate') validate(config);
    const job: ActiveJob = {
      id: crypto.randomUUID(), recordId: record?.id ?? crypto.randomUUID(), owner: reader.owner, pageUrl: reader.pageUrl,
      generation: await store.generation(), phase: 'selecting', operation, startedAt: Date.now(), settings: config,
    };
    await chrome.storage.session.set({ active: job });
    try { await page(reader.owner, { target: 'page', type: 'BEGIN', jobId: job.id, recordId: job.recordId, mode, operation, anchor: record?.anchor, methodId: config.methodId }); }
    catch { await cancel(job); throw new AppError('INVALID_CAPTURE'); }
  }
  async function dispatch(message: BackgroundMessage, sender: chrome.runtime.MessageSender): Promise<unknown> {
    if (sender.id !== chrome.runtime.id) throw new AppError('UNSUPPORTED');
    const internal = !!sender.url?.startsWith(chrome.runtime.getURL('/'));
    const fromOffscreen = sender.url === chrome.runtime.getURL('/offscreen.html');
    const owner = sender.tab?.id !== undefined && sender.frameId === 0 && sender.documentId ? { tabId: sender.tab.id, documentId: sender.documentId } : undefined;
    const reader = (await readers()).find(r => same(r.owner, owner));
    if (message.type === 'DONE') {
      if (!fromOffscreen) throw new AppError('UNSUPPORTED');
      const job = await active(); if (!job || job.id !== message.jobId) return;
      await chrome.storage.session.remove('active');
      if (job.phase === 'test') { await chrome.storage.session.set({ testStatus: { id: job.id, state: 'done', outcome: message.outcome } }); return; }
      let record: TranslationRecord | undefined;
      if ('result' in message.outcome && job.anchor && job.settings) {
        const previous = await store.get(job.recordId), config = job.settings;
        record = {
          version: 2, id: job.recordId, pageUrl: job.pageUrl, anchor: job.anchor,
          methodId: config.methodId, model: config.methods[config.methodId].model ?? '', sourceLang: config.sourceLang, targetLang: config.targetLang, mode: config.mode,
          promptVersion: methodCatalog.find(m => m.id === config.methodId)!.promptVersion,
          result: message.outcome.result, createdAt: previous?.createdAt ?? Date.now(), updatedAt: Date.now(),
        };
        try { await store.put(record, job.generation); }
        catch { record.result.warnings.push('Bản dịch đang hiển thị nhưng chưa lưu được. Hãy kiểm tra dung lượng trong cài đặt.'); }
        await broadcast();
      }
      if (job.owner) await page(job.owner, { target: 'page', type: 'COMPLETE', jobId: job.id, recordId: job.recordId, record, outcome: message.outcome }).catch(() => {});
      return;
    }
    if (fromOffscreen) throw new AppError('UNSUPPORTED');
    if (['GET_SETTINGS', 'SAVE_SETTINGS', 'START', 'TEST', 'STATS', 'CLEAR_ALL'].includes(message.type) && !internal) throw new AppError('UNSUPPORTED');
    if (message.type === 'GET_SETTINGS') return settings();
    if (message.type === 'SAVE_SETTINGS') { const config = normalizeSettings(message.settings); await chrome.storage.local.set({ settings: config }); return config; }
    if (message.type === 'OPEN_OPTIONS') { await chrome.runtime.openOptionsPage(); return; }
    if (message.type === 'STATS') return store.stats();
    if (message.type === 'RESTORE') {
      const current = internal ? await inject() : reader;
      if (!current) throw new AppError('UNSUPPORTED');
      const records = await store.page(current.pageUrl); await page(current.owner, { target: 'page', type: 'RECORDS', records, reveal: true }); return { count: records.length };
    }
    if (message.type === 'CLEAR_ALL' || message.type === 'CLEAR_PAGE') {
      if (!internal && !reader) throw new AppError('UNSUPPORTED');
      const pageUrl = message.type === 'CLEAR_PAGE' ? internal ? message.pageUrl : reader!.pageUrl : undefined;
      if (message.type === 'CLEAR_PAGE' && !pageUrl) throw new AppError('CONFIG');
      const job = await active(); if (job && (!pageUrl || job.pageUrl === pageUrl)) await cancel(job);
      await store.clear(pageUrl); await broadcast(); return store.stats();
    }
    if (message.type === 'START') {
      await idle(); const config = await settings();
      if (methodCatalog.some(m => m.id === message.methodId)) config.methodId = message.methodId;
      const selected = methodCatalog.find(m => m.id === config.methodId)!;
      if (selected.sourceLanguages && !selected.sourceLanguages.includes(config.sourceLang)) config.sourceLang = selected.sourceLanguages[0];
      if (message.translationMode) config.mode = message.translationMode === 'quick' ? 'quick' : 'learn';
      validate(config); await chrome.storage.local.set({ settings: config });
      await begin(await inject(), message.mode, 'translate'); return;
    }
    if (message.type === 'TEST') {
      await idle(); const config = normalizeSettings(message.settings); validate(config);
      const id = crypto.randomUUID(); const job: ActiveJob = { id, recordId: id, pageUrl: '', generation: await store.generation(), phase: 'test', operation: 'translate', startedAt: Date.now(), settings: config };
      await chrome.storage.session.set({ active: job, testStatus: { id, state: 'running' } });
      try { await offscreen({ target: 'offscreen', type: 'TEST', job, settings: config }); }
      catch (error) { await chrome.storage.session.remove('active'); throw error; } return { id };
    }
    if (!reader || !owner) throw new AppError('INVALID_CAPTURE');
    if (message.type === 'DELETE_RECORD' || message.type === 'RETRY' || message.type === 'REBIND') {
      const record = await store.get(message.recordId);
      if (!record || record.pageUrl !== reader.pageUrl) throw new AppError('INVALID_CAPTURE');
      if (message.type === 'DELETE_RECORD') {
        const job = await active(); if (job?.recordId === record.id) await cancel(job);
        await store.remove(record.id); await broadcast(); return;
      }
      await begin(reader, message.type === 'RETRY' ? 'saved' : 'region', message.type === 'RETRY' ? 'translate' : 'rebind', record); return;
    }
    if (!('jobId' in message)) throw new AppError('UNSUPPORTED');
    const job = await active();
    if (!job || job.id !== message.jobId || !same(job.owner, owner) || job.pageUrl !== reader.pageUrl) throw new AppError('INVALID_CAPTURE');
    if (message.type === 'CANCEL') { await cancel(job); return; }
    if (message.type === 'ATTACH') {
      if (job.operation !== 'rebind' || !validAnchor(message.anchor)) throw new AppError('INVALID_CAPTURE');
      const record = await store.get(job.recordId); if (!record) throw new AppError('INVALID_CAPTURE');
      await store.put({ ...record, anchor: message.anchor, updatedAt: Date.now() }, job.generation);
      await chrome.storage.session.remove('active'); await broadcast();
      await page(owner, { target: 'page', type: 'CANCELLED', jobId: job.id }); return;
    }
    if (message.type === 'CAPTURE') {
      if (job.phase !== 'selecting' || !job.settings || !validAnchor(message.anchor)) throw new AppError('INVALID_CAPTURE');
      job.phase = 'capturing'; job.anchor = message.anchor; await chrome.storage.session.set({ active: job });
      try {
        const tab = await chrome.tabs.get(owner.tabId);
        const pause = 550 - (Date.now() - lastCaptureTime); if (pause > 0) await new Promise(r => setTimeout(r, pause));
        if (!tab.active || !(await page(owner, { target: 'page', type: 'VERIFY', jobId: job.id, viewport: message.viewport }))) throw new AppError('INVALID_CAPTURE');
        lastCaptureTime = Date.now();
        const screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
        if (!(await chrome.tabs.get(owner.tabId)).active || !(await page(owner, { target: 'page', type: 'VERIFY', jobId: job.id, viewport: message.viewport }))) throw new AppError('INVALID_CAPTURE');
        job.phase = 'processing'; job.startedAt = Date.now(); await chrome.storage.session.set({ active: job });
        await page(owner, { target: 'page', type: 'LOADING', jobId: job.id, recordId: job.recordId, anchor: message.anchor, methodId: job.settings.methodId });
        await offscreen({ target: 'offscreen', type: 'RUN', job, settings: job.settings, screenshot, rect: message.rect, viewport: message.viewport });
      } catch (error) {
        await chrome.storage.session.remove('active');
        await page(owner, { target: 'page', type: 'COMPLETE', jobId: job.id, recordId: job.recordId, outcome: { error: failure(error) } }).catch(() => {});
      }
    }
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.target !== 'background') return;
    // Do not hold the serial dispatcher while the native process runs: cancel,
    // clearing records and navigation must remain responsive.
    if (message.type === 'WINDOWS_OCR' || message.type === 'WINDOWS_CANCEL') {
      void (async () => {
        await ready;
        if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('/offscreen.html') || sender.tab) throw new AppError('UNSUPPORTED');
        if (message.type === 'WINDOWS_CANCEL') { nativeJobs.get(message.jobId)?.abort(); return; }
        const job = await active();
        if (!job || job.id !== message.jobId || job.settings?.methodId !== 'windows-ocr' || !['processing', 'test'].includes(job.phase)) throw new AppError('INVALID_CAPTURE');
        if ((job.phase === 'test') !== (message.request?.operation === 'ping')) throw new AppError('INVALID_CAPTURE');
        validateWindowsRequest(message.request);
        if (nativeJobs.has(job.id)) throw new AppError('BUSY');
        const controller = new AbortController(); nativeJobs.set(job.id, controller);
        try {
          // Close the cancellation race between reading active storage and spawning.
          if ((await active())?.id !== job.id) throw new AppError('CANCELLED');
          return await requestWindowsOcr(message.request, controller.signal);
        } finally { nativeJobs.delete(job.id); }
      })().then(data => respond({ ok: true, data }), error => respond({ ok: false, error: failure(error) }));
      return true;
    }
    serial(() => dispatch(message, sender)).then(data => respond({ ok: true, data }), error => respond({ ok: false, error: failure(error) })); return true;
  });
  chrome.commands.onCommand.addListener(command => {
    if (command !== 'select-region') return;
    void serial(async () => {
      try { await begin(await inject(), 'region', 'translate'); await chrome.action.setBadgeText({ text: '' }); }
      catch (error) { await chrome.storage.session.set({ shortcutError: failure(error) }); await chrome.action.setBadgeText({ text: '!' }); await chrome.action.setBadgeBackgroundColor({ color: '#b45309' }); if (error instanceof AppError && error.code === 'CONFIG') await chrome.runtime.openOptionsPage(); }
    });
  });
  chrome.tabs.onActivated.addListener(({ tabId }) => void serial(async () => { const job = await active(); if (job?.owner && job.owner.tabId !== tabId) await cancel(job); }));
  async function detach(tabId: number) {
    const job = await active(); if (job?.owner?.tabId === tabId) await cancel(job, false);
    const current = await readers();
    for (const reader of current.filter(r => r.owner.tabId === tabId)) await page(reader.owner, { target: 'page', type: 'RESET' }).catch(() => {});
    await chrome.storage.session.set({ readers: current.filter(r => r.owner.tabId !== tabId) });
  }
  chrome.tabs.onUpdated.addListener((tabId, change) => { if (change.status === 'loading' || change.url) void serial(() => detach(tabId)); });
  chrome.tabs.onRemoved.addListener(tabId => void serial(() => detach(tabId)));
});
