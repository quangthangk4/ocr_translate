import '../../src/ui/shared.css';
import { methodCatalog } from '../../src/methods/catalog';
import { send } from '../../src/protocol';
import type { Settings, TranslationMode } from '../../src/types';

const method = document.querySelector<HTMLSelectElement>('#method')!;
const status = document.querySelector<HTMLElement>('#status')!;
const model = document.querySelector<HTMLElement>('#model')!;
const modelSelect = document.querySelector<HTMLSelectElement>('#gemini-model')!;
const modelField = document.querySelector<HTMLElement>('#model-field')!;
const translationMode = document.querySelector<HTMLSelectElement>('#mode')!;
const buttons = [...document.querySelectorAll<HTMLButtonElement>('.actions button')];
let settings: Settings;
let modelSave: Promise<void> = Promise.resolve(), modelSaveError: unknown;
function report(error: unknown) { status.classList.add('error'); status.textContent = (error as Error)?.message ?? 'Không tải được extension.'; }
async function init() {
  settings = await send<Settings>({ target: 'background', type: 'GET_SETTINGS' });
  for (const item of methodCatalog) { const option = new Option(item.label, item.id); method.append(option); }
  method.value = settings.methodId;
  translationMode.value = settings.mode;
  const update = () => {
    const ocr = methodCatalog.find(m => m.id === method.value)?.kind === 'ocr';
    model.textContent = ocr ? method.value === 'windows-ocr' ? 'Tiếng Anh · Cần cài cầu nối Windows OCR' : 'Tiếng Anh · Xử lý trên máy · Không cần API key' : '';
    modelField.hidden = method.value !== 'gemini-image';
    if (!modelField.hidden) {
      const field = methodCatalog.find(m => m.id === method.value)?.fields.find(f => f.key === 'model');
      const current = settings.methods[method.value]?.model || field?.defaultValue || '';
      modelSelect.replaceChildren(...[...new Set([...(field?.suggestions ?? []), current].filter(Boolean))].map(id => new Option(id, id)));
      modelSelect.value = current;
    }
    translationMode.closest<HTMLElement>('.field')!.hidden = ocr;
    document.querySelector('#region')!.firstChild!.textContent = ocr ? 'Khoanh vùng lấy chữ' : 'Khoanh vùng để dịch';
    document.querySelector('#viewport')!.firstChild!.textContent = ocr ? 'Lấy chữ khung nhìn' : 'Dịch khung nhìn';
    document.querySelector('#viewport small')!.textContent = ocr ? 'Chỉ trích xuất chữ tiếng Anh, không dịch' : 'Dịch phần trang bạn đang thấy';
  };
  update(); method.addEventListener('change', update);
  modelSelect.addEventListener('change', () => {
    const methodId = method.value, selected = modelSelect.value;
    settings.methods[methodId].model = selected; modelSaveError = undefined; modelSelect.disabled = true;
    status.classList.remove('error'); status.textContent = 'Đang lưu model…';
    modelSave = send({ target: 'background', type: 'SET_MODEL', methodId, model: selected })
      .then(() => { status.classList.remove('error'); status.textContent = `Đã chọn ${selected}.`; })
      .catch(error => { modelSaveError = error; report(error); })
      .finally(() => { modelSelect.disabled = false; });
  });
  const { shortcutError } = await chrome.storage.session.get('shortcutError');
  if (shortcutError) { report(shortcutError); await chrome.storage.session.remove('shortcutError'); }
  await chrome.action.setBadgeText({ text: '' });
  // Opening the toolbar popup is a user gesture granting activeTab; restoration needs no API key.
  try { const restored = await send<{ count: number }>({ target: 'background', type: 'RESTORE' }); if (restored.count) status.textContent = `Đã hiện ${restored.count} bản dịch của trang này.`; }
  catch { /* Internal Brave pages cannot host the reader. */ }
}
for (const mode of ['region', 'viewport'] as const) document.querySelector(`#${mode}`)!.addEventListener('click', async () => {
  buttons.forEach(b => { b.disabled = true; }); status.textContent = 'Đang mở công cụ chụp…'; status.classList.remove('error');
  try { await modelSave; if (modelSaveError && method.value === 'gemini-image') throw modelSaveError; await send({ target: 'background', type: 'START', mode, methodId: method.value, translationMode: translationMode.value as TranslationMode }); window.close(); }
  catch (e) { report(e); buttons.forEach(b => { b.disabled = false; }); }
});
document.querySelector('#options')!.addEventListener('click', () => { void send({ target: 'background', type: 'OPEN_OPTIONS' }).catch(report); });
document.querySelector('#restore')!.addEventListener('click', async () => {
  try { const restored = await send<{ count: number }>({ target: 'background', type: 'RESTORE' }); status.classList.remove('error'); status.textContent = restored.count ? `Đã hiện ${restored.count} bản dịch.` : 'Trang này chưa có bản dịch đã lưu.'; }
  catch (error) { report(error); }
});
buttons.forEach(b => { b.disabled = true; });
void init().then(() => buttons.forEach(b => { b.disabled = false; })).catch(report);
