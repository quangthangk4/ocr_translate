import type { Anchor, Rect } from './types';

const source = (image: HTMLImageElement) => image.currentSrc || image.src;
function usable(image: HTMLImageElement) {
  const style = getComputedStyle(image), r = image.getBoundingClientRect();
  if (!image.complete || image.naturalWidth <= 0 || r.width <= 0 || r.height <= 0 || style.visibility === 'hidden' || style.display === 'none') return false;
  // Rotated/skewed images need an inverse transform; safely leave them as page regions.
  if (style.transform !== 'none') { const matrix = new DOMMatrix(style.transform); if (Math.abs(matrix.b) > .001 || Math.abs(matrix.c) > .001) return false; }
  return !source(image).startsWith('data:');
}
export function anchorFor(rect: Rect, documentToken: string): Anchor {
  const images = [...document.images];
  const candidates = images.filter(image => {
    if (!usable(image)) return false; const r = image.getBoundingClientRect();
    return rect.x >= r.left - 1 && rect.y >= r.top - 1 && rect.x + rect.width <= r.right + 1 && rect.y + rect.height <= r.bottom + 1;
  });
  if (candidates.length === 1) {
    const image = candidates[0], r = image.getBoundingClientRect();
    const matches = images.filter(i => source(i) === source(image));
    return { kind: 'image', src: source(image), naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, occurrence: matches.indexOf(image), sourceCount: matches.length, rect: { x: Math.max(0, (rect.x - r.x) / r.width), y: Math.max(0, (rect.y - r.y) / r.height), width: rect.width / r.width, height: rect.height / r.height } };
  }
  return { kind: 'page', documentToken, rect: { ...rect, x: rect.x + scrollX, y: rect.y + scrollY } };
}
export function createAnchorResolver(documentToken: string) {
  const sources = new Map<string, HTMLImageElement[]>(), bounds = new Map<HTMLImageElement, DOMRect | undefined>();
  for (const image of document.images) { const src = source(image), list = sources.get(src) ?? []; list.push(image); sources.set(src, list); }
  return (anchor: Anchor): { rect: Rect; image?: HTMLImageElement; imageRight: number } | undefined => {
    if (anchor.kind === 'page') return anchor.documentToken === documentToken ? { rect: anchor.rect, imageRight: anchor.rect.x + anchor.rect.width } : undefined;
    const candidates = sources.get(anchor.src) ?? [];
    if (candidates.length !== (anchor.sourceCount ?? 1)) return undefined;
    const image = candidates[anchor.occurrence];
    if (!image || image.naturalWidth !== anchor.naturalWidth || image.naturalHeight !== anchor.naturalHeight) return undefined;
    if (!bounds.has(image)) bounds.set(image, usable(image) ? image.getBoundingClientRect() : undefined);
    const r = bounds.get(image); if (!r) return undefined;
    const n = anchor.rect;
    return { rect: { x: r.left + scrollX + n.x * r.width, y: r.top + scrollY + n.y * r.height, width: n.width * r.width, height: n.height * r.height }, image, imageRight: r.right + scrollX };
  };
}
export function resolveAnchor(anchor: Anchor, documentToken: string) { return createAnchorResolver(documentToken)(anchor); }
export function overlap(a: Rect, b: Rect): number {
  const intersection = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return intersection / (a.width * a.height + b.width * b.height - intersection || 1);
}
export function sameRegion(a: Anchor, b: Anchor): boolean {
  const same = a.kind === 'image' && b.kind === 'image' ? a.src === b.src && a.occurrence === b.occurrence && a.naturalWidth === b.naturalWidth && a.naturalHeight === b.naturalHeight : a.kind === 'page' && b.kind === 'page' && a.documentToken === b.documentToken;
  return same && overlap(a.rect, b.rect) >= .65;
}
