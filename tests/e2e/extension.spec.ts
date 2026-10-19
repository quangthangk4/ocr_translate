import { test, expect, chromium, type BrowserContext, type Page, type CDPSession } from '@playwright/test';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createServer, type Server } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { RecordIndexItem, RecordStats, TranslationRecord } from '../../src/types';

let context: BrowserContext, options: Page, comic: Page, server: Server, extensionId: string, extension: string, profile: string, comicUrl: string, cdp: CDPSession;
let nativeDirectory = '';
const runNative = (args: string[]) => promisify(execFile)('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', ...args], { windowsHide: true });
const sentence = "I'd expect it to be far stronger than the Dragon Lord, at the very least.";
const fixture = `<!doctype html><html><head><style>body{margin:0;background:#181818;min-height:2700px}img{display:block;margin:40px;width:650px;height:auto}canvas{display:block;margin:40px;background:#d4e2dc}</style></head><body><div id="above"></div><img id="comic" src="/page.svg?chapter=1" width="650" height="2200"><canvas id="canvas" width="650" height="300"></canvas></body></html>`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="650" height="2200"><rect width="650" height="2200" fill="#d4e2dc"/>${[50,800,1550].map(y => `<rect x="20" y="${y}" width="610" height="220" rx="50" fill="white" stroke="#233f3c"/><text x="45" y="${y+85}" font-family="sans-serif" font-size="24">I'D EXPECT IT TO BE FAR STRONGER</text><text x="45" y="${y+125}" font-family="sans-serif" font-size="24">THAN THE DRAGON LORD, AT THE VERY LEAST.</text>`).join('')}</svg>`;

// Offscreen targets aren't Playwright Pages. Inject a fake fetch into an isolated test copy.
function installMock() {
  const original = globalThis.fetch;
  let config = { status: 200, delay: 0, malformed: false, brokenLearning: false, unsafe: false, quickEnvelope: false };
  let calls: object[] = [];
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message.target !== 'mock-api') return;
    if (message.type === 'CONFIG') { config = { ...config, ...message.config }; calls = []; respond(true); }
    if (message.type === 'CALLS') respond(calls);
  });
  globalThis.fetch = async (url, init) => {
    if (!String(url).startsWith('https://generativelanguage.googleapis.com/')) return original(url, init);
    const body = JSON.parse(String(init?.body));
    calls.push({ body, base64: Array.isArray(body.input) ? body.input.find((v: { type: string }) => v.type === 'image')?.data : undefined });
    const snapshot = { ...config };
    if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
      const timer = setTimeout(() => { init?.signal?.removeEventListener('abort', abort); resolve(); }, snapshot.delay);
      init?.signal?.addEventListener('abort', abort, { once: true });
    });
    const learning = snapshot.brokenLearning ? { chunks: 'bad' } : {
      chunks: [{ text: "I'd expect", meaning: 'Tôi cho rằng / tôi kỳ vọng' }, { text: 'far stronger than', meaning: 'mạnh hơn rất nhiều' }, { text: 'at the very least', meaning: 'ít nhất thì' }],
      structures: [{ excerpt: 'far stronger than', pattern: 'far + comparative + than', explanation: 'Far nhấn mạnh mức độ so sánh.', example: 'This route is far shorter than the other one.', exampleTranslation: 'Tuyến đường này ngắn hơn tuyến kia rất nhiều.' }], notes: ['Đại từ it cần thêm ngữ cảnh.'],
    };
    const learn = !!body.response_format?.schema?.properties?.segments?.items?.properties?.learning;
    const result = { segments: [{ source: "I'd expect it to be far stronger than the Dragon Lord, at the very least." + (snapshot.unsafe ? ' <img src=x onerror="alert(1)">' : ''), translation: 'Ít nhất thì tôi cũng nghĩ nó phải mạnh hơn Long Vương rất nhiều.' + (snapshot.unsafe ? ' <script>alert(1)</script>' : ''), ...(learn ? { learning } : {}) }], warnings: [] };
    const payload = snapshot.quickEnvelope && !learn ? '```json\n' + JSON.stringify({ segments: result.segments }) + '\n```' : JSON.stringify(result);
    return new Response(snapshot.status !== 200 ? '{"error":{"message":"Mock provider error"}}' : JSON.stringify({ status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: typeof body.input === 'string' ? 'OK' : snapshot.malformed ? '{broken' : payload }] }] }), { status: snapshot.status, headers: { 'Content-Type': 'application/json' } });
  };
}

async function background<T = unknown>(message: object): Promise<T> {
  const reply = await options.evaluate(async message => await chrome.runtime.sendMessage({ target: 'background', ...message }), message);
  expect(reply.ok, JSON.stringify(reply.error)).toBe(true); return reply.data;
}
async function configureMock(config: { status?: number; delay?: number; malformed?: boolean; brokenLearning?: boolean; unsafe?: boolean; quickEnvelope?: boolean }) {
  await options.evaluate(async config => {
    if (!(await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length) await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: [chrome.offscreen.Reason.BLOBS], justification: 'Prepare isolated image processor for tests.' });
    await chrome.runtime.sendMessage({ target: 'mock-api', type: 'CONFIG', config });
  }, config);
}
async function calls(): Promise<{ body: any; base64?: string }[]> { return options.evaluate(async () => await chrome.runtime.sendMessage({ target: 'mock-api', type: 'CALLS' }).catch(() => []) ?? []); }
async function shadow<T>(fn: string, args: unknown[] = []): Promise<T | undefined> {
  const tree = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  function find(node: any): any { if (node.attributes?.includes('comic-lens-root')) return node.shadowRoots?.[0]; for (const child of [...node.children ?? [], ...node.shadowRoots ?? []]) { const found = find(child); if (found) return found; } }
  const root = find(tree.root); if (!root) return undefined;
  const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: root.backendNodeId });
  const result = await cdp.send('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: fn, arguments: args.map(value => ({ value })), returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(`Shadow evaluation: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
  return result.result.value as T;
}
const text = async () => await shadow<string>('function(){return this.textContent}') ?? '';
const cardText = async () => await shadow<string>('function(){return [...this.querySelectorAll(".card")].map(e=>e.textContent).join(" ")}') ?? '';
const stats = () => background<RecordStats>({ type: 'STATS' });
async function records(): Promise<TranslationRecord[]> { return options.evaluate(async () => { const all = await chrome.storage.local.get(null); return Object.entries(all).filter(([key]) => key.startsWith('translationV2:')).map(([, value]) => value); }) as Promise<TranslationRecord[]>; }
async function click(label: string, recordId?: string) { await shadow('function(label,id){const scope=id?this.querySelector(`[data-record-id="${id}"].card`):this;const b=[...scope.querySelectorAll("button")].find(b=>b.textContent===label);if(!b)throw Error("Missing button: "+label);b.click()}', [label, recordId ?? null]); }
async function start(mode: 'region' | 'viewport' = 'region') { await comic.bringToFront(); await background({ type: 'START', mode, methodId: 'gemini-image' }); }
async function drag(x = 90, y = 100, width = 420, height = 140) { await comic.mouse.move(x, y); await comic.mouse.down(); await comic.mouse.move(x + width, y + height); await comic.mouse.up(); }
async function translate(y = 0) {
  await comic.bringToFront(); await comic.evaluate(y => scrollTo(0, y), y);
  await start(); await drag(); await expect.poll(cardText).toContain('Long Vương');
}
async function launch() {
  context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.BRAVE_PATH ?? 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe', headless: true,
    viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1.25,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-first-run', '--disable-component-update'], ignoreDefaultArgs: ['--disable-extensions'],
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker'); extensionId = new URL(worker.url()).hostname;
  options = await context.newPage(); await options.goto(`chrome-extension://${extensionId}/options.html`); await expect(options.locator('#config-apiKey')).toBeVisible();
  comic = await context.newPage(); await comic.goto(comicUrl); cdp = await context.newCDPSession(comic);
}
test.beforeAll(async () => {
  const run = resolve('.browser-test', `v2-${Date.now()}`); await mkdir(run, { recursive: true }); extension = join(run, 'extension'); profile = join(run, 'profile');
  await cp(resolve('.output/chrome-mv3'), extension, { recursive: true });
  const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8')); manifest.host_permissions.push('<all_urls>'); // Test-only replacement for toolbar activeTab grant.
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
  await writeFile(join(extension, 'mock-api.js'), `(${installMock.toString()})();`);
  const html = await readFile(join(extension, 'offscreen.html'), 'utf8'); await writeFile(join(extension, 'offscreen.html'), html.replace('<head>', '<head><script src="/mock-api.js"></script>'));
  server = createServer((req, res) => { res.setHeader('Content-Type', req.url?.startsWith('/page.svg') ? 'image/svg+xml' : 'text/html; charset=utf-8'); res.end(req.url?.startsWith('/page.svg') ? svg : fixture); });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address(); if (!address || typeof address === 'string') throw Error('Missing port'); comicUrl = `http://127.0.0.1:${address.port}/chapter`;
  await launch(); await options.bringToFront(); await options.locator('#config-apiKey').fill('FAKE_TEST_KEY_NOT_A_REAL_CREDENTIAL'); await options.getByRole('button', { name: 'Lưu cài đặt', exact: true }).click(); await expect(options.locator('#status')).toContainText('Đã lưu');
  if (process.env.RUN_WINDOWS_OCR === '1') {
    // A dedicated temporary native installation, removed after this run.
    const existing = await runNative(['-Command', '(Get-AppxPackage -Name ComicLens.WindowsOcr).PackageFullName']);
    if (existing.stdout.trim()) throw Error('A Windows OCR bridge is already installed; do not replace a personal installation with the test fixture.');
    nativeDirectory = join(run, 'native');
    await runNative(['-File', resolve('native/windows-ocr/dist/Install.ps1'), '-ExtensionId', extensionId, '-InstallDirectory', nativeDirectory, '-NoElevation']);
  }
});
test.afterAll(async () => {
  await context?.close();
  if (nativeDirectory) await runNative(['-File', join(nativeDirectory, 'Uninstall.ps1')]);
  await new Promise<void>(done => server?.close(() => done()));
});
test.beforeEach(async () => {
  await background({ type: 'CLEAR_ALL' }); await configureMock({ status: 200, delay: 0, malformed: false, brokenLearning: false, unsafe: false, quickEnvelope: false });
  const settings: any = await background({ type: 'GET_SETTINGS' }); settings.mode = 'learn'; await background({ type: 'SAVE_SETTINGS', settings });
  await comic.bringToFront(); await comic.reload();
});

