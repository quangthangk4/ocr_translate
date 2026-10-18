export type TranslationMode = 'learn' | 'quick';
export interface LearningChunk { text: string; meaning: string }
export interface LearningStructure { excerpt: string; pattern: string; explanation: string; example: string; exampleTranslation: string }
export interface Learning { chunks: LearningChunk[]; structures: LearningStructure[]; notes: string[] }
export interface Segment { source: string; translation: string; learning?: Learning }
export interface TranslationResult { segments: Segment[]; warnings: string[]; kind?: 'ocr' }
export interface ImageData { base64: string; mimeType: 'image/png' }
export interface TranslationInput { image: ImageData; sourceLang: string; targetLang: string; mode?: TranslationMode }
export interface MethodConfig { [key: string]: string }
export interface TranslationContext { config: MethodConfig; signal: AbortSignal; jobId?: string }
export interface ConfigField { key: string; label: string; secret?: boolean; suggestions?: string[]; defaultValue?: string }
export interface MethodDescriptor { id: string; label: string; fields: ConfigField[]; promptVersion: string; kind?: 'ocr'; sourceLanguages?: string[] }
export interface TranslationMethod {
  descriptor: MethodDescriptor;
  translate(input: TranslationInput, context: TranslationContext): Promise<TranslationResult>;
  testConnection(context: TranslationContext): Promise<void>;
}
export interface Settings {
  methodId: string;
  sourceLang: string;
  targetLang: string;
  mode: TranslationMode;
  methods: Record<string, MethodConfig>;
}
export interface PublicSettings { methodId: string; sourceLang: string; targetLang: string }
export interface Viewport { width: number; height: number; scrollX: number; scrollY: number }
export interface Rect { x: number; y: number; width: number; height: number }
export interface PageIdentity { tabId: number; documentId: string }
export type Anchor =
  | { kind: 'image'; src: string; naturalWidth: number; naturalHeight: number; occurrence: number; sourceCount?: number; rect: Rect }
  | { kind: 'page'; documentToken: string; rect: Rect };
export interface TranslationRecord {
  version: 2; id: string; pageUrl: string; anchor: Anchor;
  methodId: string; model: string; sourceLang: string; targetLang: string; mode: TranslationMode;
  promptVersion: string; result: TranslationResult; createdAt: number; updatedAt: number;
}
export interface RecordIndexItem { id: string; pageUrl: string; createdAt: number; bytes: number }
export interface RecordStats { count: number; bytes: number; maxCount: number; maxBytes: number; pages: { url: string; count: number }[] }
export type ErrorCode = 'AUTH' | 'MODEL' | 'QUOTA' | 'NETWORK' | 'TIMEOUT' | 'BLOCKED' | 'INVALID_RESPONSE' | 'NO_TEXT' | 'CANCELLED' | 'UNSUPPORTED' | 'BUSY' | 'INVALID_CAPTURE' | 'CONFIG' | 'API_REQUEST' | 'STORAGE' | 'OCR' | 'WINDOWS_SETUP' | 'WINDOWS_LANGUAGE' | 'UNKNOWN';
export interface Failure { code: ErrorCode; message: string }
export type Reply<T = undefined> = { ok: true; data: T } | { ok: false; error: Failure };
export type RunOutcome = { result: TranslationResult } | { error: Failure };
