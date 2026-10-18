import type { Learning } from './types';

function indexedText(text: string) {
  let value = ''; const starts: number[] = [], ends: number[] = [];
  for (let i = 0; i < text.length;) {
    const c = String.fromCodePoint(text.codePointAt(i)!), end = i + c.length;
    const normalized = /\s/.test(c) ? ' ' : c.replace(/[’‘]/g, "'").toLowerCase();
    if (!(normalized === ' ' && value.endsWith(' '))) for (const char of normalized) { value += char; starts.push(i); ends.push(end); }
    else ends[ends.length - 1] = end;
    i = end;
  }
  return { value, starts, ends };
}
export function excerptRange(source: string, excerpt: string): { start: number; end: number } | undefined {
  const haystack = indexedText(source), needle = indexedText(excerpt.trim()).value;
  if (!needle) return undefined;
  const index = haystack.value.indexOf(needle);
  if (index < 0) return undefined;
  return { start: haystack.starts[index], end: haystack.ends[index + needle.length - 1] };
}
export function parseLearning(source: string, value: unknown): Learning | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Learning;
  const text = (x: unknown): x is string => typeof x === 'string' && x.trim().length > 0 && x.length <= 6000;
  if (!Array.isArray(v.chunks) || v.chunks.length > 4 || !Array.isArray(v.structures) || v.structures.length > 2 || !Array.isArray(v.notes) || v.notes.length > 4) return undefined;
  if (v.chunks.some(c => !c || !text(c.text) || !text(c.meaning) || !excerptRange(source, c.text))) return undefined;
  if (v.structures.some(s => !s || ![s.excerpt, s.pattern, s.explanation, s.example, s.exampleTranslation].every(text) || !excerptRange(source, s.excerpt))) return undefined;
  if (!v.notes.every(text)) return undefined;
  return { chunks: v.chunks.map(c => ({ text: c.text, meaning: c.meaning })), structures: v.structures.map(s => ({ excerpt: s.excerpt, pattern: s.pattern, explanation: s.explanation, example: s.example, exampleTranslation: s.exampleTranslation })), notes: [...v.notes] };
}