test('real local OCR works offline without a key; selected text is visible to document listeners and restores', async () => {
  const original: any = await background({ type: 'GET_SETTINGS' });
  try {
    await background({ type: 'SAVE_SETTINGS', settings: { ...original, methodId: 'local-ocr', sourceLang: 'English', methods: { ...original.methods, 'gemini-image': { ...original.methods['gemini-image'], apiKey: '' } } } });
    await context.setOffline(true);
    await comic.bringToFront();
    await background({ type: 'START', mode: 'region', methodId: 'local-ocr' }); await drag(70, 140, 600, 120);
    const output = comic.locator('[data-comic-lens-ocr]');
    await expect(output).toContainText('stronger', { timeout: 25_000 });
    await expect(output).toContainText('dragon lord');
    expect(await output.textContent()).not.toMatch(/[\r\n\t]/);
    await expect(output).toHaveCSS('font-weight', '400');
    await expect(output).toHaveCSS('white-space', 'normal');
    await expect(output.locator('strong').first()).toHaveText('I');
    await expect(output.locator('strong').first()).toHaveCSS('font-weight', '700');
    expect(await calls()).toHaveLength(0);
    const selected = await output.evaluate(element => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let source = walker.nextNode();
      while (source && !source.textContent?.includes('stronger')) source = walker.nextNode();
      if (!source) throw Error('Missing selectable OCR text');
      const index = source.textContent!.indexOf('stronger');
      let observed = '';
      document.addEventListener('mouseup', () => { observed = document.getSelection()?.toString() ?? ''; }, { once: true });
      const range = document.createRange(); range.setStart(source, index); range.setEnd(source, index + 8);
      const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      return { observed, inDocument: selection.anchorNode?.getRootNode() === document, userSelect: getComputedStyle(element).userSelect };
    });
    expect(selected).toEqual({ observed: 'stronger', inDocument: true, userSelect: 'text' });
    expect(await output.evaluate(element => {
      const host = document.querySelector<HTMLElement>('#comic-lens-root')!;
      host.style.setProperty('visibility', 'hidden', 'important');
      const visibility = getComputedStyle(element).visibility;
      host.style.setProperty('visibility', 'visible', 'important'); return visibility;
    })).toBe('hidden'); // Old OCR text must hide along with cards before a new screenshot.
    await comic.emulateMedia({ colorScheme: 'dark' }); await expect(output).toHaveCSS('color', 'rgb(238, 241, 249)');
    await comic.emulateMedia({ colorScheme: 'light' });
    const record = (await records())[0]; expect(record.result.kind).toBe('ocr'); expect(record.result.segments[0].translation).toBe('');
    await comic.screenshot({ path: 'test-results/local-ocr.png' });
    await click('Ẩn', record.id); await expect(output).toHaveCount(0);
    await shadow('function(){this.querySelector(".marker").click()}'); await expect(output).toContainText('stronger');
    // Retrying an existing OCR record stays local even after selecting Gemini globally.
    await background({ type: 'SAVE_SETTINGS', settings: { ...original, methods: { ...original.methods, 'gemini-image': { ...original.methods['gemini-image'], apiKey: '' } } } });
    await click('Nhận chữ lại', record.id);
    await expect.poll(async () => (await records())[0].updatedAt).toBeGreaterThan(record.updatedAt);
    await expect(output).toContainText('stronger'); expect(await calls()).toHaveLength(0);
    await context.setOffline(false); await comic.reload(); await background({ type: 'RESTORE' });
    await expect(output).toContainText('stronger'); expect(await calls()).toHaveLength(0);
    await click('Xóa văn bản', record.id); await expect(output).toHaveCount(0); expect((await stats()).count).toBe(0);
  } finally { await context.setOffline(false); await background({ type: 'SAVE_SETTINGS', settings: original }); }
});

