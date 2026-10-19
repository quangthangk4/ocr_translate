import type { Segment, TranslationRecord } from './types';

export interface HistoryHit {
  recordId: string; segmentIndex: number; pageUrl: string; methodId: string; model: string;
  createdAt: number; updatedAt: number; segment: Segment; score: number; matchedText?: string;
}
export interface HistoryResults { hits: HistoryHit[]; total: number; offset: number; limit: number }
export const normalizeSearch = (text: string) => text.replace(/[’‘]/g, "'").toLowerCase().replace(/\s+/gu, ' ').trim();
function fields(segment: Segment) {
  const learning = segment.learning;
  return [segment.source, segment.translation,
    ...(learning?.chunks.flatMap(c => [c.text, c.meaning]) ?? []),
    ...(learning?.structures.flatMap(s => [s.excerpt, s.pattern, s.explanation, s.example, s.exampleTranslation]) ?? []),
    ...(learning?.notes ?? [])];
}
export function matchSegment(segment: Segment, query: string): { score: number; matchedText?: string } | undefined {
  const needle = normalizeSearch(query);
  if (!needle) return { score: 0 };
  const original = fields(segment), values = original.map(normalizeSearch);
  // A complete phrase ranks above words scattered across a sentence or explanation.
  const exact = values.findIndex(value => value.includes(needle));
  if (exact >= 0) return { score: 200 + (exact === 0 ? 30 : exact === 1 ? 10 : 20) + (values[exact] === needle ? 40 : 0), matchedText: exact > 1 ? original[exact] : undefined };
  const words = needle.split(' ');
  if (words.every(word => values.some(value => value.includes(word)))) return { score: 10, matchedText: original[values.findIndex(value => words.some(word => value.includes(word)))] };
  return undefined;
}
function compare(a: HistoryHit, b: HistoryHit) {
  return b.score - a.score || b.updatedAt - a.updatedAt || a.recordId.localeCompare(b.recordId) || a.segmentIndex - b.segmentIndex;
}
export async function searchHistory(records: AsyncIterable<TranslationRecord>, query: string, offset = 0, limit = 20, signal?: AbortSignal): Promise<HistoryResults> {
  const hits: HistoryHit[] = []; let total = 0;
  offset = Math.max(0, Math.trunc(offset)); limit = Math.max(1, Math.min(50, Math.trunc(limit)));
  for await (const record of records) {
    signal?.throwIfAborted();
    for (const [segmentIndex, segment] of record.result.segments.entries()) {
      const match = matchSegment(segment, query); if (!match) continue;
      total++;
      hits.push({ recordId: record.id, segmentIndex, segment, pageUrl: record.pageUrl, methodId: record.methodId, model: record.model, createdAt: record.createdAt, updatedAt: record.updatedAt, ...match });
    }
    // Keep only enough ranked results for this page, rather than all matching text.
    hits.sort(compare); hits.length = Math.min(hits.length, offset + limit);
  }
  signal?.throwIfAborted();
  return { hits: hits.slice(offset, offset + limit), total, offset, limit };
}
