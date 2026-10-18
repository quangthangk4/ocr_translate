import { AppError } from './errors';
import type { ImageData, Rect, Viewport } from './types';

export function pixelRect(rect: Rect, viewport: Viewport, imageWidth: number, imageHeight: number): Rect {
  if (![rect.x, rect.y, rect.width, rect.height, viewport.width, viewport.height, imageWidth, imageHeight].every(Number.isFinite) || viewport.width <= 0 || viewport.height <= 0 || rect.x < 0 || rect.y < 0 || rect.width < 4 || rect.height < 4 || rect.x + rect.width > viewport.width + 1 || rect.y + rect.height > viewport.height + 1) throw new AppError('INVALID_CAPTURE');
  const x = Math.round(rect.x * imageWidth / viewport.width);
  const y = Math.round(rect.y * imageHeight / viewport.height);
  return { x, y, width: Math.min(imageWidth - x, Math.round(rect.width * imageWidth / viewport.width)), height: Math.min(imageHeight - y, Math.round(rect.height * imageHeight / viewport.height)) };
}
export async function cropImage(dataUrl: string, rect: Rect, viewport: Viewport): Promise<ImageData> {
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  try {
    const r = pixelRect(rect, viewport, bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = r.width; canvas.height = r.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new AppError('INVALID_CAPTURE');
    ctx.drawImage(bitmap, r.x, r.y, r.width, r.height, 0, 0, r.width, r.height);
    return { base64: canvas.toDataURL('image/png').split(',')[1], mimeType: 'image/png' };
  } finally { bitmap.close(); }
}
