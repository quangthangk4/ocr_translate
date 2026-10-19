import { describe, expect, it } from 'vitest';
import { matchSegment, normalizeSearch, searchHistory } from '../src/history-search';
import type { Segment, TranslationRecord } from '../src/types';

const segment: Segment = { source: "You've GOT A\n  SHOT at winning.", translation: 'Bạn có cơ hội thắng.', learning: {
  chunks: [{ text: 'got a shot', meaning: 'có cơ hội' }],
  structures: [{ excerpt: 'at winning', pattern: 'shot at + V-ing', explanation: 'Diễn đạt cơ hội làm việc gì đó.', example: 'She has a shot at the title.', exampleTranslation: 'Cô ấy có cơ hội giành danh hiệu.' }], notes: ['Đây không phải nghĩa bắn súng.'] } };
function record(id: string, source = segment, updatedAt = 100): TranslationRecord {
  return { version: 2, id, pageUrl: `https://comic.test/${id}`, anchor: { kind: 'page', documentToken: 'p', rect: { x: 1, y: 1, width: 30, height: 30 } }, methodId: 'gemini-image', model: 'test-model', sourceLang: 'English', targetLang: 'Vietnamese', mode: 'learn', promptVersion: 'v1', result: { segments: [source], warnings: [] }, createdAt: 10, updatedAt };
}
async function* entries(items: TranslationRecord[]) { yield* items; }
describe('history search', () => {
  it('matches phrases across case/whitespace and handles curved apostrophes', () => {
    expect(matchSegment(segment, 'got a shot')!.score).toBeGreaterThan(200);
    expect(matchSegment(segment, '  GOT\t A SHOT ')).toBeDefined();
    expect(matchSegment(segment, 'you’ve')).toBeDefined();
    expect(normalizeSearch('  GOT\n A  SHOT ')).toBe('got a shot');
  });
  it('searches translations, chunks, grammar, examples and notes without treating query as regex', () => {
    for (const query of ['có cơ hội thắng', 'có cơ hội', 'shot at + V-ing', 'làm việc gì', 'the title', 'giành danh hiệu', 'bắn súng']) expect(matchSegment(segment, query), query).toBeDefined();
    expect(matchSegment(segment, '.*')).toBeUndefined(); expect(matchSegment(segment, '<script>')).toBeUndefined();
    expect(matchSegment(segment, 'missing words')).toBeUndefined();
  });
  it('ranks complete phrase above scattered words, returns the matching segment, and paginates deterministically', async () => {
    const scattered = record('scattered', { source: 'Got to try a different shot.', translation: '' }, 1000);
    const exact = record('exact'); exact.result.segments.unshift({ source: 'Hello', translation: 'Xin chào' });
    const found = await searchHistory(entries([scattered, exact]), 'got a shot', 0, 1);
    expect(found.total).toBe(2); expect(found.hits[0]).toMatchObject({ recordId: 'exact', segmentIndex: 1, pageUrl: 'https://comic.test/exact' });
    const next = await searchHistory(entries([scattered, exact]), 'got a shot', 1, 1);
    expect(next.hits[0].recordId).toBe('scattered');
  });
  it('browses recent sentences when blank and searches OCR/quick results without inventing learning', async () => {
    const ocr = record('ocr', { source: 'Take a shot.', translation: '' }, 200);
    const recent = await searchHistory(entries([record('learn'), ocr]), '');
    expect(recent.hits[0].recordId).toBe('ocr');
    const found = await searchHistory(entries([ocr]), 'shot');
    expect(found.hits[0].segment.learning).toBeUndefined();
    expect((await searchHistory(entries([ocr]), 'absent')).hits).toEqual([]);
  });
  it('cancels before returning stale results', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(searchHistory(entries([record('1')]), 'shot', 0, 20, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
