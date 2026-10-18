import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { budgetRecords, MAX_RECORD_BYTES, MAX_RECORDS, RecordStore, validAnchor } from '../src/records';
import { excerptRange } from '../src/learning';
import { parseTranslation } from '../src/methods/gemini';
import { defaultSettings, normalizeSettings } from '../src/methods/catalog';
import { overlap, sameRegion } from '../src/anchors';
import type { Learning, TranslationRecord } from '../src/types';

function record(id: string, pageUrl = 'https://comic.test/chapter?a=1'): TranslationRecord {
  return { version: 2, id, pageUrl, anchor: { kind: 'image', src: 'https://comic.test/page.png?chapter=1', naturalWidth: 800, naturalHeight: 1200, occurrence: 0, rect: { x: .1, y: .2, width: .4, height: .1 } }, methodId: 'gemini-image', model: 'gemini-3.5-flash-lite', sourceLang: 'English', targetLang: 'Vietnamese', mode: 'learn', promptVersion: '2', createdAt: Number(id) || 1, updatedAt: 10, result: { segments: [{ source: 'Wait!', translation: 'Đợi đã!' }], warnings: [] } };
}
const learning: Learning = {
  chunks: [{ text: 'far stronger than', meaning: 'mạnh hơn rất nhiều' }],
  structures: [{ excerpt: 'far stronger than', pattern: 'far + comparative + than', explanation: 'Nhấn mạnh mức độ so sánh.', example: 'This route is far shorter than that one.', exampleTranslation: 'Tuyến này ngắn hơn tuyến kia rất nhiều.' }], notes: [],
};
let local: Record<string, unknown>, session: Record<string, unknown>;
function area(data: Record<string, unknown>) {
  return {
    get: vi.fn(async (keys: string | string[] | null) => keys === null ? structuredClone(data) : Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => key in data).map(key => [key, structuredClone(data[key])]))),
    set: vi.fn(async (values: object) => { Object.assign(data, structuredClone(values)); }),
    remove: vi.fn(async (keys: string | string[]) => { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; }),
  };
}
beforeEach(() => {
  local = { settings: { apiKey: 'keep-this-secret', mode: 'learn' } }; session = { cache: 'legacy screenshot hash cache' };
  vi.stubGlobal('chrome', { storage: { local: area(local), session: area(session) } });
});
afterEach(() => vi.unstubAllGlobals());

describe('persistent translation records', () => {
  it('migrates without deleting API keys and discards the obsolete session cache', async () => {
    await new RecordStore().initialize(); expect(local.settings).toMatchObject({ apiKey: 'keep-this-secret' }); expect(session.cache).toBeUndefined();
  });
  it('loads just the requested page and survives creating a new store instance', async () => {
    const store = new RecordStore(); await store.initialize();
    await store.put(record('1'), 0); await store.put(record('2', 'https://comic.test/chapter?a=2'), 0);
    expect((await new RecordStore().page('https://comic.test/chapter?a=1')).map(r => r.id)).toEqual(['1']);
    const calls = vi.mocked(chrome.storage.local.get).mock.calls;
    expect(calls.some(args => Array.isArray(args[0]) && args[0].length === 1 && args[0][0] === 'translationV2:1')).toBe(true);
    expect(JSON.stringify(local)).not.toContain('base64');
  });
  it('clears a page independently, then clears all without affecting settings', async () => {
    const store = new RecordStore(); await store.initialize(); await store.put(record('1'), 0); await store.put(record('2', 'https://other.test'), 0);
    await store.clear(record('1').pageUrl); expect((await store.stats()).count).toBe(1);
    await store.clear(); expect((await store.stats()).count).toBe(0); expect(local.settings).toMatchObject({ apiKey: 'keep-this-secret' });
    await expect(store.put(record('3'), 0)).rejects.toMatchObject({ code: 'CANCELLED' });
  });
  it('removes one record without clearing other pages', async () => {
    const store = new RecordStore(); await store.initialize(); await store.put(record('1'), 0); await store.put(record('2'), 0);
    await store.remove('1'); expect(await store.get('1')).toBeUndefined(); expect((await store.stats()).count).toBe(1);
  });
  it('enforces count and byte budgets by evicting oldest records', () => {
    const index = [1, 2, 3].map(i => ({ id: String(i), pageUrl: 'p', createdAt: i, bytes: 100 }));
    const entry = { id: '4', pageUrl: 'p', createdAt: 4, bytes: 150 };
    expect(budgetRecords(index, entry, 3, 300).evicted).toEqual(['1', '2']);
    expect(budgetRecords(index, entry, 3, 1000).index).toHaveLength(3);
    expect(() => budgetRecords(index, { ...entry, bytes: 1001 }, 3, 1000)).toThrow();
    expect(MAX_RECORDS).toBe(500); expect(MAX_RECORD_BYTES).toBe(5 * 1024 * 1024);
  });
  it('validates normalized anchors and keeps URL query parameters significant', () => {
    expect(validAnchor(record('1').anchor)).toBe(true);
    expect(validAnchor({ ...record('1').anchor, rect: { x: .9, y: 0, width: .5, height: .1 } })).toBe(false);
    const a = record('1').anchor;
    expect(sameRegion(a, { ...a, rect: { x: .11, y: .2, width: .4, height: .1 } })).toBe(true);
    expect(sameRegion(a, { ...a, kind: 'image', src: 'https://comic.test/page.png?chapter=2', naturalWidth: 800, naturalHeight: 1200, occurrence: 0 })).toBe(false);
    expect(overlap({ x: 0, y: 0, width: 1, height: 1 }, { x: 2, y: 2, width: 1, height: 1 })).toBe(0);
  });
});
describe('learning output', () => {
  it('defaults existing user settings to learn while keeping credentials', () => {
    const saved = defaultSettings(); saved.methods[saved.methodId].apiKey = 'secret';
    expect(normalizeSettings({ ...saved, mode: undefined })).toMatchObject({ mode: 'learn', methods: saved.methods });
  });
  it('returns validated chunks, structures and examples', () => {
    const result = parseTranslation({ segments: [{ source: "I'd expect it to be far stronger than that.", translation: 'Tôi nghĩ nó mạnh hơn rất nhiều.', learning }], warnings: [] }, true);
    expect(result.segments[0].learning).toEqual(learning);
  });
  it('keeps a valid translation if learning is invalid or missing', () => {
    const result = parseTranslation({ segments: [{ source: 'Wait!', translation: 'Đợi đã!', learning }], warnings: [] }, true);
    expect(result.segments[0].translation).toBe('Đợi đã!'); expect(result.segments[0].learning).toBeUndefined(); expect(result.warnings).toHaveLength(1);
  });
  it('does not return learning in quick mode', () => {
    expect(parseTranslation({ segments: [{ source: 'far stronger than', translation: 'mạnh hơn', learning }], warnings: [] }).segments[0].learning).toBeUndefined();
  });
  it('highlights exact original character ranges despite contractions and whitespace', () => {
    const source = "I’D expect it to be FAR\n  stronger than that.";
    const range = excerptRange(source, 'far stronger than')!;
    expect(source.slice(range.start, range.end)).toBe('FAR\n  stronger than');
    expect(excerptRange(source, "I'd")).toEqual({ start: 0, end: 3 });
    expect(excerptRange(source, 'hallucinated words')).toBeUndefined();
  });
});
