import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestWindowsOcr, WINDOWS_HOST } from '../src/native/windows-client';
import { windowsOcrMethod } from '../src/methods/windows-ocr';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
function setup() {
  const message = new Set<(value: unknown) => void>(), disconnect = new Set<() => void>();
  const port = {
    onMessage: { addListener: (fn: (v: unknown) => void) => message.add(fn), removeListener: (fn: (v: unknown) => void) => message.delete(fn) },
    onDisconnect: { addListener: (fn: () => void) => disconnect.add(fn), removeListener: (fn: () => void) => disconnect.delete(fn) },
    postMessage: vi.fn(), disconnect: vi.fn(),
  };
  const connectNative = vi.fn(() => port);
  vi.stubGlobal('chrome', { runtime: { connectNative, lastError: undefined } });
  const emit = (fields: object) => { const request = port.postMessage.mock.calls[0][0]; for (const fn of message) fn({ version: 1, id: request.id, ok: true, engine: 'Windows.Media.Ocr', text: 'HELLO WORLD.', ...fields }); };
  return { port, connectNative, emit, disconnect: () => { for (const fn of [...disconnect]) fn(); } };
}
const image = { mimeType: 'image/png' as const, base64: 'aGVsbG8=' };
describe('Windows native bridge', () => {
  it('sends only the cropped image over the fixed host, validates its response and disconnects', async () => {
    const mock = setup(); const task = requestWindowsOcr({ operation: 'recognize', image }, new AbortController().signal);
    expect(mock.connectNative).toHaveBeenCalledWith(WINDOWS_HOST);
    expect(mock.port.postMessage.mock.calls[0][0]).toEqual({ version: 1, id: expect.any(String), command: 'recognize', language: 'en', image });
    mock.emit({ resized: true }); await expect(task).resolves.toEqual({ text: 'HELLO WORLD.', resized: true }); expect(mock.port.disconnect).toHaveBeenCalledTimes(1);
  });
  it.each([['SETUP','WINDOWS_SETUP'], ['LANGUAGE','WINDOWS_LANGUAGE'], ['INVALID_IMAGE','INVALID_CAPTURE'], ['INTERNAL','OCR']])('maps native %s without exposing native diagnostics', async (code, expected) => {
    const mock = setup(); const task = requestWindowsOcr({ operation: 'ping' }, new AbortController().signal);
    mock.emit({ ok: false, code, message: 'secret native diagnostics' }); await expect(task).rejects.toMatchObject({ code: expected, message: expect.not.stringContaining('secret') });
  });
  it('rejects mismatched responses and maps missing/forbidden hosts to setup instructions', async () => {
    let mock = setup(); let task = requestWindowsOcr({ operation: 'ping' }, new AbortController().signal);
    mock.emit({ id: 'another-job' }); await expect(task).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    mock = setup(); task = requestWindowsOcr({ operation: 'ping' }, new AbortController().signal);
    mock.disconnect(); await expect(task).rejects.toMatchObject({ code: 'WINDOWS_SETUP' });
  });
  it('disconnects promptly on cancel or timeout; rejects bad images before connecting', async () => {
    const mock = setup(), controller = new AbortController();
    const task = requestWindowsOcr({ operation: 'ping' }, controller.signal); controller.abort();
    await expect(task).rejects.toMatchObject({ code: 'CANCELLED' }); expect(mock.port.disconnect).toHaveBeenCalledTimes(1);
    expect(() => requestWindowsOcr({ operation: 'recognize', image: { ...image, base64: '<invalid>' } }, controller.signal)).toThrow();
    vi.useFakeTimers(); const timed = requestWindowsOcr({ operation: 'ping' }, new AbortController().signal);
    const assertion = expect(timed).rejects.toMatchObject({ code: 'TIMEOUT' }); await vi.advanceTimersByTimeAsync(300_000); await assertion;
  });
  it('adapter delegates through background messaging and normalizes selectable text', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true, data: { text: 'HELLO | WORLD.\nGO!', resized: false } });
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    const result = await windowsOcrMethod.translate({ image, sourceLang: 'English', targetLang: 'Vietnamese' }, { config: {}, signal: new AbortController().signal, jobId: 'owned-job' });
    expect(sendMessage).toHaveBeenCalledWith({ target: 'background', type: 'WINDOWS_OCR', jobId: 'owned-job', request: { operation: 'recognize', image } });
    expect(result).toMatchObject({ kind: 'ocr', segments: [{ source: 'Hello world. Go!', translation: '' }] });
  });
  it('preserves setup errors after they cross runtime messaging', async () => {
    vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn().mockResolvedValue({ ok: false, error: { code: 'WINDOWS_SETUP', message: 'Setup needed' } }) } });
    await expect(windowsOcrMethod.testConnection({ config: {}, signal: new AbortController().signal, jobId: 'test-job' })).rejects.toMatchObject({ code: 'WINDOWS_SETUP' });
  });
});