test('OCR settings and popup hide translation-only controls and can check the packaged recognizer', async () => {
  await options.bringToFront(); await options.reload();
  await options.locator('#method').selectOption('local-ocr');
  await expect(options.locator('#config-apiKey')).toHaveCount(0);
  await expect(options.locator('#mode')).toBeHidden(); await expect(options.locator('#target')).toBeHidden();
  await expect(options.locator('#source')).toHaveValue('English');
  await options.getByRole('button', { name: 'Kiểm tra OCR cục bộ' }).click();
  await expect(options.locator('#status')).toContainText('OCR cục bộ đã sẵn sàng', { timeout: 25_000 }); expect(await calls()).toHaveLength(0);
  await options.getByRole('button', { name: 'Lưu cài đặt', exact: true }).click();
  const popup = await context.newPage(); await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popup.locator('#method')).toHaveValue('local-ocr'); await expect(popup.locator('#mode')).toBeHidden();
  await expect(popup.locator('#model-field')).toBeHidden();
  await expect(popup.getByRole('button', { name: /Khoanh vùng lấy chữ/ })).toBeEnabled(); await popup.close();
  await options.locator('#method').selectOption('gemini-image'); await expect(options.locator('#mode')).toBeVisible();
  await expect(options.locator('#config-apiKey')).toHaveValue('FAKE_TEST_KEY_NOT_A_REAL_CREDENTIAL');
  await options.getByRole('button', { name: 'Lưu cài đặt', exact: true }).click();
});

