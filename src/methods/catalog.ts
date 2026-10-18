import type { MethodDescriptor, Settings } from '../types';

export const languageOptions = [
  ['English', 'Tiếng Anh'], ['Vietnamese', 'Tiếng Việt'], ['Japanese', 'Tiếng Nhật'],
  ['Korean', 'Tiếng Hàn'], ['Simplified Chinese', 'Tiếng Trung (giản thể)'],
  ['Traditional Chinese', 'Tiếng Trung (phồn thể)'], ['Thai', 'Tiếng Thái'],
  ['French', 'Tiếng Pháp'], ['German', 'Tiếng Đức'], ['Spanish', 'Tiếng Tây Ban Nha'],
  ['Portuguese', 'Tiếng Bồ Đào Nha'], ['Italian', 'Tiếng Ý'], ['Russian', 'Tiếng Nga'],
  ['Indonesian', 'Tiếng Indonesia'], ['Malay', 'Tiếng Mã Lai'], ['Hindi', 'Tiếng Hindi'],
  ['Arabic', 'Tiếng Ả Rập'], ['Turkish', 'Tiếng Thổ Nhĩ Kỳ'],
] as const;

// Metadata only: safe to import into UI without bundling credentials or adapters.
export const methodCatalog: MethodDescriptor[] = [{
  id: 'gemini-image',
  label: 'Gemini — đọc ảnh trực tiếp',
  promptVersion: 'comic-v2-learning',
  fields: [
    { key: 'apiKey', label: 'Gemini API key', secret: true },
    { key: 'model', label: 'Model dịch ảnh', defaultValue: 'gemini-3.8-flash', suggestions: [
      'gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite', 'gemini-3.1-pro-preview',
      'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro',
    ] },
  ],
}, {
  id: 'local-ocr', label: 'OCR cục bộ — chỉ trích xuất chữ', kind: 'ocr',
  promptVersion: 'tesseract-eng-v3-clean-sentences', fields: [], sourceLanguages: ['English'],
}, {
  id: 'windows-ocr', label: 'Windows OCR — nhận chữ bằng Windows', kind: 'ocr',
  promptVersion: 'windows-eng-v1-clean-sentences', fields: [], sourceLanguages: ['English'],
}];

export const isOcrMethod = (id: string) => methodCatalog.find(m => m.id === id)?.kind === 'ocr';

export function defaultSettings(): Settings {
  return {
    methodId: methodCatalog[0].id, sourceLang: 'English', targetLang: 'Vietnamese', mode: 'learn',
    methods: Object.fromEntries(methodCatalog.map(method => [method.id, Object.fromEntries(method.fields.map(f => [f.key, f.defaultValue ?? '']))])),
  };
}

export function normalizeSettings(value: unknown): Settings {
  const defaults = defaultSettings();
  if (!value || typeof value !== 'object') return defaults;
  const v = value as Partial<Settings>;
  const methodId = methodCatalog.some(m => m.id === v.methodId) ? v.methodId! : defaults.methodId;
  const methods = { ...defaults.methods };
  for (const method of methodCatalog) {
    const stored = v.methods?.[method.id];
    methods[method.id] = Object.fromEntries(method.fields.map(field => [field.key, typeof stored?.[field.key] === 'string' ? stored[field.key].trim() : methods[method.id][field.key]]));
  }
  return { methodId, methods, mode: v.mode === 'quick' ? 'quick' : 'learn', sourceLang: typeof v.sourceLang === 'string' && v.sourceLang.trim() ? v.sourceLang.trim().slice(0, 80) : defaults.sourceLang, targetLang: typeof v.targetLang === 'string' && v.targetLang.trim() ? v.targetLang.trim().slice(0, 80) : defaults.targetLang };
}
