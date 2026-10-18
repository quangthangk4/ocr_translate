import { AppError } from '../errors';
import { plainOcrText } from '../ocr-text';
import { send } from '../protocol';
import type { WindowsRequest, WindowsResponse } from '../native/windows-client';
import type { ErrorCode, TranslationContext, TranslationMethod } from '../types';
import { methodCatalog } from './catalog';

// Offscreen documents only support runtime messaging. Native messaging is relayed
// by the service worker after checking the sender and the active job ID.
async function invoke(request: WindowsRequest, { signal, jobId }: TranslationContext) {
  if (!jobId) throw new AppError('CONFIG');
  if (signal.aborted) throw new AppError(signal.reason === 'timeout' ? 'TIMEOUT' : 'CANCELLED');
  const cancel = () => { void send({ target: 'background', type: 'WINDOWS_CANCEL', jobId }).catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const response = await send<WindowsResponse>({ target: 'background', type: 'WINDOWS_OCR', jobId, request });
    if (signal.aborted) throw new AppError(signal.reason === 'timeout' ? 'TIMEOUT' : 'CANCELLED');
    return response;
  } catch (error) {
    if (signal.aborted) throw new AppError(signal.reason === 'timeout' ? 'TIMEOUT' : 'CANCELLED');
    // Runtime messages carry plain JSON errors, so restore their typed category
    // before offscreen turns the adapter failure into a user-facing outcome.
    const code = (error as { code?: ErrorCode })?.code;
    if (code && ['WINDOWS_SETUP', 'WINDOWS_LANGUAGE', 'INVALID_CAPTURE', 'INVALID_RESPONSE', 'CANCELLED', 'TIMEOUT', 'OCR', 'BUSY', 'UNSUPPORTED'].includes(code)) throw new AppError(code);
    throw error;
  } finally { signal.removeEventListener('abort', cancel); }
}
export const windowsOcrMethod: TranslationMethod = {
  descriptor: methodCatalog.find(m => m.id === 'windows-ocr')!,
  async translate(input, context) {
    if (input.sourceLang !== 'English') throw new AppError('CONFIG', 'Windows OCR hiện được cấu hình cho tiếng Anh.');
    const response = await invoke({ operation: 'recognize', image: input.image }, context);
    const source = plainOcrText(response.text);
    if (!/[a-z0-9]/i.test(source)) throw new AppError('NO_TEXT');
    return { kind: 'ocr', segments: [{ source, translation: '' }], warnings: response.resized ? ['Vùng ảnh lớn đã được thu nhỏ để phù hợp giới hạn Windows OCR.'] : [] };
  },
  async testConnection(context) { await invoke({ operation: 'ping' }, context); },
};