test('Windows OCR settings explain installation; only the active offscreen job can contact the host', async () => {
  const original: any = await background({ type: 'GET_SETTINGS' });
  try {
    await options.bringToFront(); await options.reload(); await options.locator('#method').selectOption('windows-ocr');
    await expect(options.locator('#config-apiKey')).toHaveCount(0); await expect(options.locator('#mode')).toBeHidden();
    await expect(options.locator('#method-fields')).toContainText(extensionId);
    const forged = await options.evaluate(async () => chrome.runtime.sendMessage({ target: 'background', type: 'WINDOWS_OCR', jobId: 'forged', request: { operation: 'ping' } }));
    expect(forged).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED' } });
    await options.getByRole('button', { name: 'Kiểm tra Windows OCR', exact: true }).click();
    await expect(options.locator('#status')).toContainText(process.env.RUN_WINDOWS_OCR === '1' ? 'Windows OCR đã sẵn sàng' : 'Chưa kết nối được cầu nối Windows OCR', { timeout: 25_000 });
    expect(await calls()).toHaveLength(0);
  } finally { await background({ type: 'SAVE_SETTINGS', settings: original }); await options.reload(); }
});

test('real Windows OCR extracts offline, preserves selection and retry method, and restores without API', async () => {
  test.skip(process.env.RUN_WINDOWS_OCR !== '1', 'Requires the temporary signed native bridge installation.');
  const original: any = await background({ type: 'GET_SETTINGS' });
  try {
    await background({ type: 'SAVE_SETTINGS', settings: { ...original, methodId: 'windows-ocr', sourceLang: 'English', methods: { ...original.methods, 'gemini-image': { ...original.methods['gemini-image'], apiKey: '' } } } });
    await context.setOffline(true); await comic.bringToFront();
    await background({ type: 'START', mode: 'region', methodId: 'windows-ocr' }); await drag(70, 140, 600, 120);
    const output = comic.locator('[data-comic-lens-ocr]'); await expect(output).toContainText('stronger', { timeout: 25_000 });
    await expect(output).toContainText('dragon lord'); expect(await calls()).toHaveLength(0);
    const record = (await records())[0]; expect(record.methodId).toBe('windows-ocr'); expect(record.result.kind).toBe('ocr');
    await comic.screenshot({ path: 'test-results/windows-ocr.png' });
    await background({ type: 'SAVE_SETTINGS', settings: original }); await click('Nhận chữ lại', record.id);
    await expect.poll(async () => (await records())[0].updatedAt).toBeGreaterThan(record.updatedAt);
    expect((await records())[0].methodId).toBe('windows-ocr'); expect(await calls()).toHaveLength(0);
    await context.setOffline(false); await comic.reload(); await background({ type: 'RESTORE' }); await expect(output).toContainText('stronger');
    await click('Xóa văn bản', record.id); await expect(output).toHaveCount(0);
  } finally { await context.setOffline(false); await background({ type: 'SAVE_SETTINGS', settings: original }); }
});

test('shipping permissions stay minimal and the popup restores without an API call', async () => {
  const manifest = JSON.parse(await readFile(resolve('.output/chrome-mv3/manifest.json'), 'utf8'));
  expect(manifest.chrome_url_overrides ?? {}).toEqual({});
  expect(manifest.permissions.sort()).toEqual(['activeTab','nativeMessaging','offscreen','scripting','storage','unlimitedStorage']); expect(manifest.host_permissions).toEqual(['https://generativelanguage.googleapis.com/*']); expect(manifest.content_scripts ?? []).toEqual([]); expect(manifest.options_ui.open_in_tab).toBe(true);
  const popup = await context.newPage(); await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popup.locator('#mode')).toHaveValue('learn'); await expect(popup.getByRole('button', { name: /Khoanh vùng để dịch/ })).toBeEnabled(); await expect(popup.getByRole('button', { name: 'Hiện bản dịch đã lưu' })).toBeVisible();
  await expect(popup.getByRole('link', { name: 'Tìm trong lịch sử', exact: true })).toHaveAttribute('href', '/library.html');
  await popup.screenshot({ path: 'test-results/v2-popup.png' }); await popup.close(); expect(await calls()).toHaveLength(0);
});

test('popup saves Gemini model immediately, preserves other settings, hides it for OCR and uses it on capture', async () => {
  const original: any = await background({ type: 'GET_SETTINGS' });
  const popup = await context.newPage();
  try {
    await background({ type: 'SAVE_SETTINGS', settings: { ...original, methodId: 'gemini-image', sourceLang: 'English' } });
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(popup.locator('#gemini-model')).toHaveValue(original.methods['gemini-image'].model);
    await popup.locator('#gemini-model').selectOption('gemini-3.6-flash');
    await expect(popup.locator('#status')).toContainText('Đã chọn gemini-3.6-flash');
    const saved = await background<any>({ type: 'GET_SETTINGS' });
    expect(saved.methods['gemini-image']).toEqual({ ...original.methods['gemini-image'], model: 'gemini-3.6-flash' });
    expect(saved.targetLang).toBe(original.targetLang); expect(saved.mode).toBe(original.mode); expect(await calls()).toHaveLength(0);
    await popup.locator('#method').selectOption('windows-ocr'); await expect(popup.locator('#model-field')).toBeHidden();
    await popup.locator('#method').selectOption('gemini-image'); await expect(popup.locator('#gemini-model')).toHaveValue('gemini-3.6-flash');
    await popup.reload(); await expect(popup.locator('#gemini-model')).toHaveValue('gemini-3.6-flash');
    await popup.screenshot({ path: 'test-results/popup-model.png' });
    await popup.emulateMedia({ colorScheme: 'dark' }); await popup.screenshot({ path: 'test-results/popup-model-dark.png' });
    await comic.bringToFront();
    await popup.evaluate(() => document.querySelector<HTMLButtonElement>('#region')!.click());
    await expect.poll(text).toContain('Kéo chọn vùng truyện'); await drag(); await expect.poll(cardText).toContain('Long Vương');
    expect((await calls())[0].body.model).toBe('gemini-3.6-flash');
  } finally { if (!popup.isClosed()) await popup.close(); await background({ type: 'SAVE_SETTINGS', settings: original }); }
});

