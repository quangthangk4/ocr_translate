import { AppError } from './errors';
import type { Anchor, RecordIndexItem, RecordStats, TranslationRecord } from './types';

const INDEX = 'recordIndexV2', GENERATION = 'recordGenerationV2';
const key = (id: string) => `translationV2:${id}`;
export function recordBytes(record: TranslationRecord): number {
  return new TextEncoder().encode(JSON.stringify(record)).length + new TextEncoder().encode(key(record.id)).length + 128;
}
export function validAnchor(value: Anchor): boolean {
  if (!value || !value.rect) return false;
  const r = value.rect;
  if (![r.x, r.y, r.width, r.height].every(Number.isFinite) || r.x < 0 || r.y < 0 || r.width <= 0 || r.height <= 0) return false;
  if (value.kind === 'page') return typeof value.documentToken === 'string';
  return value.kind === 'image' && typeof value.src === 'string' && value.src.length < 16_384 && !value.src.startsWith('data:') && value.naturalWidth > 0 && value.naturalHeight > 0 && Number.isInteger(value.occurrence) && value.occurrence >= 0 && r.x + r.width <= 1.001 && r.y + r.height <= 1.001;
}

/** All writes are serialized by the background dispatcher. Never stores settings or image bytes. */
export class RecordStore {
  private async index(): Promise<RecordIndexItem[]> {
    return (await chrome.storage.local.get<{ recordIndexV2?: RecordIndexItem[] }>(INDEX)).recordIndexV2 ?? [];
  }
  async generation(): Promise<number> { return Number((await chrome.storage.local.get(GENERATION))[GENERATION] ?? 0); }
  async initialize() {
    await chrome.storage.session.remove(['cache', 'retained']);
    if ((await chrome.storage.local.get(INDEX))[INDEX] === undefined) await chrome.storage.local.set({ [INDEX]: [], [GENERATION]: 0 });
  }
  async get(id: string): Promise<TranslationRecord | undefined> { return (await chrome.storage.local.get<Record<string, TranslationRecord>>(key(id)))[key(id)]; }
  /** Trusted history page reads only record keys, in batches, never API keys/settings. */
  async *entries(signal?: AbortSignal): AsyncGenerator<TranslationRecord> {
    const index = await this.index();
    for (let start = 0; start < index.length; start += 100) {
      signal?.throwIfAborted();
      const ids = index.slice(start, start + 100).map(i => key(i.id));
      const values = await chrome.storage.local.get<Record<string, TranslationRecord>>(ids);
      for (const id of ids) { signal?.throwIfAborted(); if (values[id]?.version === 2) yield values[id]; }
      // Yield to input events so typing can cancel a large search immediately.
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  async page(pageUrl: string): Promise<TranslationRecord[]> {
    const ids = (await this.index()).filter(i => i.pageUrl === pageUrl).map(i => key(i.id));
    if (!ids.length) return [];
    const values = await chrome.storage.local.get<Record<string, TranslationRecord>>(ids);
    return ids.map(id => values[id]).filter(r => r?.version === 2);
  }
  async put(record: TranslationRecord, generation: number): Promise<void> {
    if (generation !== await this.generation()) throw new AppError('CANCELLED');
    if (!validAnchor(record.anchor)) throw new AppError('INVALID_CAPTURE');
    const previous = await this.index();
    const entry = { id: record.id, pageUrl: record.pageUrl, createdAt: record.createdAt, bytes: recordBytes(record) };
    const index = [...previous.filter(i => i.id !== record.id), entry];
    // Never evict history, including when a write fails because the disk is full.
    await chrome.storage.local.set({ [key(record.id)]: record, [INDEX]: index });
  }
  async remove(id: string) {
    const index = await this.index();
    await chrome.storage.local.set({ [INDEX]: index.filter(i => i.id !== id) });
    await chrome.storage.local.remove(key(id));
  }
  async clear(pageUrl?: string) {
    const index = await this.index(), removing = index.filter(i => !pageUrl || i.pageUrl === pageUrl);
    await chrome.storage.local.set({ [INDEX]: index.filter(i => !removing.includes(i)), ...(!pageUrl ? { [GENERATION]: await this.generation() + 1 } : {}) });
    if (removing.length) await chrome.storage.local.remove(removing.map(i => key(i.id)));
  }
  async stats(): Promise<RecordStats> {
    const index = await this.index(), pages = new Map<string, number>();
    for (const item of index) pages.set(item.pageUrl, (pages.get(item.pageUrl) ?? 0) + 1);
    return { count: index.length, bytes: index.reduce((n, i) => n + i.bytes, 0), pages: [...pages].map(([url, count]) => ({ url, count })) };
  }
}
