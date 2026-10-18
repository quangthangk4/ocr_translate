import { AppError } from './errors';
import type { Anchor, RecordIndexItem, RecordStats, TranslationRecord } from './types';

export const MAX_RECORDS = 500;
export const MAX_RECORD_BYTES = 5 * 1024 * 1024;
const INDEX = 'recordIndexV2', GENERATION = 'recordGenerationV2';
const key = (id: string) => `translationV2:${id}`;
export function recordBytes(record: TranslationRecord): number {
  return new TextEncoder().encode(JSON.stringify(record)).length + new TextEncoder().encode(key(record.id)).length + 128;
}
export function budgetRecords(index: RecordIndexItem[], entry: RecordIndexItem, maxCount = MAX_RECORDS, maxBytes = MAX_RECORD_BYTES) {
  if (entry.bytes > maxBytes) throw new AppError('STORAGE');
  const next = [...index.filter(i => i.id !== entry.id), entry].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const evicted: string[] = [];
  let bytes = next.reduce((sum, i) => sum + i.bytes, 0);
  while (next.length > maxCount || bytes > maxBytes) {
    const oldest = next.findIndex(i => i.id !== entry.id);
    const [removed] = next.splice(oldest, 1); bytes -= removed.bytes; evicted.push(removed.id);
  }
  return { index: next, evicted };
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
  async page(pageUrl: string): Promise<TranslationRecord[]> {
    const ids = (await this.index()).filter(i => i.pageUrl === pageUrl).map(i => key(i.id));
    if (!ids.length) return [];
    const values = await chrome.storage.local.get<Record<string, TranslationRecord>>(ids);
    return ids.map(id => values[id]).filter(r => r?.version === 2);
  }
  async put(record: TranslationRecord, generation: number): Promise<string[]> {
    if (generation !== await this.generation()) throw new AppError('CANCELLED');
    if (!validAnchor(record.anchor)) throw new AppError('INVALID_CAPTURE');
    const previous = await this.index();
    const { index, evicted } = budgetRecords(previous, { id: record.id, pageUrl: record.pageUrl, createdAt: record.createdAt, bytes: recordBytes(record) });
    // Free old entries first: storage.local's total quota also contains settings.
    if (evicted.length) {
      await chrome.storage.local.set({ [INDEX]: previous.filter(i => !evicted.includes(i.id)) });
      await chrome.storage.local.remove(evicted.map(key));
    }
    await chrome.storage.local.set({ [key(record.id)]: record, [INDEX]: index });
    return evicted;
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
    return { count: index.length, bytes: index.reduce((n, i) => n + i.bytes, 0), maxCount: MAX_RECORDS, maxBytes: MAX_RECORD_BYTES, pages: [...pages].map(([url, count]) => ({ url, count })) };
  }
}