test('one cropped request teaches chunks and structures; phrase highlighting and expansion are local', async () => {
  await translate(); expect(await calls()).toHaveLength(1);
  const call = (await calls())[0], png = Buffer.from(call.base64!, 'base64');
  expect(png.readUInt32BE(16) / png.readUInt32BE(20)).toBeCloseTo(3, 2); expect(png.readUInt32BE(16)).toBeLessThan(1000);
  expect(call.body.store).toBe(false); expect(call.body.response_format.schema.properties.segments.items.properties.learning).toBeDefined();
  await expect.poll(cardText).toContain('Tách cụm'); await click('far stronger than');
  expect(await shadow('function(){return this.querySelector(".source mark")?.textContent}')).toBe('far stronger than');
  await shadow('function(){this.querySelector(".card details").open=true}'); expect(await cardText()).toContain('This route is far shorter'); expect(await calls()).toHaveLength(1);
  expect(await shadow('function(){return this.querySelector(".card").dataset.placement}')).toBe('gutter');
  expect(await comic.evaluate(() => document.documentElement.outerHTML.includes('FAKE_TEST_KEY'))).toBe(false);
  await comic.screenshot({ path: 'test-results/v2-learning.png' });
  await comic.emulateMedia({ colorScheme: 'dark' }); expect(await shadow('function(){return getComputedStyle(this.querySelector(".card")).color}')).toBe('rgb(238, 241, 249)'); await comic.screenshot({ path: 'test-results/v2-learning-dark.png' }); await comic.emulateMedia({ colorScheme: 'light' });
});

test('history searches all saved text, highlights safely, paginates, opens learning locally and follows deletions', async () => {
  await translate(); const base = (await records())[0];
  await options.evaluate(async base => {
    const values: Record<string, unknown> = {}, index = (await chrome.storage.local.get<{ recordIndexV2: RecordIndexItem[] }>('recordIndexV2')).recordIndexV2;
    for (let i = 0; i < 23; i++) {
      const source = i === 0 ? "You've GOT A\n  SHOT at winning." : i === 1 ? '<img src=x onerror="alert(1)"> got a shot.' : `We have got a shot number ${i}.`;
      const item: TranslationRecord = { ...base, id: `search-${i}`, pageUrl: i === 1 ? 'javascript:alert(1)' : `https://comic.test/chapter-${i}`, updatedAt: 10_000 - i, createdAt: 10_000 - i,
        methodId: i === 2 ? 'local-ocr' : 'gemini-image', mode: i === 0 ? 'learn' : 'quick', result: { segments: [{ source, translation: i === 2 ? '' : 'Bạn có cơ hội thắng.', ...(i === 0 ? { learning: { chunks: [{ text: 'got a shot', meaning: 'có cơ hội' }], structures: [{ excerpt: 'got a shot', pattern: 'have got a shot at + V-ing', explanation: 'Có cơ hội làm việc gì đó.', example: 'This is a window of opportunity.', exampleTranslation: 'Đây là một cơ hội.' }], notes: ['Không phải nghĩa bắn súng ở đây.'] } } : {}) }], warnings: [] } };
      values[`translationV2:${item.id}`] = item; index.push({ id: item.id, pageUrl: item.pageUrl, createdAt: item.createdAt, bytes: JSON.stringify(item).length });
    }
    await chrome.storage.local.set({ ...values, recordIndexV2: index });
  }, base);
  const history = await context.newPage();
  try {
    await history.goto(`chrome-extension://${extensionId}/library.html?q=got%20a%20shot`);
    await expect(history.locator('#status')).toContainText('23 câu phù hợp'); await expect(history.locator('.history-result')).toHaveCount(20);
    await expect(history.locator('.source mark').first()).toHaveText(/GOT A\s+SHOT/);
    expect(await history.locator('#results img,#results script').count()).toBe(0);
    expect(await history.locator('a[href^="javascript:"]').count()).toBe(0);
    await history.locator('.saved-learning > summary').click(); await expect(history.getByText('Có cơ hội làm việc gì đó.', { exact: true })).toBeHidden();
    await history.getByText('Cấu trúc và ví dụ', { exact: true }).click(); await expect(history.getByText('Có cơ hội làm việc gì đó.', { exact: true })).toBeVisible();
    await expect(history.locator('[data-record-id="search-0"] a').first()).toHaveAttribute('href', 'https://comic.test/chapter-0');
    await history.screenshot({ path: 'test-results/history-learning.png', fullPage: false });
    await history.emulateMedia({ colorScheme: 'dark' }); await history.screenshot({ path: 'test-results/history-dark.png' });
    await history.locator('#next').click(); await expect(history.locator('.history-result')).toHaveCount(3); await expect(history.locator('#page-number')).toHaveText('Trang 2 / 2');
    await history.locator('#query').fill('window of opportunity'); await history.getByRole('button', { name: 'Tìm kiếm', exact: true }).click();
    await expect(history.locator('#status')).toContainText('1 câu phù hợp'); await expect(history.locator('.match-context mark')).toHaveText('window of opportunity');
    await history.locator('#query').fill('you’ve'); await history.getByRole('button', { name: 'Tìm kiếm', exact: true }).click(); await expect(history.locator('#status')).toContainText('1 câu phù hợp');
    await history.locator('#query').fill('NONEXISTENT'); await history.getByRole('button', { name: 'Tìm kiếm', exact: true }).click(); await expect(history.locator('#status')).toContainText('Không tìm thấy');
    await history.locator('#query').fill('GOT   A SHOT'); await history.getByRole('button', { name: 'Tìm kiếm', exact: true }).click(); await expect(history.locator('#status')).toContainText('23 câu phù hợp');
    await options.evaluate(async () => {
      const key = 'translationV2:search-22', values = await chrome.storage.local.get<Record<string, TranslationRecord>>(key);
      values[key].result.segments[0] = { source: 'A different expression.', translation: '' };
      await chrome.storage.local.set(values); // Update the record without changing the index.
    });
    await expect(history.locator('#status')).toContainText('22 câu phù hợp');
    await background({ type: 'CLEAR_ALL' }); await expect(history.locator('#status')).toContainText('Chưa có lịch sử'); await expect(history.locator('.history-result')).toHaveCount(0);
    expect(await calls()).toHaveLength(1);
  } finally { await history.close(); }
});

