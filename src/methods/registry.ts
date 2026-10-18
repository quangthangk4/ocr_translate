import { AppError } from '../errors';
import type { TranslationMethod } from '../types';
import { geminiMethod } from './gemini';
import { localOcrMethod } from './local-ocr';
import { windowsOcrMethod } from './windows-ocr';

export function createRegistry(methods: TranslationMethod[]) {
  const registry = new Map<string, TranslationMethod>();
  for (const method of methods) {
    if (registry.has(method.descriptor.id)) throw new Error('Duplicate translation method');
    registry.set(method.descriptor.id, method);
  }
  return {
    list: () => [...registry.values()].map(m => m.descriptor),
    get(id: string) { const method = registry.get(id); if (!method) throw new AppError('CONFIG'); return method; },
  };
}
export const registry = createRegistry([geminiMethod, localOcrMethod, windowsOcrMethod]);
