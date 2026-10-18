import '../../src/ui/shared.css';
import { languageOptions, methodCatalog, normalizeSettings } from '../../src/methods/catalog';
import { send } from '../../src/protocol';
import type { RecordStats, RunOutcome, Settings, TranslationMode } from '../../src/types';

const form = document.querySelector<HTMLFormElement>('#settings')!;
form.inert = true;
const method = document.querySelector<HTMLSelectElement>('#method')!;
const fields = document.querySelector<HTMLElement>('#method-fields')!;
const source = document.querySelector<HTMLSelectElement>('#source')!;
const target = document.querySelector<HTMLSelectElement>('#target')!;
const translationMode = document.querySelector<HTMLSelectElement>('#mode')!;
const status = document.querySelector<HTMLElement>('#status')!;
const test = document.querySelector<HTMLButtonElement>('#test')!;
let settings: Settings;
let testId = '';
let testingOcr = false;
let testingWindows = false;
function report(error: unknown) { status.classList.add('error'); status.textContent = (error as Error)?.message ?? 'Không lưu được cài đặt.'; }
function collect(): Settings {
  for (const input of fields.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-key]')) settings.methods[method.value][input.dataset.key!] = input.value.trim();
  return normalizeSettings({ ...settings, methodId: method.value, sourceLang: source.value, targetLang: target.value, mode: translationMode.value as TranslationMode });
}
function renderFields() {
  fields.replaceChildren();
  const descriptor = methodCatalog.find(m => m.id === method.value)!;
  const ocr = descriptor.kind === 'ocr';
  const windows = descriptor.id === 'windows-ocr';
  document.querySelector('#method-intro')!.textContent = ocr
    ? 'Nhận chữ tiếng Anh hoàn toàn trên máy. Không gửi ảnh ra ngoài, không cần API key. Bôi chọn văn bản kết quả để dùng extension dịch khác.'
    : 'Ảnh bạn chọn được gửi trực tiếp đến dịch vụ dịch bằng API key của bạn.';
  translationMode.closest<HTMLElement>('.field')!.hidden = ocr;
  target.closest<HTMLElement>('.field')!.hidden = ocr; target.disabled = ocr;
  for (const option of source.options) option.disabled = !!descriptor.sourceLanguages && !descriptor.sourceLanguages.includes(option.value);
  if (descriptor.sourceLanguages && !descriptor.sourceLanguages.includes(source.value)) source.value = descriptor.sourceLanguages[0];
  test.textContent = ocr ? 'Kiểm tra OCR cục bộ' : 'Kiểm tra kết nối';
  if (windows) test.textContent = 'Kiểm tra Windows OCR';
  document.querySelector('#test-note')!.textContent = ocr ? 'Chỉ nạp bộ nhận chữ trên máy. Không gọi API và không tốn lượt dịch.' : 'Kiểm tra kết nối dùng một lượt API với cấu hình đang nhập. Không tự gọi khi mở cài đặt.';
  if (windows) {
    document.querySelector('#method-intro')!.textContent = 'Nhận chữ tiếng Anh bằng Windows. Cài cầu nối một lần, sau đó ảnh và văn bản được chuyển tự động trên máy, không qua clipboard.';
    const help = document.createElement('p'); help.className = 'note';
    help.textContent = 'Cài cầu nối theo docs/WINDOWS_OCR.md hoặc hướng dẫn trong ZIP Windows OCR. ID extension của bạn: ';
    const id = document.createElement('code'); id.textContent = chrome.runtime.id; help.append(id);
    const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = 'Sao chép ID';
    copy.onclick = () => { void navigator.clipboard.writeText(chrome.runtime.id).then(() => { copy.textContent = 'Đã sao chép'; }).catch(report); };
    help.append(document.createTextNode(' '), copy); fields.append(help);
    document.querySelector('#test-note')!.textContent = 'Kiểm tra cầu nối và bộ nhận chữ tiếng Anh của Windows. Không gửi ảnh ra mạng, không dùng API key.';
  }
  for (const field of descriptor.fields) {
    const group = document.createElement('div'); group.className = 'field';
    const label = document.createElement('label'); label.htmlFor = `config-${field.key}`; label.textContent = field.label;
    if (field.suggestions && !field.secret) {
      const select = document.createElement('select'); select.id = label.htmlFor; select.dataset.key = field.key; select.required = true;
      for (const value of field.suggestions) select.append(new Option(value, value));
      const stored = settings.methods[descriptor.id][field.key];
      if (stored && !field.suggestions.includes(stored)) select.append(new Option(`${stored} (đã lưu trước đây)`, stored));
      select.value = stored || field.defaultValue || field.suggestions[0];
      const note = document.createElement('small'); note.textContent = 'Chọn model có quyền truy cập và hạn mức trong project của bạn. Danh sách này không đảm bảo model có quota Free.';
      group.append(label, select, note); fields.append(group); continue;
    }
    const input = document.createElement('input'); input.id = label.htmlFor; input.dataset.key = field.key; input.value = settings.methods[descriptor.id][field.key] ?? ''; input.type = field.secret ? 'password' : 'text'; input.autocomplete = 'off'; input.spellcheck = false;
    group.append(label);
    if (field.secret) {
      const row = document.createElement('div'); row.className = 'key-row';
      const reveal = document.createElement('button'); reveal.type = 'button'; reveal.textContent = 'Hiện'; reveal.setAttribute('aria-label', 'Hiện hoặc ẩn API key');
      reveal.onclick = () => { input.type = input.type === 'password' ? 'text' : 'password'; reveal.textContent = input.type === 'password' ? 'Hiện' : 'Ẩn'; };
      const erase = document.createElement('button'); erase.type = 'button'; erase.textContent = 'Xóa key';
      erase.onclick = async () => {
        input.value = ''; settings = collect();
        try { await send({ target: 'background', type: 'SAVE_SETTINGS', settings }); status.classList.remove('error'); status.textContent = 'Đã xóa API key đã lưu.'; }
        catch (e) { report(e); }
      };
      row.append(input, reveal, erase); group.append(row);
    } else group.append(input);
    fields.append(group);
  }
}
async function init() {
  settings = await send<Settings>({ target: 'background', type: 'GET_SETTINGS' });
  translationMode.value = settings.mode;
  source.append(new Option('Tự nhận diện ngôn ngữ', 'Auto-detect'));
  for (const [value, label] of languageOptions) {
    source.append(new Option(label, value)); target.append(new Option(label, value));
  }
  // Preserve existing configurations without requiring free-text fields.
  for (const [select, value] of [[source, settings.sourceLang], [target, settings.targetLang]] as const) {
    if (![...select.options].some(option => option.value === value)) select.append(new Option(`${value} (đã lưu trước đây)`, value));
  }
  for (const item of methodCatalog) method.append(new Option(item.label, item.id));
  method.value = settings.methodId; source.value = settings.sourceLang; target.value = settings.targetLang; renderFields();
  let previous = method.value;
  method.addEventListener('change', () => {
    // Preserve unsaved values when switching adapters.
    for (const input of fields.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-key]')) settings.methods[previous][input.dataset.key!] = input.value.trim();
    previous = method.value; renderFields();
  });
  await updateStats();
}
form.addEventListener('submit', async e => {
  e.preventDefault();
  try { settings = await send<Settings>({ target: 'background', type: 'SAVE_SETTINGS', settings: collect() }); status.classList.remove('error'); status.textContent = 'Đã lưu. Bạn có thể mở trang truyện và bắt đầu dịch.'; }
  catch (e) { report(e); }
});
test.addEventListener('click', async () => {
  testingWindows = method.value === 'windows-ocr';
  testingOcr = methodCatalog.find(m => m.id === method.value)?.kind === 'ocr';
  test.disabled = true; status.classList.remove('error'); status.textContent = testingOcr ? 'Đang kiểm tra bộ nhận chữ trên máy…' : 'Đang kiểm tra kết nối…';
  try { const result = await send<{ id: string }>({ target: 'background', type: 'TEST', settings: collect() }); testId = result.id; await updateTest(); }
  catch (e) { test.disabled = false; report(e); }
});
async function updateTest() {
  const { testStatus } = await chrome.storage.session.get<{ testStatus?: { id: string; state: string; outcome?: RunOutcome } }>('testStatus');
  if (testStatus?.id !== testId || testStatus.state !== 'done' || !testStatus.outcome) return;
  test.disabled = false;
  if ('error' in testStatus.outcome) report(testStatus.outcome.error);
  else { status.classList.remove('error'); status.textContent = testingWindows ? 'Windows OCR đã sẵn sàng. Nhớ lưu để dùng phương pháp này.' : testingOcr ? 'OCR cục bộ đã sẵn sàng. Không sử dụng API. Nhớ lưu nếu bạn đã đổi phương pháp.' : 'Kết nối thành công. Nhớ lưu nếu bạn đã thay cấu hình.'; }
}
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'session' && changes.testStatus) void updateTest(); if (area === 'local' && changes.recordIndexV2) void updateStats().catch(report); });
async function updateStats() {
  const stats = await send<RecordStats>({ target: 'background', type: 'STATS' });
  document.querySelector('#storage-stats')!.textContent = `${stats.count} / ${stats.maxCount} thẻ · ${(stats.bytes / 1024 / 1024).toFixed(2)} / 5 MB`;
  const pages = document.querySelector<HTMLSelectElement>('#saved-page')!;
  const current = pages.value; pages.replaceChildren();
  for (const page of stats.pages) pages.append(new Option(`${page.count} thẻ · ${page.url}`, page.url));
  if (stats.pages.some(p => p.url === current)) pages.value = current;
  if (!stats.count) pages.append(new Option('Chưa có bản dịch đã lưu', ''));
  document.querySelector<HTMLButtonElement>('#clear-page')!.disabled = !stats.count;
}
document.querySelector('#clear')!.addEventListener('click', async () => {
  if (!confirm('Xóa toàn bộ bản dịch và phần học đã lưu? API key và cài đặt vẫn được giữ.')) return;
  try { await send({ target: 'background', type: 'CLEAR_ALL' }); await updateStats(); document.querySelector('#cache-status')!.textContent = 'Đã xóa toàn bộ bản dịch đã lưu.'; }
  catch (e) { report(e); }
});
document.querySelector('#clear-page')!.addEventListener('click', async () => {
  const pageUrl = document.querySelector<HTMLSelectElement>('#saved-page')!.value;
  if (!pageUrl || !confirm('Xóa mọi bản dịch đã lưu của trang đã chọn?')) return;
  try { await send({ target: 'background', type: 'CLEAR_PAGE', pageUrl }); await updateStats(); document.querySelector('#cache-status')!.textContent = 'Đã xóa dữ liệu trang đã chọn.'; }
  catch (error) { report(error); }
});
void init().then(() => { form.inert = false; }).catch(report);