test('unlimited history preserves over 500 cards and over the default storage quota when saving new translations', async () => {
  await options.evaluate(async () => {
    const values: Record<string, unknown> = {}, index = [];
    for (let i = 0; i < 502; i++) {
      const item: TranslationRecord = { version: 2, id: `long-term-${i}`, pageUrl: 'https://archive.test/old', anchor: { kind: 'page', documentToken: 'p', rect: { x: 1, y: 1, width: 40, height: 40 } }, methodId: 'local-ocr', model: '', sourceLang: 'English', targetLang: 'Vietnamese', mode: 'quick', promptVersion: 'v1', createdAt: i, updatedAt: i,
        result: { kind: 'ocr', segments: [{ source: i === 501 ? 'x'.repeat(11 * 1024 * 1024) : `Old sentence ${i}`, translation: '' }], warnings: [] } };
      values[`translationV2:${item.id}`] = item; index.push({ id: item.id, pageUrl: item.pageUrl, createdAt: i, bytes: JSON.stringify(item).length });
    }
    await chrome.storage.local.set({ ...values, recordIndexV2: index });
  });
  await translate(); expect((await stats()).count).toBe(503); expect((await stats()).bytes).toBeGreaterThan(10 * 1024 * 1024);
  expect(await options.evaluate(async () => (await chrome.storage.local.get<Record<string, TranslationRecord>>('translationV2:long-term-0'))['translationV2:long-term-0'].result.segments[0].source)).toBe('Old sentence 0');
  await options.reload(); await expect(options.locator('#storage-stats')).toContainText('503 thẻ'); await expect(options.locator('#storage-stats')).toContainText('Không tự dọn');
  await expect(options.locator('#config-apiKey')).toHaveValue('FAKE_TEST_KEY_NOT_A_REAL_CREDENTIAL');
});

test('quick Gemini sends lower thinking and no learning schema, and accepts wrapped complete JSON in one call', async () => {
  const original: any = await background({ type: 'GET_SETTINGS' });
  try {
    await background({ type: 'SAVE_SETTINGS', settings: { ...original, methodId: 'gemini-image', mode: 'quick', methods: { ...original.methods, 'gemini-image': { ...original.methods['gemini-image'], model: 'gemini-3.8-flash' } } } });
    await configureMock({ quickEnvelope: true }); await translate();
    const sent = await calls(); expect(sent).toHaveLength(1);
    expect(sent[0].body.generation_config).toEqual({ thinking_level: 'low' });
    expect(sent[0].body.response_format.schema.properties.segments.items.properties.learning).toBeUndefined();
    expect(sent[0].body.generation_config.max_output_tokens).toBeUndefined();
    const saved = (await records())[0]; expect(saved.mode).toBe('quick'); expect(saved.result.segments[0].learning).toBeUndefined();
    await expect.poll(cardText).toContain('Dịch nhanh'); expect(await cardText()).not.toContain('Tách cụm');
  } finally { await background({ type: 'SAVE_SETTINGS', settings: original }); }
});

test('three regions survive scrolling and reload; a nearby selection offers saved/new explicitly', async () => {
  for (const y of [0, 720, 1440]) { await translate(y); await expect.poll(async () => (await stats()).count).toBe([0,720,1440].indexOf(y) + 1); }
  expect(await calls()).toHaveLength(3);
  await comic.evaluate(() => scrollTo(0, 0)); await expect.poll(cardText).toContain('Long Vương');
  await start(); await drag(94, 103); await expect.poll(text).toContain('Xem bản đã lưu'); await click('Xem bản đã lưu'); expect(await calls()).toHaveLength(3);
  await comic.reload(); await expect(comic.locator('#comic-lens-root')).toHaveCount(0);
  await background({ type: 'RESTORE' }); await expect.poll(cardText).toContain('Long Vương'); expect(await calls()).toHaveLength(3); expect((await stats()).count).toBe(3);
  await expect(options.locator('#storage-stats')).toContainText('3 thẻ');
});

