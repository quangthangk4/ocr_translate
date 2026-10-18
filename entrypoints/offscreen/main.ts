import { registry } from '../../src/methods/registry';
import { cropImage } from '../../src/image';
import { AppError, failure } from '../../src/errors';
import { send, type OffscreenMessage } from '../../src/protocol';
import type { RunOutcome } from '../../src/types';
import { PROCESSING_TIMEOUT_MS } from '../../src/limits';

let running: { id: string; controller: AbortController; finished: Promise<void> } | undefined;
async function run(message: Extract<OffscreenMessage, { type: 'RUN' | 'TEST' }>, controller: AbortController) {
  const timer = setTimeout(() => controller.abort('timeout'), PROCESSING_TIMEOUT_MS);
  let outcome: RunOutcome;
  try {
    const method = registry.get(message.settings.methodId);
    const context = { config: message.settings.methods[message.settings.methodId], signal: controller.signal, jobId: message.job.id };
    if (message.type === 'TEST') {
      await method.testConnection(context); outcome = { result: { segments: [], warnings: [] } };
    } else {
      const image = await cropImage(message.screenshot, message.rect, message.viewport);
      message.screenshot = ''; // No screenshot retained for future retries; they recapture the saved region.
      if (controller.signal.aborted) throw new AppError('CANCELLED');
      const result = await method.translate({ image, sourceLang: message.settings.sourceLang, targetLang: message.settings.targetLang, mode: message.settings.mode }, context);
      if (controller.signal.aborted) throw new AppError('CANCELLED');
      outcome = { result };
    }
  } catch (error) {
    outcome = { error: failure(controller.signal.reason === 'timeout' ? new AppError('TIMEOUT') : controller.signal.aborted ? new AppError('CANCELLED') : error) };
  } finally { clearTimeout(timer); }
  // Release the execution slot before waking the background with DONE.
  if (running?.id === message.job.id) running = undefined;
  void send({ target: 'background', type: 'DONE', jobId: message.job.id, outcome }).catch(() => {});
}
chrome.runtime.onMessage.addListener((message: OffscreenMessage, sender, respond) => {
  if (message?.target !== 'offscreen' || sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL('/'))) return;
  if (message.type === 'CANCEL') {
    if (running?.id !== message.jobId) { respond({ ok: true }); return; }
    const job = running; job.controller.abort();
    void job.finished.then(() => respond({ ok: true })); return true;
  }
  if (running) { respond({ ok: false }); return; }
  const controller = new AbortController();
  const token = { id: message.job.id, controller, finished: Promise.resolve() };
  running = token; token.finished = run(message, controller);
  respond({ ok: true });
});
