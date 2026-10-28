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
 * What kind of image an OCR call is working on.
 * - `'pdf-page'`       - a rendered PDF page
 * - `'image'`          - a standalone image file
 * - `'tiff-page'`      - one frame of a multi-page TIFF
 * - `'embedded-image'` - an image inside DOCX/PPTX/HTML/...
 */
export type OCRImageKind = 'pdf-page' | 'image' | 'tiff-page' | 'embedded-image';

/**
 * Context passed to a custom OCR handler.
 */
export interface OCRHandlerContext {
  /** 1-based page number (PDF pages and TIFF frames) */
  page?: number;
  /** Total pages in the PDF / TIFF */
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
  /** What the buffer is: a PDF page, an image file, a TIFF frame or an embedded image */
  kind?: OCRImageKind;
  /** 0-based index of the image within the document (embedded images) */
  index?: number;
  /** Path of the image inside its container, e.g. `word/media/image1.png` */
  sourcePath?: string;
  /** 1-based slide number (PPTX embedded images) */
  slide?: number;
  /** Languages the caller expects, as ISO 639-1 codes (e.g. `['tr', 'en']`) */
  langHint?: string[];
  /** Aborted when the conversion is cancelled or the task times out */
  signal?: AbortSignal;
}

/**
 * Rich result a handler may return instead of a plain string.
 */
export interface OCRHandlerResult {
  /** Plain text */
  text: string;
  /** Markdown rendering of the same content; preferred over `text` when present */
  markdown?: string;
  /** Engine confidence, 0-100 or 0-1 as reported by the engine */
  confidence?: number;
}

/**
 * Custom OCR callback. May resolve to a plain string (3.5.0 behaviour) or to an
 * {@link OCRHandlerResult}.
 */
export type OCRHandler = (
  buffer: Buffer,
  context: OCRHandlerContext
) => Promise<string | OCRHandlerResult>;

/** Context passed to an {@link OCRDocumentHandler}. */
export interface OCRDocumentHandlerContext {
  /** 1-based page numbers that need OCR */
  pages: number[];
  /** Total number of pages in the document */
  pageCount: number;
  fileName?: string;
  /** Languages the caller expects, as ISO 639-1 codes */
  langHint?: string[];
  signal?: AbortSignal;
}

/**
 * Whole-document OCR callback: receives the PDF once and returns the text of the
 * requested pages (instead of one call per rendered page).
 */
export type OCRDocumentHandler = (
  pdf: Buffer,
  context: OCRDocumentHandlerContext
) => Promise<Array<{ page: number; text: string; markdown?: string }>>;

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
  /** Retries on HTTP 429 / 5xx / network errors, with 1 s, 2 s, ... backoff (default: 2). `Retry-After` up to 30 s is honoured. */
  retries?: number;
  /** Timeout of one HTTP attempt in milliseconds (default: none) */
  timeoutMs?: number;
}

/**
 * PDF OCR mode.
 * - `'auto'`      - OCR the whole document only when the text layer is empty (default)
 * - `'auto-page'` - OCR only the pages whose text layer is missing or unusable
 * - `'always'`    - OCR every page and replace the text layer
 * - `'never'`     - never OCR
 */
export type OCRPdfMode = 'auto' | 'auto-page' | 'always' | 'never';

/** Decides which PDF pages are OCR candidates in `pdfMode: 'auto-page'`. */
export interface OCRPageTrigger {
  /** Page is a candidate when its text layer has fewer non-whitespace chars. Default 32. */
  minChars?: number;
  /** Candidate when garbled-char ratio of the text layer exceeds this (0 disables). Default 0.3. */
  maxGarbledRatio?: number;
  /** For pages with SOME text (< minChars): require a raster image on the page. Default true. */
  requireImage?: boolean;
}

/** How PDF pages are rasterised before OCR. */
export interface OCRRenderOptions {
  /** Render scale (default 2) */
  scale?: number;
  /** Maximum width*height in pixels; scale is reduced to fit (default 40_000_000) */
  maxPixels?: number;
  /** Output image format (default 'png') */
  format?: 'png' | 'jpeg';
  /** JPEG quality (default 85) */
  jpegQuality?: number;
  /** Convert to grayscale before OCR (default false) */
  grayscale?: boolean;
}

/** Progress notification emitted by the OCR pipeline. */
export interface OCRProgressEvent {
  kind: OCRImageKind;
  /** Number of OCR tasks finished so far */
  completed: number;
  /** Number of OCR tasks scheduled */
  total: number;
  page?: number;
}

/** Local Tesseract engine settings. */
export interface TesseractOptions {
  /** Directory or URL holding `<lang>.traineddata[.gz]` files */
  langPath?: string;
  /** Directory where downloaded language data is cached */
  cachePath?: string;
  /** Never download language data: requires `langPath`; fails fast when a language file is missing. */
  offline?: boolean;
  /** Page segmentation mode (`tessedit_pageseg_mode`) */
  psm?: number;
  /** OCR engine mode */
  oem?: number;
  /** Language files are gzip-compressed (`.traineddata.gz`). Default true (tesseract.js default). */
  gzip?: boolean;
}