test('anchors track layout shifts, resizing, zoom and image loading without matching another source URL', async () => {
  await translate();
  await comic.evaluate(() => { document.querySelector<HTMLElement>('#above')!.style.height = '230px'; document.querySelector<HTMLImageElement>('#comic')!.style.width = '520px'; });
  const checkAnchor = async () => {
    const saved = (await records())[0];
    const expected = await comic.locator('#comic').evaluate((el, rect) => el.getBoundingClientRect().top + scrollY + el.getBoundingClientRect().height * rect.y, saved.anchor.rect);
    const actual = await shadow<number>('function(){return parseFloat(this.querySelector(".card").style.top)}');
    return Math.abs((actual ?? -9999) - Math.max(8, expected - 180));
  };
  await expect.poll(checkAnchor).toBeLessThan(2);
  const tabId = await options.evaluate(async url => (await chrome.tabs.query({})).find(t => t.url === url)!.id!, comicUrl);
  for (const zoom of [.8, 1.25, 1]) { await options.evaluate(async ({ tabId, zoom }) => chrome.tabs.setZoom(tabId, zoom), { tabId, zoom }); await expect.poll(checkAnchor).toBeLessThan(2); }
  await comic.locator('#comic').evaluate((el: HTMLImageElement) => { el.src = '/page.svg?chapter=OTHER'; });
  await expect.poll(text).toContain('Bản dịch chưa gắn ảnh (1)');
  await comic.locator('#comic').evaluate((el: HTMLImageElement) => { el.src = '/page.svg?chapter=1'; });
  await expect.poll(cardText).toContain('Long Vương'); expect(await calls()).toHaveLength(1);
});

test('narrow screens use movable floating cards; hide and marker restore without deleting', async () => {
  await translate(); await comic.setViewportSize({ width: 800, height: 900 });
  await expect.poll(async () => shadow('function(){return this.querySelector(".card").dataset.placement}')).toBe('floating');
  await click('Ẩn'); await expect.poll(async () => shadow('function(){return this.querySelectorAll(".card").length}')).toBe(0);
  expect((await stats()).count).toBe(1);
  await shadow('function(){this.querySelector(".marker").click()}'); await expect.poll(cardText).toContain('Long Vương');
  const before = await shadow<number>('function(){return parseFloat(this.querySelector(".card").style.top)}');
  await shadow('function(){this.querySelector(".card header").dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",bubbles:true}))}');
  await expect.poll(async () => await shadow<number>('function(){return parseFloat(this.querySelector(".card").style.top)}')).toBe(before! + 10);
  expect(await calls()).toHaveLength(1); await comic.setViewportSize({ width: 1200, height: 900 });
});

test('number markers can open a virtualized card displaced by many nearby regions', async () => {
  await translate(); const base = (await records())[0];
  await background({ type: 'CLEAR_ALL' });
  // Seed a dense chapter fixture; actual region rendering and restoration use the shipped code.
  await options.evaluate(async base => {
    const index: object[] = [], values: Record<string, unknown> = {};
    for (let i = 0; i < 8; i++) {
      const record = { ...base, id: `dense-${i}`, createdAt: base.createdAt + i, anchor: { ...base.anchor, rect: { ...base.anchor.rect, y: .03 + i * .012 } } };
      values[`translationV2:${record.id}`] = record; index.push({ id: record.id, pageUrl: record.pageUrl, createdAt: record.createdAt, bytes: JSON.stringify(record).length + 128 });
    }
    await chrome.storage.local.set({ ...values, recordIndexV2: index });
  }, base);
  await background({ type: 'RESTORE' });
  await expect.poll(async () => shadow('function(){return this.querySelectorAll(".marker").length}')).toBe(8);
  expect(await shadow<number>('function(){return this.querySelectorAll(".card").length}')).toBeLessThan(8);
  await shadow('function(){this.querySelector(".marker[data-record-id=dense-7]").click()}');
  await expect.poll(async () => shadow('function(){const e=this.querySelector(".card[data-record-id=dense-7]");if(!e)return false;const r=e.getBoundingClientRect();return r.top<innerHeight&&r.bottom>0}')).toBe(true);
  expect((await stats()).count).toBe(8); expect(await calls()).toHaveLength(1);
});

test('canvas results become unmatched after reload and can be rebound with no API call', async () => {
  await comic.locator('#canvas').scrollIntoViewIfNeeded(); const box = await comic.locator('#canvas').boundingBox();
  await start(); await drag(box!.x + 20, box!.y + 20, 350, 120); await expect.poll(cardText).toContain('Long Vương');
  expect((await records())[0].anchor.kind).toBe('page');
  await comic.reload(); await background({ type: 'RESTORE' }); await expect.poll(text).toContain('Bản dịch chưa gắn ảnh (1)');
  await configureMock({}); await click('Xem bản đã lưu'); await expect.poll(cardText).toContain('Long Vương');
  await comic.evaluate(() => scrollTo(0, 0)); await click('Gắn lại'); await drag();
  await expect.poll(async () => (await records())[0].anchor.kind).toBe('image'); expect(await calls()).toHaveLength(0); expect((await stats()).count).toBe(1);
});

test('HTML from the provider is rendered as text in both source and translation', async () => {
  await configureMock({ unsafe: true }); await translate();
  expect(await cardText()).toContain('<script>alert(1)</script>');
  expect(await shadow('function(){return this.querySelectorAll(".card img,.card script").length}')).toBe(0);
});

