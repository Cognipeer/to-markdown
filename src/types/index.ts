/**
 * OCR provider identifier.
 * - `'tesseract'`     — Tesseract.js (default, peer dep: npm install tesseract.js)
 * - `'openai-vlm'`   — OpenAI Vision model (GPT-4o, GPT-4-vision, …)
 * - `'anthropic-vlm'`— Anthropic Vision model (claude-3-haiku, claude-3-sonnet, …)
 * - `'ollama-vlm'`   — Ollama local VLM (llava, bakllava, …)
 * - `'azure-vision'` — Azure Computer Vision Read API
 * - `'custom-vlm'`   — Any OpenAI-compatible vision endpoint
 * - `'handler'`      — User-supplied async callback (no HTTP calls by the library)
 */
export type OCRProvider =
  | 'tesseract'
  | 'openai-vlm'
  | 'anthropic-vlm'
  | 'ollama-vlm'
  | 'azure-vision'
  | 'custom-vlm'
  | 'handler';

/**
 * Context passed to a custom OCR handler.
 */
export interface OCRHandlerContext {
  /** 1-based page number (PDF OCR only) */
  page?: number;
  /** Total pages in the PDF */
  pageCount?: number;
  /** MIME hint: image/png for PDF pages, image/jpeg etc. for image files */
  mimeType?: string;
  /** Source file extension: .pdf, .png, … */
  sourceExtension?: string;
  /** fileName from ConverterOptions, when provided */
  fileName?: string;
  /** Source image dimensions, when known */
  imageWidth?: number;
  imageHeight?: number;
}

export type OCRHandler = (
  buffer: Buffer,
  context: OCRHandlerContext
) => Promise<string>;

/**
 * Configuration for VLM-based OCR providers.
 * Required when `OCROptions.provider` is any VLM type.
 */
export interface VLMOptions {
  /** Vision model identifier (e.g. 'gpt-4o', 'claude-3-haiku-20240307', 'llava') */
  model: string;
  /** API key — required for openai-vlm, anthropic-vlm, azure-vision, custom-vlm */
  apiKey?: string;
  /**
   * API base URL.
   * - ollama-vlm default: http://localhost:11434
   * - azure-vision: your Azure endpoint (e.g. https://<resource>.cognitiveservices.azure.com)
   * - custom-vlm: required
   */
  apiBase?: string;
  /** Custom extraction prompt sent to the VLM. Defaults to a generic OCR prompt. */
  prompt?: string;
  /** Maximum tokens for the VLM response (default: 4096) */
  maxTokens?: number;
}

/**
 * OCR options for image/PDF text extraction.
 *
 * Default provider is `'tesseract'` (requires peer dep: npm install tesseract.js).
 * VLM providers use native `fetch` and require no extra dependencies.
 */
export interface OCROptions {
  /** OCR provider to use (default: 'tesseract') */
  provider?: OCRProvider;
  /** Tesseract language code (default: 'eng') — only for 'tesseract' provider */
  lang?: string;
  /** PDF OCR mode: 'auto' = fallback when no text found, 'always' = always OCR, 'never' = skip (default: 'auto') */
  pdfMode?: 'auto' | 'always' | 'never';
  /** VLM configuration — required when provider is any VLM type */
  vlm?: VLMOptions;
  /** Required when provider is 'handler'. Library performs no HTTP calls. */
  handler?: OCRHandler;
}

/**
 * Converter options for converting various file formats to Markdown
 */
export interface ConverterOptions {
  /** Name of the file (helpful for buffer inputs) */
  fileName?: string;
  /** Force a specific file extension for processing */
  forceExtension?: string;
  /** Original URL (used for web content like YouTube or Bing search) */
  url?: string;
  /** Enable OCR for images and scanned PDFs (opt-in, requires tesseract.js) */
  ocr?: boolean | OCROptions;
}

/**
 * Input type for converter - can be file path, base64 string, or buffer
 */
export type ConverterInput = string | Buffer;

/**
 * Supported file extensions
 */
export enum FileExtension {
  PDF = '.pdf',
  DOCX = '.docx',
  HTML = '.html',
  HTM = '.htm',
  TXT = '.txt',
  IPYNB = '.ipynb',
  XML = '.xml',
  RSS = '.rss',
  ATOM = '.atom',
  XLSX = '.xlsx',
  XLS = '.xls',
  CSV = '.csv',
  MP3 = '.mp3',
  WAV = '.wav',
  PPTX = '.pptx',
  ZIP = '.zip',
  JPG = '.jpg',
  JPEG = '.jpeg',
  PNG = '.png',
  GIF = '.gif',
  JSON = '.json',
  YAML = '.yaml',
  YML = '.yml',
  EPUB = '.epub',
  MSG = '.msg',
}

/**
 * Turndown service options for HTML to Markdown conversion
 */
export interface TurndownOptions {
  headingStyle: 'setext' | 'atx';
  hr: string;
  bulletListMarker: string;
  codeBlockStyle: 'indented' | 'fenced';
  emDelimiter: string;
  keepHeaderLevels?: boolean;
}

/**
 * Image metadata interface
 */
export interface ImageMetadata {
  width?: number;
  height?: number;
  format?: string;
  size?: number;
}

/**
 * Audio metadata interface
 */
export interface AudioMetadata {
  title?: string;
  artist?: string;
  album?: string;
  duration?: number;
  bitrate?: number;
}

/**
 * Result of file type detection
 */
export interface FileTypeResult {
  ext: string;
  mime: string;
}

/**
 * A single item for batch conversion
 */
export interface BatchInput {
  /** File path, base64 data URL, or Buffer */
  input: ConverterInput;
  /** Optional converter options (e.g. forceExtension) */
  options?: ConverterOptions;
}

/**
 * Result for a single batch conversion item
 */
export interface BatchResult {
  /** Input identifier — file path if string, 'buffer:<index>' for Buffer inputs */  
  inputId: string;
  /** Converted Markdown content, present on success */
  result?: string;
  /** Error message, present on failure */
  error?: string;
}