/** Which embedded images are OCRed when `OCROptions.embeddedImages` is on. */
export interface EmbeddedImageOCROptions {
  /** Skip images narrower than this many pixels (default 64) */
  minWidth?: number;
  /** Skip images shorter than this many pixels (default 64) */
  minHeight?: number;
  /** OCR at most this many images per document (default 50) */
  maxImages?: number;
  /** OCR identical images (same sha1) only once (default true) */
  dedupe?: boolean;
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
  /**
   * Tesseract language: tesseract codes (`'eng'`, `'tur+eng'`), ISO 639-1 codes
   * (`'tr'`, `'tr+en'`) or an array of either (default: 'eng'). Mapped with
   * `toTesseractLang` for the 'tesseract' provider; handlers receive ISO codes as `langHint`.
   */
  lang?: string | string[];
  /** PDF OCR mode: 'auto' = fallback when no text found, 'auto-page' = per page, 'always' = always OCR, 'never' = skip (default: 'auto') */
  pdfMode?: OCRPdfMode;
  /** VLM configuration — required when provider is any VLM type */
  vlm?: VLMOptions;
  /** Required when provider is 'handler'. Library performs no HTTP calls. */
  handler?: OCRHandler;
  /** Which pages are OCR candidates in `pdfMode: 'auto-page'` */
  pageTrigger?: OCRPageTrigger;
  /** How PDF pages are rasterised before OCR */
  render?: OCRRenderOptions;
  /** OCR at most this many pages / candidate pages (also frames of a multi-page TIFF) */
  maxPages?: number;
  /** Number of OCR tasks run in parallel (default 1). With the tesseract provider it is capped at 4 (one worker each). */
  concurrency?: number;
  /** Timeout of one OCR task (one page, image or `documentHandler` call) in milliseconds (default: none) */
  timeoutMs?: number;
  /** Cancels the conversion: the returned promise rejects with an AbortError */
  signal?: AbortSignal;
  /** Called after every finished OCR task */
  onProgress?: (event: OCRProgressEvent) => void;
  /**
   * What to do when OCR of a page/image fails. Default is the legacy behaviour of
   * each format (`'comment'` for images, `'skip'` for `auto-page` PDFs and for
   * images embedded in DOCX/PPTX/HTML, where a failure is recorded in the report and
   * as an `ocr_image_failed` warning). Does not apply to the legacy `auto` / `always`
   * PDF modes, which keep their 3.5.0 behaviour (throw `PDF OCR failed:` without a text
   * layer, otherwise keep the text layer).
   */
  onError?: 'comment' | 'skip' | 'throw';
  /**
   * OCR the whole PDF in a single call instead of rendering one image per page.
   * `timeoutMs` and `signal` then apply to that one call (the whole document), not per page.
   */
  documentHandler?: OCRDocumentHandler;
  /** Local Tesseract engine settings (language data location, offline mode, psm) */
  tesseract?: TesseractOptions;
  /** OCR images embedded in DOCX/PPTX/HTML (default off) */
  embeddedImages?: boolean | EmbeddedImageOCROptions;
  /** Honour the EXIF orientation of image files before OCR (default true) */
  autoRotate?: boolean;
}

export interface DocOptions {
  includeHeaders?: boolean;
  includeFootnotes?: boolean;
  maxInputBytes?: number;
  maxOutputChars?: number;
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
  /** Options for binary Word DOC conversion */
  doc?: DocOptions;
  /**
   * How images embedded in DOCX/HTML/EPUB/PPTX are rendered: `'inline'` (default,
   * data URIs as in 3.5.0), `'placeholder'` (`image-<n>.<ext>`) or `'omit'`.
   */
  images?: 'inline' | 'placeholder' | 'omit';
  /** Image files: emit the `ImageSize:` / `Format:` header (default true) */
  imageMetadata?: boolean;
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
  DOC = '.doc',
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
  TIF = '.tif',
  TIFF = '.tiff',
  WEBP = '.webp',
  BMP = '.bmp',
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

/** Per-page outcome of a PDF conversion (see {@link DetailedConversion}). */
export interface PageReport {
  /** 1-based page number */
  page: number;
  /** Where the page text came from */
  source: 'text' | 'ocr' | 'empty' | 'error' | 'skipped';
  /** Number of non-whitespace characters in the final page text */
  chars: number;
  reason?: 'no-text' | 'low-text' | 'garbled' | 'always' | 'auto';
  error?: string;
  /** OCR time for this page in milliseconds */
  ms?: number;
}

/** Per-image outcome of a conversion (see {@link DetailedConversion}). */
export interface ImageReport {
  index: number;
  kind: OCRImageKind;
  path?: string;
  width?: number;
  height?: number;
  /** Whether OCR text was obtained for this image */
  ocr: boolean;
  /** Number of non-whitespace characters of the OCR text */
  chars?: number;
  skipped?: 'small' | 'duplicate' | 'limit';
  error?: string;
}

/** Result of `convertToMarkdownDetailed`. */
export interface DetailedConversion {
  /** Exactly what `convertToMarkdown` returns for the same input and options */
  markdown: string;
  /** Detected file extension, including the dot */
  extension: string;
  pages?: PageReport[];
  images?: ImageReport[];
  /** `"code: detail"` strings such as `ocr_page_failed: page 3: <msg>` */
  warnings: string[];
  stats: {
    pageCount?: number;
    ocrCalls: number;
    ocrPages: number;
    ocrImages: number;
    ocrMs: number;
    renderMs: number;
  };
}
