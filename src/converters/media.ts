import { imageDimensionsFromData } from 'image-dimensions';
import { lookup } from 'mime-types';
import { parseBuffer } from 'music-metadata';
import { formatMarkdown } from '../utils/markdown.js';
import type { ImageReport, OCRImageKind, OCROptions } from '../types/index.js';
import { withConversionContext, type ConversionContext } from '../utils/conversionContext.js';
import { countChars } from '../utils/chars.js';
import { sniffImageMimeType } from '../utils/imageTranscode.js';
import { OcrTimeoutError, ocrConcurrency, runOcrTasks, type OcrTask, type OcrTaskOutcome } from '../utils/ocrRunner.js';

function imageMimeType(
  ext: string,
  fileName?: string,
  formatType?: string
): string | undefined {
  if (formatType) {
    const fromDetectedFormat = lookup(
      `file.${formatType === 'jpg' ? 'jpeg' : formatType}`
    );
    if (fromDetectedFormat) return fromDetectedFormat;
  }

  const normalizedExt = (ext.startsWith('.') ? ext : `.${ext}`).toLowerCase();
  const fromExtension = lookup(`file${normalizedExt}`);
  if (fromExtension) return fromExtension;

  const fromFileName = fileName ? lookup(fileName) : false;
  if (fromFileName) return fromFileName;

  return undefined;
}

/**
 * Converts image buffer to Markdown with metadata.
 * Pass `ocr: true` (or an OCROptions object) to also extract text via Tesseract.js.
 * Requires optional peer dep for OCR: npm install tesseract.js
 *
 * @param buffer   - Image file buffer
 * @param ext      - File extension
 * @param ocr      - OCR option (opt-in, default off)
 * @param fileName - Original file name from ConverterOptions, when provided
 * @param ctx      - Conversion context (reports, warnings, shared OCR engine); internal
 */
export async function convertImageToMarkdown(
  buffer: Buffer,
  ext: string,
  ocr?: boolean | OCROptions,
  fileName?: string,
  ctx?: ConversionContext
): Promise<string> {
  return withConversionContext(ctx, { ocr }, (conv) =>
    convertImage(buffer, ext, ocr, fileName, conv)
  );
}

/** Wraps an error that must leave `convertImage` unchanged (no "Failed to convert image" prefix). */
class PassThroughError extends Error {
  constructor(public readonly original: unknown) {
    super('pass-through');
  }
}

interface MeasuredImage {
  width: number;
  height: number;
  type: string;
}

/** Formats `image-dimensions` cannot always measure; they get the sharp / canvas fallbacks. */
const FALLBACK_EXTENSIONS = new Set(['.tif', '.tiff', '.webp', '.bmp']);

/** Spelling of a format in the `Format:` header (`jpeg` -> `jpg`, `tif` -> `tiff`). */
function headerType(type: string): string {
  const t = type.toLowerCase();
  if (t === 'jpeg') return 'jpg';
  if (t === 'tif') return 'tiff';
  return t;
}

/**
 * Measures formats `image-dimensions` could not read: sharp for TIFF / WebP,
 * the bundled canvas for BMP (which sharp cannot decode).
 */
async function measureFallback(buffer: Buffer, ext: string): Promise<MeasuredImage | undefined> {
  const sniffed = sniffImageMimeType(buffer);
  if (sniffed !== 'image/bmp') {
    try {
      const sharp = (await import('sharp')).default;
      const meta = await sharp(buffer).metadata();
      if (meta.width && meta.height) {
        return { width: meta.width, height: meta.height, type: headerType(meta.format ?? 'image') };
      }
    } catch {
      /* try the canvas below */
    }
  }
  try {
    const { loadImage } = await import('@napi-rs/canvas');
    const image = await loadImage(buffer);
    if (image.width && image.height) {
      const type =
        sniffed && sniffed.startsWith('image/')
          ? headerType(sniffed.slice('image/'.length))
          : headerType(ext.replace(/^\./, ''));
      return { width: image.width, height: image.height, type };
    }
  } catch {
    /* unsupported */
  }
  return undefined;
}

/** Number of pages (frames) of a TIFF; 1 when it cannot be read. */
async function tiffPageCount(buffer: Buffer): Promise<number> {
  try {
    const sharp = (await import('sharp')).default;
    const meta = await sharp(buffer).metadata();
    return meta.pages && meta.pages > 0 ? meta.pages : 1;
  } catch {
    return 1;
  }
}

interface PreparedImage {
  buffer: Buffer;
  mimeType?: string;
  width?: number;
  height?: number;
}

/**
 * Applies the EXIF orientation of `buffer` (sharp `.rotate()`) when it is greater
 * than 1. Returns `undefined` when nothing needs to change or sharp cannot read it,
 * so callers keep the original bytes.
 */
