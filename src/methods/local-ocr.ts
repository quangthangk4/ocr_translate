import { createWorker, OEM, PSM, type Worker } from 'tesseract.js';
import { AppError } from '../errors';
import { methodCatalog } from './catalog';
import type { TranslationContext, TranslationMethod, TranslationResult } from '../types';
import { OCR_CHARACTERS, plainOcrText } from '../ocr-text';

function aborted(signal: AbortSignal) { return new AppError(signal.reason === 'timeout' ? 'TIMEOUT' : 'CANCELLED'); }

/** Terminate after each operation: neither screenshots nor Tesseract's image memory
 * survive a job. Cancellation also handles a worker still initializing. */
export async function withOcrWorker<T>(signal: AbortSignal, action: (worker: Worker) => Promise<T>): Promise<T> {
  if (signal.aborted) throw aborted(signal);
  let worker: Worker | undefined;
  let completed = false;
  let rejectFailure!: (error: AppError) => void;
  const interrupted = new Promise<never>((_, reject) => { rejectFailure = reject; });
  const cancel = () => rejectFailure(aborted(signal));
  signal.addEventListener('abort', cancel, { once: true });
  const creation = createWorker('eng', OEM.LSTM_ONLY, {
    workerPath: chrome.runtime.getURL('/ocr/worker.min.js'),
    corePath: chrome.runtime.getURL('/ocr'),
    langPath: chrome.runtime.getURL('/ocr'),
    workerBlobURL: false, cacheMethod: 'none', gzip: true,
    logger: () => {},
    errorHandler: () => rejectFailure(new AppError('OCR')),
  }).then(async created => {
    if (completed || signal.aborted) { await created.terminate(); throw aborted(signal); }
    worker = created; return created;
  });
  try {
    const ready = await Promise.race([creation, interrupted]);
    return await Promise.race([action(ready), interrupted]);
  } catch (error) {
    if (signal.aborted) throw aborted(signal);
    throw error instanceof AppError ? error : new AppError('OCR');
  } finally {
    completed = true;
    signal.removeEventListener('abort', cancel);
    await worker?.terminate().catch(() => {});
  }
}

export function ocrResult(text: string, confidence: number): TranslationResult {
  const source = plainOcrText(text);
  if (!source || !/[\p{L}\p{N}]/u.test(source)) throw new AppError('NO_TEXT');
  return { kind: 'ocr', segments: [{ source, translation: '' }], warnings: confidence < 65 ? ['Chữ nhận được có độ tin cậy thấp. Hãy kiểm tra lại với ảnh gốc hoặc chọn vùng nhỏ và rõ hơn.'] : [] };
}

export const localOcrMethod: TranslationMethod = {
  descriptor: methodCatalog.find(m => m.id === 'local-ocr')!,
  async translate(input, { signal }) {
    if (input.sourceLang !== 'English') throw new AppError('CONFIG', 'OCR cục bộ hiện hỗ trợ tiếng Anh.');
    return withOcrWorker(signal, async worker => {
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, user_defined_dpi: '150', tessedit_char_whitelist: OCR_CHARACTERS });
      if (signal.aborted) throw aborted(signal);
      const { data } = await worker.recognize(`data:${input.image.mimeType};base64,${input.image.base64}`, {}, { text: true });
      return ocrResult(data.text, data.confidence);
    });
  },
  async testConnection({ signal }: TranslationContext) { await withOcrWorker(signal, async () => {}); },
};
