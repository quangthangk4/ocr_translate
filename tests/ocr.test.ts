import { afterEach, describe, expect, it, vi } from 'vitest';
const { createWorker } = vi.hoisted(() => ({ createWorker: vi.fn() }));
vi.mock('tesseract.js', () => ({ createWorker, OEM: { LSTM_ONLY: 1 }, PSM: { SPARSE_TEXT: '11' } }));
import { localOcrMethod, ocrResult } from '../src/methods/local-ocr';
import { defaultSettings, normalizeSettings } from '../src/methods/catalog';
import { OCR_CHARACTERS, plainOcrText, sentenceInitials } from '../src/ocr-text';

afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });
const input = { image: { mimeType: 'image/png' as const, base64: 'image-bytes' }, sourceLang: 'English', targetLang: 'Vietnamese' };
function setup() {
  vi.stubGlobal('chrome', { runtime: { getURL: (path: string) => `chrome-extension://test${path}` } });
  const worker = { setParameters: vi.fn().mockResolvedValue(undefined), recognize: vi.fn().mockResolvedValue({ data: { text: '  FAR STRONGER\r\nTHAN BEFORE.  ', confidence: 90 } }), terminate: vi.fn().mockResolvedValue(undefined) };
  createWorker.mockResolvedValue(worker); return worker;
}
describe('local OCR', () => {
  it('is selectable without an API key while preserving Gemini credentials', () => {
    const settings = defaultSettings(); settings.methodId = 'local-ocr'; settings.methods['gemini-image'].apiKey = 'keep-secret';
    expect(normalizeSettings(settings)).toMatchObject({ methodId: 'local-ocr', methods: { 'local-ocr': {}, 'gemini-image': { apiKey: 'keep-secret' } } });
  });
  it('loads only packaged resources, extracts text without translating and terminates image memory', async () => {
    const worker = setup(); vi.stubGlobal('fetch', vi.fn(() => { throw Error('No network allowed'); }));
    const result = await localOcrMethod.translate(input, { config: {}, signal: new AbortController().signal });
    expect(result).toEqual({ kind: 'ocr', segments: [{ source: 'Far stronger than before.', translation: '' }], warnings: [] });
    expect(worker.setParameters).toHaveBeenCalledWith(expect.objectContaining({ tessedit_char_whitelist: OCR_CHARACTERS }));
    expect(createWorker).toHaveBeenCalledWith('eng', 1, expect.objectContaining({ workerPath: 'chrome-extension://test/ocr/worker.min.js', corePath: 'chrome-extension://test/ocr', langPath: 'chrome-extension://test/ocr', workerBlobURL: false, cacheMethod: 'none' }));
    expect(worker.recognize.mock.calls[0][0]).toBe('data:image/png;base64,image-bytes');
    expect(worker.terminate).toHaveBeenCalledTimes(1); expect(fetch).not.toHaveBeenCalled();
  });
  it('distinguishes empty text, low confidence and an unsupported source language', async () => {
    expect(() => ocrResult('  \n', 99)).toThrow(expect.objectContaining({ code: 'NO_TEXT' }));
    expect(ocrResult('hello', 20).warnings).toHaveLength(1);
    await expect(localOcrMethod.translate({ ...input, sourceLang: 'Japanese' }, { config: {}, signal: new AbortController().signal })).rejects.toMatchObject({ code: 'CONFIG' });
    expect(createWorker).not.toHaveBeenCalled();
  });
  it('does not initialize after cancellation; terminates recognition on abort', async () => {
    const worker = setup(), controller = new AbortController(); controller.abort();
    await expect(localOcrMethod.translate(input, { config: {}, signal: controller.signal })).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(createWorker).not.toHaveBeenCalled();
    worker.recognize.mockImplementation(() => new Promise(() => {}));
    const next = new AbortController(); const task = localOcrMethod.translate(input, { config: {}, signal: next.signal });
    const assertion = expect(task).rejects.toMatchObject({ code: 'CANCELLED' });
    await vi.waitFor(() => expect(worker.recognize).toHaveBeenCalled()); next.abort(); await assertion;
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
  it('cleans up an initialization completing after timeout, without recognizing its image', async () => {
    const worker = setup(); let finish!: (value: typeof worker) => void;
    createWorker.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const controller = new AbortController(); const task = localOcrMethod.translate(input, { config: {}, signal: controller.signal });
    const assertion = expect(task).rejects.toMatchObject({ code: 'TIMEOUT' }); controller.abort('timeout'); await assertion;
    finish(worker); await vi.waitFor(() => expect(worker.terminate).toHaveBeenCalledTimes(1));
    expect(worker.recognize).not.toHaveBeenCalled();
  });
});

describe('OCR character filtering and sentence case', () => {
  it('cleans the reported noise without guessing the words', () => {
    expect(plainOcrText("I'VE DEVOTED HALF MY\n\nLIFE-TO GATE;HUNTER:=" )).toBe("I've devoted half my life-to gate hunter");
    expect(plainOcrText('HELLO | WORLD_ @#$')).toBe('Hello world');
    expect(() => ocrResult('|:=@#', 80)).toThrow(expect.objectContaining({ code: 'NO_TEXT' }));
  });
  it('capitalizes sentence starts, keeps contractions, numbers, decimals and useful punctuation', () => {
    const plain = plainOcrText('“I’VE WAITED 2.5 HOURS.”\n\nWHY?! I CAN’T WAIT... GO, NOW!');
    expect(plain).toBe('"I\'ve waited 2.5 hours." Why?! I can\'t wait... Go, now!');
    expect(sentenceInitials(plain).map(i => plain[i])).toEqual(['I', 'W', 'I', 'G']);
    expect(plainOcrText(plain)).toBe(plain);
  });
});