async function autoRotateImage(buffer: Buffer, mimeType?: string): Promise<PreparedImage | undefined> {
  try {
    const sharp = (await import('sharp')).default;
    const meta = await sharp(buffer).metadata();
    if (!meta.orientation || meta.orientation <= 1) return undefined;
    const pipeline = sharp(buffer).rotate();
    const keepJpeg = meta.format === 'jpeg';
    const { data, info } = await (keepJpeg ? pipeline.jpeg({ quality: 92 }) : pipeline.png()).toBuffer({
      resolveWithObject: true,
    });
    return {
      buffer: data,
      mimeType: keepJpeg ? 'image/jpeg' : 'image/png',
      width: info.width,
      height: info.height,
    };
  } catch {
    return undefined;
  }
}

/** Renders page `index` (0-based) of a TIFF as PNG, honouring its orientation tag. */
async function renderTiffPage(buffer: Buffer, index: number, autoRotate: boolean): Promise<PreparedImage> {
  const sharp = (await import('sharp')).default;
  let pipeline = sharp(buffer, { page: index });
  if (autoRotate) pipeline = pipeline.rotate();
  // Fixed density: low TIFF resolutions make Leptonica print 'Invalid resolution' warnings.
  const { data, info } = await pipeline.withMetadata({ density: 300 }).png().toBuffer({ resolveWithObject: true });
  return { buffer: data, mimeType: 'image/png', width: info.width, height: info.height };
}

async function convertImage(
  buffer: Buffer,
  ext: string,
  ocr: boolean | OCROptions | undefined,
  fileName: string | undefined,
  conv: ConversionContext
): Promise<string> {
  try {
    let measured: MeasuredImage | undefined | null = imageDimensionsFromData(buffer) as
      | MeasuredImage
      | undefined
      | null;
    if (!measured && FALLBACK_EXTENSIONS.has(ext.toLowerCase())) {
      measured = await measureFallback(buffer, ext);
    }
    if (!measured) {
      throw new Error('unsupported or invalid image data');
    }

    // `image-dimensions` reports JPEG as `jpeg`; the rest of this package (and
    // its Markdown output) uses the `jpg` spelling.
    const dimensions = {
      width: measured.width,
      height: measured.height,
      type: measured.type === 'jpeg' ? 'jpg' : measured.type === 'tif' ? 'tiff' : measured.type,
    };

    const isTiff = dimensions.type === 'tiff' || sniffImageMimeType(buffer) === 'image/tiff';
    const pageCount = isTiff ? await tiffPageCount(buffer) : 1;

    let md = '';

    if (conv.options.imageMetadata !== false) {
      if (dimensions.width && dimensions.height) {
        md += `ImageSize: ${dimensions.width}x${dimensions.height}\n`;
      }

      if (dimensions.type) {
        md += `Format: ${dimensions.type}\n`;
      }

      if (pageCount > 1) {
        md += `Pages: ${pageCount}\n`;
      }
    }

    const report: ImageReport = {
      index: 0,
      kind: 'image',
      width: dimensions.width,
      height: dimensions.height,
      ocr: false,
    };
    if (fileName) report.path = fileName;
    conv.images.push(report);

    // OCR — opt-in only
    if (ocr) {
      const ocrOpts: OCROptions = typeof ocr === 'object' ? ocr : {};
      md += await ocrImageFile(buffer, ext, ocrOpts, fileName, dimensions, isTiff, pageCount, report, conv);
    }

    return formatMarkdown(md);
  } catch (err: any) {
    if (err instanceof PassThroughError) throw err.original;
    throw new Error(`Failed to convert image: ${err.message}`);
  }
}