test('clear all, page delete and single-record delete stop pending results from resurrecting', async () => {
  for (const operation of ['CLEAR_ALL', 'CLEAR_PAGE', 'DELETE_RECORD']) {
    await configureMock({ delay: 0 }); await translate(); const saved = (await records())[0];
    await configureMock({ delay: 1000 }); await click('Dịch lại', saved.id); await expect.poll(async () => (await calls()).length).toBe(1);
    if (operation === 'DELETE_RECORD') await click('Xóa bản dịch', saved.id);
    else await background({ type: operation, ...(operation === 'CLEAR_PAGE' ? { pageUrl: comicUrl } : {}) });
    await expect.poll(async () => (await stats()).count).toBe(0);
    await new Promise(r => setTimeout(r, 1100)); expect((await stats()).count).toBe(0);
    expect((await background<any>({ type: 'GET_SETTINGS' })).methods['gemini-image'].apiKey).toBe('FAKE_TEST_KEY_NOT_A_REAL_CREDENTIAL');
  }
});

test('cancel, quota and malformed learning preserve valid previous translations', async () => {
  await translate(); const saved = (await records())[0];
  await configureMock({ status: 429 }); await click('Dịch lại', saved.id); await expect.poll(cardText).toContain('hạn mức'); expect((await stats()).count).toBe(1);
  await configureMock({ status: 200, malformed: true }); await click('Dịch lại', saved.id); await expect.poll(cardText).toContain('sai định dạng'); expect((await records())[0].result.segments[0].translation).toContain('Long Vương');
  await configureMock({ malformed: false, brokenLearning: true }); await click('Dịch lại', saved.id); await expect.poll(cardText).toContain('giải thích chưa sẵn sàng'); expect((await stats()).count).toBe(1);
  await configureMock({ brokenLearning: false, delay: 1000 }); await click('Dịch lại', saved.id); await expect.poll(async () => (await calls()).length).toBe(1); await click('Hủy lượt dịch', saved.id); await expect.poll(text).toContain('Đã hủy');
  await new Promise(r => setTimeout(r, 1100)); expect((await stats()).count).toBe(1);
});

test('Escape, scrolling and navigation cancel unsent or pending captures', async () => {
  await start(); await comic.keyboard.press('Escape'); await start(); await comic.evaluate(() => scrollTo(0, 300));
  await expect.poll(async () => shadow('function(){return this.querySelectorAll(".selection").length}')).toBe(0); expect(await calls()).toHaveLength(0);
  await comic.evaluate(() => scrollTo(0, 0)); await configureMock({ delay: 1000 }); await start(); await drag(); await expect.poll(async () => (await calls()).length).toBe(1);
  await comic.reload(); await new Promise(r => setTimeout(r, 1100)); expect((await stats()).count).toBe(0); await expect(comic.locator('#comic-lens-root')).toHaveCount(0);
});

test('settings persist mode, languages and model; connection diagnostics and clear button work', async () => {
  await translate(); await options.bringToFront(); await options.reload(); await options.emulateMedia({ colorScheme: 'dark' });
  await configureMock({ status: 400 }); await options.getByRole('button', { name: 'Kiểm tra kết nối', exact: true }).click(); await expect(options.locator('#status')).toContainText('HTTP 400');
  await configureMock({ status: 200 }); await options.getByRole('button', { name: 'Kiểm tra kết nối', exact: true }).click(); await expect(options.locator('#status')).toContainText('Kết nối thành công'); expect(await calls()).toHaveLength(1);
  await configureMock({ delay: 1000 }); await options.getByRole('button', { name: 'Kiểm tra kết nối', exact: true }).click(); await expect.poll(async () => (await calls()).length).toBe(1);
  await background({ type: 'CLEAR_ALL' }); await expect(options.getByRole('button', { name: 'Kiểm tra kết nối', exact: true })).toBeEnabled(); await expect(options.locator('#status')).toContainText('Đã hủy');
  await configureMock({ delay: 0 });
  await options.locator('#mode').selectOption('quick'); await options.locator('#source').selectOption('Auto-detect'); await options.locator('#target').selectOption('Japanese'); await options.locator('#config-model').selectOption('gemini-3.5-flash-lite');
  await options.getByRole('button', { name: 'Lưu cài đặt', exact: true }).click(); await options.reload(); await expect(options.locator('#mode')).toHaveValue('quick'); await expect(options.locator('#target')).toHaveValue('Japanese');
  await options.screenshot({ path: 'test-results/v2-settings-dark.png', fullPage: true });
  options.once('dialog', dialog => dialog.accept()); await options.getByRole('button', { name: 'Xóa toàn bộ dữ liệu đã lưu', exact: true }).click(); await expect(options.locator('#storage-stats')).toContainText('0 thẻ'); await expect(options.locator('#config-apiKey')).not.toHaveValue('');
});

test('translations survive a full Brave restart without image bytes or API calls on restore', async () => {
  await translate(); expect((await stats()).count).toBe(1); const keyBefore = (await background<any>({ type: 'GET_SETTINGS' })).methods['gemini-image'].apiKey;
  await context.close(); await launch(); await configureMock({}); await comic.bringToFront();
  await background({ type: 'RESTORE' }); await expect.poll(cardText).toContain('Long Vương'); expect(await calls()).toHaveLength(0);
  expect((await background<any>({ type: 'GET_SETTINGS' })).methods['gemini-image'].apiKey).toBe(keyBefore);
  const saved = await records(); expect(saved).toHaveLength(1); expect(JSON.stringify(saved)).not.toContain('base64'); expect(saved[0].result.segments[0].learning?.chunks.length).toBeGreaterThan(0);
});
