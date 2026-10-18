import type { Anchor, PageIdentity, Rect, Reply, RunOutcome, Settings, TranslationMode, TranslationRecord, Viewport } from './types';
import type { WindowsRequest } from './native/windows-client';

export interface ActiveJob {
  id: string; recordId: string; owner?: PageIdentity; pageUrl: string; generation: number;
  phase: 'selecting' | 'capturing' | 'processing' | 'test'; operation: 'translate' | 'rebind';
  startedAt: number; anchor?: Anchor; settings?: Settings;
}
export type BackgroundMessage =
  | { target: 'background'; type: 'WINDOWS_OCR'; jobId: string; request: WindowsRequest }
  | { target: 'background'; type: 'WINDOWS_CANCEL'; jobId: string }
  | { target: 'background'; type: 'GET_SETTINGS' | 'OPEN_OPTIONS' | 'STATS' | 'RESTORE' | 'CLEAR_ALL' }
  | { target: 'background'; type: 'SAVE_SETTINGS'; settings: Settings }
  | { target: 'background'; type: 'START'; mode: 'region' | 'viewport'; methodId: string; translationMode?: TranslationMode }
  | { target: 'background'; type: 'CAPTURE'; jobId: string; rect: Rect; viewport: Viewport; anchor: Anchor }
  | { target: 'background'; type: 'CANCEL'; jobId: string }
  | { target: 'background'; type: 'RETRY' | 'REBIND' | 'DELETE_RECORD'; recordId: string }
  | { target: 'background'; type: 'ATTACH'; jobId: string; anchor: Anchor }
  | { target: 'background'; type: 'CLEAR_PAGE'; pageUrl?: string }
  | { target: 'background'; type: 'TEST'; settings: Settings }
  | { target: 'background'; type: 'DONE'; jobId: string; outcome: RunOutcome };
export type PageMessage =
  | { target: 'page'; type: 'RECORDS'; records: TranslationRecord[]; reveal?: boolean }
  | { target: 'page'; type: 'RESET' }
  | { target: 'page'; type: 'BEGIN'; jobId: string; recordId: string; mode: 'region' | 'viewport' | 'saved'; operation: 'translate' | 'rebind'; anchor?: Anchor; methodId?: string }
  | { target: 'page'; type: 'VERIFY'; jobId: string; viewport: Viewport }
  | { target: 'page'; type: 'LOADING'; jobId: string; recordId: string; anchor: Anchor; methodId?: string }
  | { target: 'page'; type: 'COMPLETE'; jobId: string; recordId: string; outcome: RunOutcome; record?: TranslationRecord }
  | { target: 'page'; type: 'CANCELLED'; jobId: string };
export type OffscreenMessage =
  | { target: 'offscreen'; type: 'RUN'; job: ActiveJob; settings: Settings; screenshot: string; rect: Rect; viewport: Viewport }
  | { target: 'offscreen'; type: 'TEST'; job: ActiveJob; settings: Settings }
  | { target: 'offscreen'; type: 'CANCEL'; jobId: string };
export async function send<T = undefined>(message: BackgroundMessage): Promise<T> {
  const reply: Reply<T> = await chrome.runtime.sendMessage(message);
  if (!reply?.ok) throw reply?.error ?? { code: 'UNKNOWN', message: 'Không liên lạc được extension. Hãy tải lại trang.' };
  return reply.data;
}