/** Runs OCR for an image file (all pages of a TIFF) and returns the Markdown to append. */
async function ocrImageFile(
  buffer: Buffer,
  ext: string,
  ocrOpts: OCROptions,
  fileName: string | undefined,
  dimensions: { width?: number; height?: number; type?: string },
  isTiff: boolean,
  pageCount: number,
  report: ImageReport,
  conv: ConversionContext
): Promise<string> {
  const autoRotate = ocrOpts.autoRotate !== false;
  const multiPage = isTiff && pageCount > 1;
  const kind: OCRImageKind = multiPage ? 'tiff-page' : 'image';
  const label = fileName ?? 'image';
  const onError = ocrOpts.onError ?? 'comment';
  const mimeType = imageMimeType(ext, fileName, dimensions.type);

  let outcomes: OcrTaskOutcome<string>[];
  try {
    const { ocrImageDetailed } = await import('../utils/ocr.js');
    // `maxPages` caps the OCR calls of a multi-page TIFF; the remaining frames are skipped.
    const pageLimit = Number.isFinite(ocrOpts.maxPages) && ocrOpts.maxPages! >= 1 ? Math.floor(ocrOpts.maxPages!) : undefined;
    const taskCount = isTiff ? (pageLimit ? Math.min(pageCount, pageLimit) : pageCount) : 1;
    if (multiPage && taskCount < pageCount) {
      conv.warn('ocr_page_limit', `${label}: ${pageCount} pages, ${taskCount} processed`);
    }
    const tasks: OcrTask<string>[] = [];
    for (let i = 0; i < taskCount; i++) {
      tasks.push({
        page: multiPage ? i + 1 : undefined,
        run: async (signal) => {
          let input: PreparedImage = {
            buffer,
            mimeType,
            width: dimensions.width,
            height: dimensions.height,
          };
          if (isTiff) {
            // tesseract.js and several VLM APIs cannot read TIFF: hand over PNG frames.
            input = await renderTiffPage(buffer, i, autoRotate);
          } else if (autoRotate && dimensions.type !== 'gif' && dimensions.type !== 'bmp') {
            const rotated = await autoRotateImage(buffer, mimeType);
            if (rotated) input = rotated;
          }
          const result = await ocrImageDetailed(
            input.buffer,
            ocrOpts,
            {
              mimeType: input.mimeType,
              sourceExtension: ext,
              fileName,
              imageWidth: input.width,
              imageHeight: input.height,
              kind,
              index: i,
              ...(multiPage ? { page: i + 1, pageCount } : {}),
              ...(signal ? { signal } : {}),
            },
            conv
          );
          return result.markdown ?? result.text;
        },
      });
    }
    outcomes = await runOcrTasks(tasks, {
      concurrency: ocrConcurrency(ocrOpts),
      timeoutMs: ocrOpts.timeoutMs,
      signal: conv.signal,
      onProgress: ocrOpts.onProgress,
      kind,
    });
  } catch (ocrErr: any) {
    // Runner-level failure (cancellation or a missing OCR module): same handling as a failed image.
    if (conv.signal && conv.signal.aborted) throw new PassThroughError(ocrErr);
    return failImage(ocrErr, label, report, conv, onError);
  }

  const parts: string[] = [];
  let hasText = false;
  let textChars = 0;
  let firstError: Error | undefined;
  outcomes.forEach((outcome, i) => {
    const page = i + 1;
    if (outcome.status === 'ok') {
      if (outcome.value) {
        hasText = true;
        parts.push(outcome.value);
        textChars += countChars(outcome.value);
      }
      if (multiPage) {
        conv.pages.push({
          page,
          source: outcome.value ? 'ocr' : 'empty',
          chars: countChars(outcome.value),
          ms: outcome.ms,
        });
      }
      return;
    }
    if (outcome.status !== 'error') return;
    firstError ??= outcome.error;
    if (multiPage) {
      conv.pages.push({ page, source: 'error', chars: 0, error: outcome.error.message, ms: outcome.ms });
      if (outcome.timedOut) conv.warn('ocr_timeout', `${label} page ${page}`);
      else conv.warn('ocr_page_failed', `${label} page ${page}: ${outcome.error.message}`);
      if (onError === 'comment') {
        parts.push(`<!-- OCR failed (page ${page}): ${outcome.error.message} -->`);
      }
    }
  });
  if (multiPage) {
    for (let page = outcomes.length + 1; page <= pageCount; page++) {
      conv.pages.push({ page, source: 'skipped', chars: 0 });
    }
    conv.stats.pageCount = pageCount;
  }

  if (firstError && onError === 'throw') throw new PassThroughError(firstError);

  let out = '';
  if (hasText) {
    report.ocr = true;
    report.chars = textChars;
    out += `\n\n## Extracted Text\n\n${parts.join('\n\n')}\n`;
  } else if (firstError) {
    report.error = firstError.message;
    if (!multiPage) {
      if (firstError instanceof OcrTimeoutError) conv.warn('ocr_timeout', label);
      else conv.warn('ocr_image_failed', `${label}: ${firstError.message}`);
    }
    if (onError === 'comment') out += `\n\n<!-- OCR failed: ${firstError.message} -->\n`;
  }
  return out;
}

function failImage(
  err: any,
  label: string,
  report: ImageReport,
  conv: ConversionContext,
  onError: 'comment' | 'skip' | 'throw'
): string {
  report.error = err.message;
  if (err instanceof OcrTimeoutError) conv.warn('ocr_timeout', label);
  else conv.warn('ocr_image_failed', `${label}: ${err.message}`);
  if (onError === 'throw') throw new PassThroughError(err);
  if (onError === 'comment') return `\n\n<!-- OCR failed: ${err.message} -->\n`;
  return '';
}

/**
 * Converts audio buffer to Markdown with metadata
 * @param buffer - Audio file buffer
 * @param ext - File extension
 * @returns Markdown string with audio metadata
 */
export async function convertAudioToMarkdown(
  buffer: Buffer,
  ext: string
): Promise<string> {
  try {
    const { parseBuffer } = await import('music-metadata');
    const metadata = await parseBuffer(buffer);
    let md = '';

    if (metadata.common.title) md += `Title: ${metadata.common.title}\n`;
    if (metadata.common.artist) md += `Artist: ${metadata.common.artist}\n`;
    if (metadata.common.album) md += `Album: ${metadata.common.album}\n`;
    if (metadata.format.duration)
      md += `Duration: ${metadata.format.duration} sec\n`;
    if (metadata.format.bitrate)
      md += `Bitrate: ${metadata.format.bitrate} kbps\n`;

    // TODO: Add speech-to-text transcription

    return formatMarkdown(md);
  } catch (err: any) {
    throw new Error(`Failed to convert audio: ${err.message}`);
  }
}
