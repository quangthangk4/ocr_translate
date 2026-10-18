import { afterEach, describe, expect, it, vi } from 'vitest';
import { pixelRect } from '../src/image';
import { defaultSettings } from '../src/methods/catalog';
import { extractOutput, geminiHttpError, geminiMethod, parseTranslation } from '../src/methods/gemini';
import { createRegistry } from '../src/methods/registry';
import { AppError, failure } from '../src/errors';
import type { TranslationMethod, TranslationResult } from '../src/types';

const result: TranslationResult = { segments: [{ source: 'Wait!', translation: 'Đợi đã!' }], warnings: [] };
const interaction = (text: string) => ({ status: 'completed', steps: [{ type: 'thought', content: [{ type: 'text', text: 'Do not expose thoughts' }] }, { type: 'model_output', content: [{ type: 'text', text }] }] });
const input = { image: { base64: 'png-bytes', mimeType: 'image/png' as const }, sourceLang: 'English', targetLang: 'Vietnamese' };
const context = () => ({ config: { apiKey: 'test-secret-never-log', model: 'gemini-3.8-flash' }, signal: new AbortController().signal });
afterEach(() => vi.unstubAllGlobals());

describe('capture coordinates', () => {
  it.each([0.8, 1, 1.25, 2])('uses screenshot dimensions at scale %s rather than assuming DPR', scale => {
    expect(pixelRect({ x: 100, y: 50, width: 200, height: 100 }, { width: 1000, height: 800, scrollX: 0, scrollY: 900 }, 1000 * scale, 800 * scale)).toEqual({ x: Math.round(100 * scale), y: Math.round(50 * scale), width: Math.round(200 * scale), height: Math.round(100 * scale) });
  });
  it.each([{ x: -1, y: 0, width: 20, height: 20 }, { x: 0, y: 0, width: 2, height: 20 }, { x: 990, y: 0, width: 30, height: 20 }, { x: NaN, y: 0, width: 20, height: 20 }])('rejects invalid or out-of-bounds regions', rect => {
    expect(() => pixelRect(rect, { width: 1000, height: 800, scrollX: 0, scrollY: 0 }, 1000, 800)).toThrow(AppError);
  });
});
describe('Gemini response validation', () => {
  it('extracts only final model output from current REST steps', () => expect(extractOutput(interaction('hello'))).toBe('hello'));
  it.each(['incomplete', 'failed', 'requires_action'])('rejects %s instead of rendering partial dialogue', status => expect(() => extractOutput({ ...interaction('{}'), status })).toThrow(AppError));
  it('rejects malformed segment shapes', () => expect(() => parseTranslation({ segments: [{ source: 'x', translation: 5 }], warnings: [] })).toThrow(AppError));
  it('passes valid bilingual strings through as data', () => expect(parseTranslation({ segments: [{ source: '<img onerror="evil()">', translation: 'Chữ trong truyện' }], warnings: [] }).segments[0].source).toContain('<img'));
  it('sends inline image once, stateless, with the selected model and no agent', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(interaction(JSON.stringify(result))))); vi.stubGlobal('fetch', fetch);
    expect(await geminiMethod.translate(input, context())).toEqual(result);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0]; const body = JSON.parse(options.body);
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
    expect(body).toMatchObject({ store: false, model: 'gemini-3.8-flash', response_format: { mime_type: 'application/json' } });
    expect(body.agent).toBeUndefined(); expect(body.input[1]).toMatchObject({ data: 'png-bytes', type: 'image' });
  });
  it.each([[401, 'AUTH'], [403, 'AUTH'], [404, 'MODEL'], [429, 'QUOTA'], [503, 'NETWORK']])('maps HTTP %s without retrying or exposing response secrets', async (status, code) => {
    const fetch = vi.fn().mockResolvedValue(new Response('secret provider diagnostics', { status: Number(status) })); vi.stubGlobal('fetch', fetch);
    await expect(geminiMethod.translate(input, context())).rejects.toMatchObject({ code }); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('distinguishes network, malformed JSON and no text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('failed')));
    await expect(geminiMethod.translate(input, context())).rejects.toMatchObject({ code: 'NETWORK' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(interaction('{broken')))));
    await expect(geminiMethod.translate(input, context())).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(interaction('{"segments":[],"warnings":[]}')))));
    await expect(geminiMethod.translate(input, context())).rejects.toMatchObject({ code: 'NO_TEXT' });
  });
  it('recognizes an invalid API key returned as HTTP 400', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":{"details":[{"reason":"API_KEY_INVALID"}]}}', { status: 400 })));
    await expect(geminiMethod.translate(input, context())).rejects.toMatchObject({ code: 'AUTH' });
  });
  it('keeps API 400 separate from missing configuration and preserves redacted diagnostics', async () => {
    const config = context().config;
    const error = geminiHttpError(400, { error: { status: 'INVALID_ARGUMENT', message: `Model not supported. key ${config.apiKey} https://example.test/?key=private` } }, config);
    const shown = failure(error);
    expect(shown.code).toBe('API_REQUEST');
    expect(shown.message).toContain('HTTP 400 INVALID_ARGUMENT');
    expect(shown.message).toContain('Model not supported');
    expect(shown.message).not.toContain(config.apiKey);
    expect(shown.message).not.toContain('key=private');
    expect(shown.message).not.toContain('Chưa cấu hình đầy đủ');
  });
  it('does not make a request when the API key is actually missing', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(geminiMethod.testConnection({ ...context(), config: { apiKey: '', model: 'gemini-3.8-flash' } })).rejects.toMatchObject({ code: 'CONFIG', message: expect.stringContaining('API key') });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([['timeout', 'TIMEOUT'], ['cancel', 'CANCELLED']])('recognizes abort reason %s', async (reason, code) => {
    const controller = new AbortController(); controller.abort(reason);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')));
    await expect(geminiMethod.translate(input, { ...context(), signal: controller.signal })).rejects.toMatchObject({ code });
  });
});
describe('extension points', () => {
  it('registers a new adapter without changing the capture/result contracts', async () => {
    const fake: TranslationMethod = { descriptor: { id: 'fake', label: 'OCR local', fields: [], promptVersion: '1' }, translate: async () => result, testConnection: async () => {} };
    const registry = createRegistry([geminiMethod, fake]); expect(registry.list().map(m => m.id)).toEqual(['gemini-image', 'fake']);
    expect(await registry.get('fake').translate(input, context())).toEqual(result);
    expect(() => createRegistry([fake, fake])).toThrow();
  });
  it('never puts unknown exception text into a user-facing failure', () => expect(failure(new Error('API key abc'))).not.toHaveProperty('message', 'API key abc'));
});
