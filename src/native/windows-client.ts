import { AppError } from '../errors';
import { PROCESSING_TIMEOUT_MS } from '../limits';
import type { ImageData } from '../types';

export const WINDOWS_HOST = 'com.comiclens.windows_ocr';
export interface WindowsRequest { operation: 'ping' | 'recognize'; image?: ImageData }
export interface WindowsResponse { text: string; resized: boolean }

export function validateWindowsRequest(request: WindowsRequest) {
  if (!request || !['ping', 'recognize'].includes(request.operation)) throw new AppError('INVALID_RESPONSE');
  if (request.operation === 'recognize' && (!request.image || request.image.mimeType !== 'image/png' || typeof request.image.base64 !== 'string' || !request.image.base64.length || request.image.base64.length > 16 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(request.image.base64))) throw new AppError('INVALID_CAPTURE');
}
function nativeFailure(code: unknown): AppError {
  if (code === 'LANGUAGE') return new AppError('WINDOWS_LANGUAGE');
  if (code === 'SETUP') return new AppError('WINDOWS_SETUP');
  if (code === 'IMAGE_LIMIT' || code === 'INVALID_IMAGE') return new AppError('INVALID_CAPTURE', 'Windows OCR không đọc được ảnh này. Hãy chọn vùng nhỏ hơn rồi thử lại.');
  return new AppError('OCR');
}

/** Called by the service worker, never by a content script or offscreen document. */
export function requestWindowsOcr(request: WindowsRequest, signal: AbortSignal): Promise<WindowsResponse> {
  validateWindowsRequest(request);
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new AppError('CANCELLED')); return; }
    let port: chrome.runtime.Port;
    try { port = chrome.runtime.connectNative(WINDOWS_HOST); }
    catch { reject(new AppError('WINDOWS_SETUP')); return; }
    const id = crypto.randomUUID(); let settled = false;
    const finish = (error?: AppError, result?: WindowsResponse) => {
      if (settled) return; settled = true; clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      port.onMessage.removeListener(onMessage); port.onDisconnect.removeListener(onDisconnect);
      try { port.disconnect(); } catch { /* Host may already have exited. */ }
      if (error) reject(error); else resolve(result!);
    };
    const cancel = () => finish(new AppError(signal.reason === 'timeout' ? 'TIMEOUT' : 'CANCELLED'));
    const timer = setTimeout(() => finish(new AppError('TIMEOUT')), PROCESSING_TIMEOUT_MS);
    const onDisconnect = () => { void chrome.runtime.lastError; finish(new AppError('WINDOWS_SETUP')); };
    const onMessage = (message: unknown) => {
      if (!message || typeof message !== 'object') { finish(new AppError('INVALID_RESPONSE')); return; }
      const m = message as Record<string, unknown>;
      if (m.version !== 1 || m.id !== id || typeof m.ok !== 'boolean') { finish(new AppError('INVALID_RESPONSE')); return; }
      if (!m.ok) { finish(nativeFailure(m.code)); return; }
      if (m.engine !== 'Windows.Media.Ocr' || typeof m.text !== 'string' || m.text.length > 200_000) { finish(new AppError('INVALID_RESPONSE')); return; }
      finish(undefined, { text: m.text, resized: m.resized === true });
    };
    port.onMessage.addListener(onMessage); port.onDisconnect.addListener(onDisconnect);
    signal.addEventListener('abort', cancel, { once: true });
    try { port.postMessage({ version: 1, id, command: request.operation, language: 'en', ...(request.operation === 'recognize' ? { image: request.image } : {}) }); }
    catch { finish(new AppError('WINDOWS_SETUP')); }
  });
}
