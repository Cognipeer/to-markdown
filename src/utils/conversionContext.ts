import type {
  ConverterOptions,
  DetailedConversion,
  ImageReport,
  OCROptions,
  PageReport,
} from '../types/index.js';
import { combineSignals, type CombinedSignal } from './abort.js';
import { TesseractSession } from './tesseract.js';

/** Counters collected during one conversion (see `DetailedConversion.stats`). */
export interface ConversionStats {
  pageCount?: number;
  ocrCalls: number;
  ocrPages: number;
  ocrImages: number;
  ocrMs: number;
  renderMs: number;
}

/**
 * Per-conversion state shared by `convertToMarkdown` and the converters. It is
 * threaded through the internal converters as an OPTIONAL trailing parameter;
 * converters called without one (tests, direct use) behave exactly as before.
 *
 * Later features only add to it: PDF page decisions fill `pages`, embedded
 * image OCR fills `images`, everything shares `warnings`, `stats`, the combined
 * abort `signal` and the lazily created tesseract session.
 */
export interface ConversionContext {
  /** The options the conversion was started with */
  readonly options: ConverterOptions;
  /** `options.ocr` as an object (`{}` for `ocr: true`), `undefined` when OCR is off */
  readonly ocr: OCROptions | undefined;
  /** `"code: detail"` strings */
  readonly warnings: string[];
  readonly stats: ConversionStats;
  /** Page reports (PDF / TIFF), in page order once finished */
  pages: PageReport[];
  /** Image reports (image files, embedded images) */
  images: ImageReport[];
  /** `ocr.signal` combined with the context's own cancellation (undefined without either) */
  readonly signal: AbortSignal | undefined;
  /** Appends a `"code: detail"` warning */
  warn(code: string, detail: string): void;
  /** The shared tesseract engine of this conversion (created on first use) */
  getTesseract(opts: OCROptions): TesseractSession;
  /** Cancels in-flight work started by this conversion */
  abort(reason?: unknown): void;
  /** Terminates the tesseract session and releases listeners. Safe to call twice. */
  dispose(): Promise<void>;
  /** Assembles the result object for `convertToMarkdownDetailed` */
  finish(markdown: string, extension: string): DetailedConversion;
}

export function createConversionContext(options: ConverterOptions = {}): ConversionContext {
  const ocr: OCROptions | undefined =
    options.ocr === undefined || options.ocr === null || options.ocr === false
      ? undefined
      : typeof options.ocr === 'object'
        ? options.ocr
        : {};

  const controller = new AbortController();
  const combined: CombinedSignal = combineSignals(ocr?.signal, controller.signal);
  const warnings: string[] = [];
  let tesseract: TesseractSession | undefined;
  let disposed = false;

  const ctx: ConversionContext = {
    options,
    ocr,
    warnings,
    stats: { ocrCalls: 0, ocrPages: 0, ocrImages: 0, ocrMs: 0, renderMs: 0 },
    pages: [],
    images: [],
    signal: combined.signal,
    warn(code, detail) {
      warnings.push(`${code}: ${detail}`);
    },
    getTesseract(opts) {
      if (!tesseract) tesseract = new TesseractSession(opts, (code, detail) => ctx.warn(code, detail));
      return tesseract;
    },
    abort(reason) {
      controller.abort(reason);
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      // Stop stragglers (e.g. tasks still running after an abort), then release the engine.
      if (!controller.signal.aborted) controller.abort();
      combined.dispose();
      const session = tesseract;
      tesseract = undefined;
      if (session) await session.terminate().catch(() => undefined);
    },
    finish(markdown, extension) {
      const result: DetailedConversion = {
        markdown,
        extension,
        warnings: [...warnings],
        stats: { ...ctx.stats },
      };
      if (ctx.pages.length > 0) result.pages = [...ctx.pages].sort((a, b) => a.page - b.page);
      if (ctx.images.length > 0) result.images = [...ctx.images];
      return result;
    },
  };
  return ctx;
}

/**
 * Runs `fn` with the given conversion context, or with a private one (disposed
 * afterwards) when a converter is called directly without one.
 */
export async function withConversionContext<T>(
  ctx: ConversionContext | undefined,
  options: ConverterOptions,
  fn: (ctx: ConversionContext) => Promise<T>
): Promise<T> {
  if (ctx) return fn(ctx);
  const own = createConversionContext(options);
  try {
    return await fn(own);
  } finally {
    await own.dispose();
  }
}
