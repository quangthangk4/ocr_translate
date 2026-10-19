import { defineContentScript } from 'wxt/utils/define-content-script';
import css from '../src/ui/content.css?inline';
import { anchorFor, createAnchorResolver, resolveAnchor, sameRegion } from '../src/anchors';
import { makeButton, renderSegment } from '../src/ui/study';
import { createOcrText } from '../src/ui/ocr-text';
import { plainOcrText } from '../src/ocr-text';
import { isOcrMethod } from '../src/methods/catalog';
import { send, type PageMessage } from '../src/protocol';
import type { Anchor, Failure, Rect, TranslationRecord, Viewport } from '../src/types';

interface CardState {
  record: TranslationRecord; saved: boolean; hidden: boolean; collapsed: boolean;
  element?: HTMLElement; ocrText?: HTMLElement; marker?: HTMLButtonElement; error?: Failure; loading?: boolean;
  offset?: { x: number; y: number }; height: number; wide?: boolean; top?: number; forceRender?: boolean;
}
interface Pending { id: string; recordId: string; phase: 'preparing' | 'selecting' | 'capturing' | 'processing'; operation: 'translate' | 'rebind'; anchor?: Anchor }

export default defineContentScript({
  matches: [], registration: 'runtime',
  main() {
    const global = globalThis as typeof globalThis & { __comicLensV2?: boolean };
    if (global.__comicLensV2) return; global.__comicLensV2 = true;
    const documentToken = crypto.randomUUID();
    const host = document.createElement('div'); host.id = 'comic-lens-root';
    host.style.cssText = 'all:initial!important;position:absolute!important;top:0!important;left:0!important;width:0!important;height:0!important;z-index:2147483647!important;pointer-events:none!important;';
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style'); style.textContent = css; root.append(style);
    const cards = new Map<string, CardState>();
    let pending: Pending | undefined, selectionAbort: AbortController | undefined;
    let focusCard: { id: string; remaining: number; stable: number } | undefined;
    let frame = 0, dock: HTMLElement | undefined;
    const observed = new Set<Element>();
    const resize = new ResizeObserver(() => schedule());
    const viewport = (): Viewport => ({ width: innerWidth, height: innerHeight, scrollX, scrollY });
    const sameViewport = (a: Viewport, b: Viewport) => Object.keys(a).every(k => a[k as keyof Viewport] === b[k as keyof Viewport]);
    const twoFrames = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    function mount() { if (!host.isConnected) document.documentElement.append(host); }
    function visible(value: boolean) { host.style.setProperty('visibility', value ? 'visible' : 'hidden', 'important'); }
    function schedule() { if (!frame) frame = requestAnimationFrame(() => { frame = 0; layout(); }); }
    function notify(message: string) {
      mount(); root.querySelector('.toast')?.remove();
      const toast = document.createElement('div'); toast.className = 'toast'; toast.setAttribute('role', 'status');
      const p = document.createElement('p'); p.textContent = message; toast.append(p, makeButton('Đóng', () => toast.remove())); root.append(toast);
    }
    function report(error: unknown) { notify((error as Error)?.message ?? 'Không liên lạc được extension. Hãy tải lại trang.'); }
    function clearSelection() { selectionAbort?.abort(); selectionAbort = undefined; root.querySelector('.selection')?.remove(); root.querySelector('.choice')?.remove(); }
    function removeElement(state: CardState) { state.ocrText?.remove(); state.ocrText = undefined; if (state.element) { state.height = state.element.offsetHeight; resize.unobserve(state.element); state.element.remove(); state.element = undefined; } }
    function removeState(id: string) { const state = cards.get(id); if (!state) return; removeElement(state); state.marker?.remove(); cards.delete(id); orphanOpen.delete(id); }
    function revealCard(state: CardState) {
      if (focusCard) { const previous = cards.get(focusCard.id); if (previous) previous.forceRender = false; }
      state.hidden = false; state.forceRender = true;
      focusCard = { id: state.record.id, remaining: 12, stable: 0 }; schedule();
    }
    function reset() {
      clearSelection(); pending = undefined; focusCard = undefined; for (const id of [...cards.keys()]) removeState(id);
      dock?.remove(); dock = undefined; root.querySelector('.toast')?.remove(); visible(true); host.remove();
      for (const element of observed) resize.unobserve(element); observed.clear();
    }
    function applyRecords(records: TranslationRecord[], reveal = false) {
      mount();
      const ids = new Set(records.map(r => r.id));
      for (const id of [...cards.keys()]) if (!ids.has(id) && pending?.recordId !== id) removeState(id);
      for (const record of records) {
        const old = cards.get(record.id);
        if (old) {
          if (old.record.updatedAt !== record.updatedAt || JSON.stringify(old.record.anchor) !== JSON.stringify(record.anchor)) { old.record = record; removeElement(old); }
          old.saved = true; if (reveal) old.hidden = false;
        } else cards.set(record.id, { record, saved: true, hidden: false, collapsed: false, height: 360 });
      }
      updateDock(); schedule();
    }
    function placeholder(id: string, anchor: Anchor): CardState {
      const record: TranslationRecord = { version: 2, id, pageUrl: location.href, anchor, methodId: '', model: '', sourceLang: '', targetLang: '', mode: 'learn', promptVersion: '', createdAt: Date.now(), updatedAt: Date.now(), result: { segments: [], warnings: [] } };
      return { record, saved: false, hidden: false, collapsed: false, height: 230 };
    }
    function renderCard(state: CardState, number: number) {
      const ocr = isOcrMethod(state.record.methodId) || state.record.result.kind === 'ocr';
      const ocrName = state.record.methodId === 'windows-ocr' ? 'Windows OCR' : 'OCR cục bộ';
      const card = document.createElement('section'); card.className = 'card'; card.dataset.recordId = state.record.id; card.dataset.collapsed = String(state.collapsed);
      card.setAttribute('role', 'region'); card.setAttribute('aria-label', `${ocr ? 'Văn bản OCR' : 'Bản dịch'} ${number}`);
      const header = document.createElement('header'); header.tabIndex = 0; header.title = 'Kéo hoặc dùng phím mũi tên để di chuyển thẻ';
      const title = document.createElement('strong'); title.textContent = `${number} · Comic Lens`;
      const fold = makeButton(state.collapsed ? 'Mở rộng' : 'Thu gọn', () => { state.collapsed = !state.collapsed; removeElement(state); schedule(); });
      const hide = makeButton('Ẩn', () => { state.hidden = true; removeElement(state); schedule(); });
      header.append(title, fold, hide);
      const body = document.createElement('div'); body.className = 'body';
      const status = document.createElement('p'); status.className = `status${state.error ? ' error' : ''}`; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
      status.textContent = state.loading ? ocr ? `Đang nhận chữ bằng ${ocrName}…` : 'Đang đọc ảnh, dịch và xử lý…' : state.error ? state.error.message : `${ocr ? `${ocrName} · Bôi chọn chữ để tra từ` : state.record.mode === 'learn' ? 'Dịch và hiểu' : 'Dịch nhanh'}${state.saved ? ' · Đã lưu trên máy' : ''}${state.record.model ? ` · ${state.record.model}` : ''}`;
      body.append(status);
      if (ocr && state.record.result.segments.length) {
        const { element, slot } = createOcrText(state.record.id, state.record.result.segments.map(s => s.source).join('\n\n'));
        state.ocrText = element; host.append(element); body.append(slot);
      } else for (const segment of state.record.result.segments) body.append(renderSegment(segment));
      for (const warning of state.record.result.warnings) { const p = document.createElement('p'); p.className = 'warning'; p.textContent = warning; body.append(p); }
      const footer = document.createElement('footer');
      if (state.loading) footer.append(makeButton('Hủy lượt dịch', () => { if (pending) void send({ target: 'background', type: 'CANCEL', jobId: pending.id }).catch(report); }));
      const copy = makeButton(ocr ? 'Sao chép văn bản' : 'Sao chép bản dịch', () => {
        const text = state.record.result.segments.map(s => ocr ? s.source : s.translation).join('\n\n');
        void navigator.clipboard.writeText(ocr ? plainOcrText(text) : text).then(() => { copy.textContent = 'Đã sao chép'; }, () => notify('Không sao chép được. Bạn có thể chọn văn bản trong thẻ.'));
      }); copy.disabled = !state.record.result.segments.length; footer.append(copy);
      if (state.saved) {
        footer.append(makeButton(ocr ? 'Nhận chữ lại' : 'Dịch lại', () => { void send({ target: 'background', type: 'RETRY', recordId: state.record.id }).catch(report); }));
        footer.append(makeButton(ocr ? 'Xóa văn bản' : 'Xóa bản dịch', () => { void send({ target: 'background', type: 'DELETE_RECORD', recordId: state.record.id }).catch(report); }));
      } else if (!state.loading) footer.append(makeButton('Xóa thẻ', () => { removeState(state.record.id); updateDock(); schedule(); }));
      footer.append(makeButton('Đổi cỡ hộp', () => { state.wide = !state.wide; schedule(); }));
      footer.append(makeButton('Cài đặt', () => { void send({ target: 'background', type: 'OPEN_OPTIONS' }).catch(report); }));
      card.append(header, body, footer); root.append(card); state.element = card; resize.observe(card);
      function move(dx: number, dy: number) { state.offset = { x: (state.offset?.x ?? 0) + dx, y: (state.offset?.y ?? 0) + dy }; schedule(); }
      header.addEventListener('pointerdown', event => {
        if ((event.target as HTMLElement).closest('button') || event.button !== 0) return;
        header.setPointerCapture(event.pointerId); let x = event.clientX, y = event.clientY;
        const drag = (e: PointerEvent) => { move(e.clientX - x, e.clientY - y); x = e.clientX; y = e.clientY; };
        header.addEventListener('pointermove', drag);
        header.addEventListener('lostpointercapture', () => header.removeEventListener('pointermove', drag), { once: true });
      });
      header.addEventListener('keydown', event => {
        if (event.target !== header || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault(); const step = event.shiftKey ? 30 : 10;
        move(event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0, event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0);
      });
    }
    function updateDock() {
      const open = dock?.querySelector('details')?.open ?? false;
      dock?.remove(); dock = undefined;
      if (!cards.size) return;
      dock = document.createElement('aside'); dock.className = 'dock';
      const details = document.createElement('details'); details.open = open;
      const summary = document.createElement('summary'); summary.textContent = `Comic Lens · ${cards.size} bản dịch`; details.append(summary);
      const tools = document.createElement('div'); tools.className = 'tools';
      tools.append(makeButton('Hiện tất cả', () => { for (const state of cards.values()) state.hidden = false; schedule(); }));
      tools.append(makeButton('Ẩn tất cả', () => { for (const state of cards.values()) state.hidden = true; schedule(); }));
      tools.append(makeButton('Xóa dữ liệu trang', () => { if (confirm('Xóa mọi bản dịch đã lưu của trang này?')) void send({ target: 'background', type: 'CLEAR_PAGE' }).catch(report); }));
      details.append(tools);
      const resolve = createAnchorResolver(documentToken);
      const orphanStates = [...cards.values()].filter(s => !resolve(s.record.anchor));
      if (orphanStates.length) {
        const heading = document.createElement('p'); heading.textContent = `Bản dịch chưa gắn ảnh (${orphanStates.length})`; details.append(heading);
        const list = document.createElement('div'); list.className = 'orphans';
        for (const state of orphanStates) {
          const item = document.createElement('div'); item.className = 'orphan';
          const p = document.createElement('p'); p.textContent = state.record.result.segments[0]?.source.slice(0, 100) ?? 'Bản dịch'; item.append(p);
          item.append(makeButton('Xem bản đã lưu', () => { state.hidden = false; showOrphan(state); }));
          item.append(makeButton('Gắn lại', () => { void send({ target: 'background', type: 'REBIND', recordId: state.record.id }).catch(report); }));
          item.append(makeButton('Xóa', () => { void send({ target: 'background', type: 'DELETE_RECORD', recordId: state.record.id }).catch(report); })); list.append(item);
        }
        details.append(list);
      }
      dock.append(details); root.append(dock);
    }
    const orphanOpen = new Set<string>();
    function showOrphan(state: CardState) { orphanOpen.add(state.record.id); schedule(); }
    let orphanSignature = '';
    function layout() {
      const resolve = createAnchorResolver(documentToken);
      const entries = [...cards.values()].map((state, i) => ({ state, number: i + 1, anchor: resolve(state.record.anchor) }));
      const signature = entries.filter(e => !e.anchor).map(e => e.state.record.id).join(',');
      if (signature !== orphanSignature) { orphanSignature = signature; updateDock(); }
      const nextObserved = new Set<Element>([document.documentElement]);
      let bottom = -Infinity;
      entries.sort((a, b) => (a.anchor?.rect.y ?? Infinity) - (b.anchor?.rect.y ?? Infinity));
      for (const { state, number, anchor } of entries) {
        if (anchor?.image) nextObserved.add(anchor.image);
        const rect = anchor?.rect;
        const near = !!rect && rect.y + rect.height > scrollY - 900 && rect.y < scrollY + innerHeight + 900;
        if (near && rect) {
          if (!state.marker) {
            state.marker = makeButton(String(number), () => revealCard(state));
            state.marker.className = 'marker'; state.marker.title = `Mở bản dịch ${number}`; state.marker.setAttribute('aria-label', `Mở bản dịch ${number}`); state.marker.dataset.recordId = state.record.id; root.append(state.marker);
          }
          state.marker.style.left = `${Math.max(scrollX + 2, rect.x)}px`; state.marker.style.top = `${rect.y}px`;
        } else { state.marker?.remove(); state.marker = undefined; }
        const floating = !anchor && orphanOpen.has(state.record.id);
        if (!anchor && !floating || state.hidden) { removeElement(state); continue; }
        const width = Math.max(200, Math.min(state.wide ? 480 : 350, innerWidth - 20));
        const gutter = !!anchor && scrollX + innerWidth - anchor.imageRight >= width + 26;
        let x = gutter ? anchor!.imageRight + 16 : scrollX + innerWidth - width - 16;
        let y = anchor ? Math.max(8, anchor.rect.y - 180) : scrollY + 70;
        if (state.offset) { x += state.offset.x; y += state.offset.y; }
        x = Math.max(scrollX + 8, Math.min(x, scrollX + innerWidth - width - 8));
        y = floating ? Math.max(8, y) : Math.max(8, y, bottom + 12);
        state.top = y;
        const render = state.forceRender || floating || y + state.height > scrollY - 900 && y < scrollY + innerHeight + 900;
        if (render && !state.element) renderCard(state, number);
        if (!render) removeElement(state);
        if (state.element) {
          state.element.style.width = `${width}px`; state.element.style.left = `${x}px`; state.element.style.top = `${y}px`;
          state.element.dataset.placement = gutter ? 'gutter' : 'floating';
          state.height = state.element.offsetHeight;
        }
        if (!floating) bottom = y + state.height;
      }
      for (const element of observed) if (!nextObserved.has(element)) { resize.unobserve(element); observed.delete(element); }
      for (const element of nextObserved) if (!observed.has(element)) { resize.observe(element); observed.add(element); }
      // Keep the requested card mounted while newly visible cards settle their heights.
      if (focusCard) {
        const state = cards.get(focusCard.id), target = Math.max(0, (state?.top ?? 0) - 16);
        if (state?.element) {
          if (Math.abs(scrollY - target) > 2) { focusCard.stable = 0; window.scrollTo({ top: target, behavior: 'instant' }); }
          else focusCard.stable++;
        }
        if (!state || --focusCard.remaining <= 0 || focusCard.stable >= 2) { if (state) state.forceRender = false; focusCard = undefined; }
        else schedule();
      }
    }
    function cancelPending(notifyBackground = true) {
      const old = pending; pending = undefined; clearSelection(); visible(true);
      if (old) {
        const state = cards.get(old.recordId);
        if (state) { if (!state.saved) removeState(old.recordId); else { state.loading = false; removeElement(state); } }
        if (notifyBackground) void send({ target: 'background', type: 'CANCEL', jobId: old.id }).catch(() => {});
      }
      updateDock(); schedule();
    }
    async function selected(rect: Rect, initial: Viewport, force = false) {
      const job = pending; if (!job) return;
      clearSelection(); job.anchor = anchorFor(rect, documentToken);
      if (job.operation === 'rebind') {
        try { await send({ target: 'background', type: 'ATTACH', jobId: job.id, anchor: job.anchor }); }
        catch (error) { cancelPending(); report(error); } return;
      }
      const existing = !force && [...cards.values()].find(s => s.saved && s.record.id !== job.recordId && sameRegion(s.record.anchor, job.anchor!));
      if (existing) {
        const choice = document.createElement('div'); choice.className = 'choice';
        const p = document.createElement('p'); p.textContent = `Vùng này đã có bản dịch (${existing.record.model}, ${existing.record.targetLang}).`; choice.append(p);
        choice.append(makeButton('Xem bản đã lưu', () => { cancelPending(); revealCard(existing); }));
        choice.append(makeButton('Dịch mới', () => { if (sameViewport(initial, viewport())) void selected(rect, initial, true); else { cancelPending(); notify('Khung nhìn đã thay đổi. Hãy chọn vùng lại.'); } }));
        choice.append(makeButton('Hủy', () => cancelPending())); root.append(choice); return;
      }
      job.phase = 'capturing'; visible(false); await twoFrames();
      if (pending !== job || !sameViewport(initial, viewport())) { if (pending === job) cancelPending(); return; }
      try { await send({ target: 'background', type: 'CAPTURE', jobId: job.id, rect, viewport: initial, anchor: job.anchor }); }
      catch (error) { if (pending === job) { cancelPending(); report(error); } }
    }
    function selectRegion() {
      const job = pending; if (!job) return; job.phase = 'selecting';
      const initial = viewport(); selectionAbort = new AbortController();
      const layer = document.createElement('div'); layer.className = 'selection';
      const hint = document.createElement('div'); hint.className = 'hint'; hint.textContent = job.operation === 'rebind' ? 'Chọn vùng để gắn bản dịch đã lưu · Không gọi API' : 'Kéo chọn vùng truyện · Esc để hủy';
      hint.append(makeButton('Hủy', () => cancelPending())); layer.append(hint); root.append(layer);
      let start: { x: number; y: number } | undefined;
      const box = document.createElement('div'); box.className = 'box';
      const selectedRect = (e: PointerEvent): Rect => {
        const x = Math.max(0, Math.min(innerWidth, e.clientX)), y = Math.max(0, Math.min(innerHeight, e.clientY));
        return { x: Math.min(start!.x, x), y: Math.min(start!.y, y), width: Math.abs(x - start!.x), height: Math.abs(y - start!.y) };
      };
      layer.addEventListener('pointerdown', e => { if (e.button !== 0 || (e.target as HTMLElement).closest('.hint')) return; start = { x: e.clientX, y: e.clientY }; layer.setPointerCapture(e.pointerId); layer.append(box); e.preventDefault(); });
      layer.addEventListener('pointermove', e => { if (!start) return; const r = selectedRect(e); Object.assign(box.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` }); });
      layer.addEventListener('pointerup', e => { if (!start) return; const r = selectedRect(e); start = undefined; if (r.width < 4 || r.height < 4) { box.remove(); return; } void selected(r, initial); });
      layer.addEventListener('pointercancel', () => cancelPending());
      document.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); cancelPending(); } }, { capture: true, signal: selectionAbort.signal });
    }
    async function begin(message: Extract<PageMessage, { type: 'BEGIN' }>) {
      cancelPending(false); mount(); visible(true);
      const job: Pending = { id: message.jobId, recordId: message.recordId, phase: 'preparing', operation: message.operation }; pending = job;
      root.querySelector('.toast')?.remove();
      if (message.mode === 'viewport') { job.phase = 'selecting'; const v = viewport(); void selected({ x: 0, y: 0, width: v.width, height: v.height }, v); return; }
      if (message.mode === 'saved' && message.anchor) {
        let found = resolveAnchor(message.anchor, documentToken);
        if (found) {
          window.scrollTo({ left: scrollX, top: Math.max(0, found.rect.y - (innerHeight - found.rect.height) / 2), behavior: 'instant' }); await twoFrames();
          if (pending !== job) return;
          found = resolveAnchor(message.anchor, documentToken);
          if (found) {
            const r = { ...found.rect, x: found.rect.x - scrollX, y: found.rect.y - scrollY };
            if (r.x >= 0 && r.y >= 0 && r.x + r.width <= innerWidth && r.y + r.height <= innerHeight) { job.phase = 'selecting'; void selected(r, viewport(), true); return; }
          }
        }
        notify('Hãy chọn lại vùng ảnh để dịch lại bản này. Bản dịch cũ được giữ đến khi có kết quả mới.');
      }
      selectRegion();
    }
    window.addEventListener('scroll', () => { if (pending?.phase === 'selecting' || pending?.phase === 'capturing') cancelPending(); schedule(); }, { passive: true });
    window.addEventListener('resize', () => { if (pending?.phase === 'selecting' || pending?.phase === 'capturing') cancelPending(); schedule(); });
    window.visualViewport?.addEventListener('resize', () => { if (pending?.phase === 'selecting' || pending?.phase === 'capturing') cancelPending(); schedule(); });
    document.addEventListener('load', () => schedule(), true);
    document.addEventListener('visibilitychange', () => { if (document.hidden && pending && pending.phase !== 'processing') cancelPending(); });
    window.addEventListener('pagehide', () => { cancelPending(); reset(); });
    new MutationObserver(mutations => { if (cards.size && mutations.some(m => m.target !== host && !host.contains(m.target))) schedule(); }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'srcset', 'sizes', 'style', 'class'] });
    chrome.runtime.onMessage.addListener((message: PageMessage, sender, respond) => {
      if (message?.target !== 'page' || sender.id !== chrome.runtime.id) return;
      if (message.type === 'RECORDS') { applyRecords(message.records, message.reveal); respond(true); return; }
      if (message.type === 'RESET') { reset(); respond(true); return; }
      if (message.type === 'BEGIN') { void begin(message); respond(true); return; }
      if (!pending || message.jobId !== pending.id) { respond(false); return; }
      if (message.type === 'VERIFY') { respond(pending.phase === 'capturing' && sameViewport(message.viewport, viewport()) && !document.hidden); return; }
      if (message.type === 'CANCELLED') { cancelPending(false); notify('Đã hủy lượt xử lý.'); respond(true); return; }
      if (message.type === 'LOADING') {
        pending.phase = 'processing'; pending.anchor = message.anchor; clearSelection(); visible(true);
        const state = cards.get(message.recordId) ?? placeholder(message.recordId, message.anchor);
        if (!state.saved) state.record.methodId = message.methodId ?? '';
        state.loading = true; state.error = undefined; state.hidden = false; state.record.anchor = message.anchor;
        cards.set(message.recordId, state); removeElement(state); updateDock(); schedule();
      }
      if (message.type === 'COMPLETE') {
        visible(true); clearSelection();
        const state = cards.get(message.recordId) ?? (message.record ? { ...placeholder(message.recordId, message.record.anchor), record: message.record } : pending.anchor ? placeholder(message.recordId, pending.anchor) : undefined);
        if (state) {
          state.loading = false;
          if (message.record) { state.record = message.record; state.error = undefined; }
          if ('error' in message.outcome) state.error = message.outcome.error;
          cards.set(message.recordId, state); removeElement(state);
        } else if ('error' in message.outcome) report(message.outcome.error);
        pending = undefined; updateDock(); schedule();
      }
      respond(true);
    });
  },
});
