import type { CheerioAPI } from 'cheerio';
import { createHash } from 'crypto';
import { imageDimensionsFromData } from 'image-dimensions';
import { lookup } from 'mime-types';
import type {
  ConverterOptions,
  EmbeddedImageOCROptions,
  ImageReport,
  OCROptions,
} from '../types/index.js';
import type { ConversionContext } from './conversionContext.js';
import { countChars } from './chars.js';
import { sniffImageMimeType, transcodeToPng } from './imageTranscode.js';
import { OcrTimeoutError, runOcrTasks, type OcrTask } from './ocrRunner.js';

/** How embedded images appear in the Markdown (`ConverterOptions.images`). */
export type EmbeddedImageMode = 'inline' | 'placeholder' | 'omit';

/** What the embedded-image handling of one conversion is asked to do. */
export interface EmbeddedImagePolicy {
  /** `images` option (`'inline'` = 3.5.0 behaviour) */
  mode: EmbeddedImageMode;
  /** OCR options when `ocr.embeddedImages` is on, otherwise `undefined` */
  ocr: OCROptions | undefined;
  /** Resolved `ocr.embeddedImages` limits */
  limits: Required<EmbeddedImageOCROptions>;
}

const DEFAULT_LIMITS: Required<EmbeddedImageOCROptions> = {
  minWidth: 64,
  minHeight: 64,
  maxImages: 50,
  dedupe: true,
};

/**
 * Decides whether embedded-image handling is active. It is only active when the
 * caller opted in (`images` other than `'inline'`, or `ocr.embeddedImages`);
 * otherwise `undefined` is returned and the converters run exactly as in 3.5.0.
 *
 * @param allowOcr - false for formats whose images are never OCRed (EPUB)
 */
export function resolveEmbeddedImagePolicy(
  options: ConverterOptions | undefined,
  allowOcr = true
): EmbeddedImagePolicy | undefined {
  if (!options) return undefined;
  const mode: EmbeddedImageMode =
    options.images === 'placeholder' || options.images === 'omit' ? options.images : 'inline';
  let ocr: OCROptions | undefined;
  let limits = DEFAULT_LIMITS;
  const ocrOption = options.ocr;
  if (allowOcr && ocrOption && typeof ocrOption === 'object' && ocrOption.embeddedImages) {
    ocr = ocrOption;
    if (typeof ocrOption.embeddedImages === 'object') {
      const custom = ocrOption.embeddedImages;
      limits = {
        minWidth: custom.minWidth ?? DEFAULT_LIMITS.minWidth,
        minHeight: custom.minHeight ?? DEFAULT_LIMITS.minHeight,
        maxImages: custom.maxImages ?? DEFAULT_LIMITS.maxImages,
        dedupe: custom.dedupe ?? DEFAULT_LIMITS.dedupe,
      };
    }
  }
  if (mode === 'inline' && !ocr) return undefined;
  return { mode, ocr, limits };
}

/** File extension for an image content type (`image/jpeg` -> `jpg`, unknown -> `bin`). */
export function imageExtensionFor(mimeType: string | undefined): string {
  const type = (mimeType ?? '').split(';')[0].trim().toLowerCase();
  switch (type) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
    case 'image/jpg':
    case 'image/pjpeg':
      return 'jpg';
    case 'image/gif':
      return 'gif';
    case 'image/bmp':
    case 'image/x-ms-bmp':
      return 'bmp';
    case 'image/tiff':
    case 'image/tif':
      return 'tiff';
    case 'image/svg+xml':
      return 'svg';
    case 'image/webp':
      return 'webp';
    case 'image/emf':
    case 'image/x-emf':
      return 'emf';
    case 'image/wmf':
    case 'image/x-wmf':
      return 'wmf';
    default:
      return 'bin';
  }
}

/** One image found in a document. */
export interface EmbeddedImageInput {
  buffer: Buffer;
  /** Declared content type; sniffed from the bytes / path when missing */
  mimeType?: string;
  /** Path inside the container, e.g. `word/media/image1.png` */
  sourcePath?: string;
  /** 1-based slide number (PPTX) */
  slide?: number;
}

export interface EmbeddedImageEntry {
  /** 0-based position in the document */
  index: number;
  mimeType?: string;
  /** `image-<index + 1>.<ext>` */
  placeholder: string;
  report: ImageReport;
  /** OCR result as a Markdown blockquote (no leading blank line), or an error comment; '' when none */
  block: string;
  input: EmbeddedImageInput;
  queued: boolean;
  /** OCR already ran for this entry */
  ocrDone: boolean;
}

/**
 * Bookkeeping for the images of one document: numbering, size filter, sha1 dedupe,
 * the `maxImages` cap, OCR through the shared runner and the image reports.
 *
 * Usage: `register()` every image in document order, `await runOcr()`, then read
 * `entry.block` while assembling the Markdown.
 */
export class EmbeddedImageSession {
  readonly entries: EmbeddedImageEntry[] = [];
  private readonly seen = new Set<string>();
  private limited = 0;

  constructor(
    private readonly conv: ConversionContext,
    readonly policy: EmbeddedImagePolicy
  ) {}

  /** Registers the next image (document order) and decides whether it is OCRed. */
  register(input: EmbeddedImageInput): EmbeddedImageEntry {
    const index = this.entries.length;
    const mimeType = this.resolveMime(input);
    let width: number | undefined;
    let height: number | undefined;
    try {
      const dims = imageDimensionsFromData(input.buffer);
      if (dims) {
        width = dims.width;
        height = dims.height;
      }
    } catch {
      /* unknown size: OCR anyway */
    }

    const report: ImageReport = { index, kind: 'embedded-image', ocr: false };
    if (input.sourcePath) report.path = input.sourcePath;
    if (width !== undefined) report.width = width;
    if (height !== undefined) report.height = height;
    this.conv.images.push(report);

    const entry: EmbeddedImageEntry = {
      index,
      mimeType,
      placeholder: `image-${index + 1}.${imageExtensionFor(mimeType)}`,
      report,
      block: '',
      input,
      queued: false,
      ocrDone: false,
    };
    this.entries.push(entry);

    if (!this.policy.ocr) return entry;

    const { minWidth, minHeight, maxImages, dedupe } = this.policy.limits;
    if ((width !== undefined && width < minWidth) || (height !== undefined && height < minHeight)) {
      report.skipped = 'small';
      return entry;
    }
    const hash = dedupe ? createHash('sha1').update(input.buffer).digest('hex') : undefined;
    if (hash && this.seen.has(hash)) {
      report.skipped = 'duplicate';
      return entry;
    }
    if (this.queuedCount() >= maxImages) {
      report.skipped = 'limit';
      this.limited++;
      return entry;
    }
    if (hash) this.seen.add(hash);
    entry.queued = true;
    return entry;
  }

  private queuedCount(): number {
    let n = 0;
    for (const e of this.entries) if (e.queued) n++;
    return n;
  }

  private resolveMime(input: EmbeddedImageInput): string | undefined {
    const declared = input.mimeType?.split(';')[0].trim().toLowerCase();
    if (declared && declared !== 'application/octet-stream') return declared;
    const sniffed = sniffImageMimeType(input.buffer);
    if (sniffed) return sniffed;
    if (input.sourcePath) {
      const guessed = lookup(input.sourcePath);
      if (guessed) return guessed;
    }
    return declared;
  }

  /** Runs OCR for every queued image and fills `entry.block` / the reports. */
  async runOcr(): Promise<void> {
    const ocr = this.policy.ocr;
    if (!ocr) return;
    const queued = this.entries.filter((e) => e.queued && !e.ocrDone);
    if (this.limited > 0) {
      this.conv.warn(
        'ocr_image_limit',
        `${queued.length + this.limited} images, ${queued.length} processed (maxImages ${this.policy.limits.maxImages})`
      );
    }
    if (queued.length === 0) return;

    const onError = ocr.onError ?? 'skip';
    const { ocrImageDetailed } = await import('./ocr.js');
    const tasks: Array<OcrTask<string>> = queued.map((entry) => ({
      run: async (signal) => {
        const prepared = await this.prepare(entry);
        const result = await ocrImageDetailed(
          prepared.buffer,
          ocr,
          {
            kind: 'embedded-image',
            index: entry.index,
            mimeType: prepared.mimeType,
            sourceExtension: `.${imageExtensionFor(prepared.mimeType)}`,
            ...(entry.input.sourcePath ? { sourcePath: entry.input.sourcePath } : {}),
            ...(entry.input.slide !== undefined ? { slide: entry.input.slide } : {}),
            ...(this.conv.options.fileName ? { fileName: this.conv.options.fileName } : {}),
            ...(entry.report.width !== undefined ? { imageWidth: entry.report.width } : {}),
            ...(entry.report.height !== undefined ? { imageHeight: entry.report.height } : {}),
            ...(signal ? { signal } : {}),
          },
          this.conv
        );
        return result.markdown ?? result.text;
      },
    }));

    // Cancellation rejects here and is never swallowed by `onError`.
    const outcomes = await runOcrTasks(tasks, {
      concurrency: ocr.concurrency,
      timeoutMs: ocr.timeoutMs,
      signal: this.conv.signal,
      onProgress: ocr.onProgress,
      kind: 'embedded-image',
      stopOnError: onError === 'throw',
    });

    let firstError: Error | undefined;
    outcomes.forEach((outcome, i) => {
      const entry = queued[i];
      entry.ocrDone = true;
      // Release the picture bytes; they are not needed any more.
      entry.input = { ...entry.input, buffer: Buffer.alloc(0) };
      const label = entry.input.sourcePath ?? entry.placeholder;
      if (outcome.status === 'ok') {
        if (outcome.value) {
          entry.report.ocr = true;
          entry.report.chars = countChars(outcome.value);
          entry.block = toBlockquote(outcome.value);
        }
        return;
      }
      if (outcome.status !== 'error') return;
      firstError ??= outcome.error;
      entry.report.error = outcome.error.message;
      if (outcome.error instanceof OcrTimeoutError) this.conv.warn('ocr_timeout', label);
      else this.conv.warn('ocr_image_failed', `${label}: ${outcome.error.message}`);
      if (onError === 'comment') {
        entry.block = `<!-- OCR failed (image ${entry.index + 1}): ${outcome.error.message} -->`;
      }
    });
    if (firstError && onError === 'throw') throw firstError;
  }

  /** Hands over formats the OCR engines cannot read (TIFF, SVG, ...) as PNG. */
  private async prepare(entry: EmbeddedImageEntry): Promise<{ buffer: Buffer; mimeType: string | undefined }> {
    const type = entry.mimeType;
    const native = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp']);
    if (!type || native.has(type)) return { buffer: entry.input.buffer, mimeType: type };
    return { buffer: await transcodeToPng(entry.input.buffer, type), mimeType: 'image/png' };
  }
}

/** `a\nb` -> `> a\n> b` (blank lines become a bare `>`). */
export function toBlockquote(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => {
      const trimmed = line.trimEnd();
      return trimmed ? `> ${trimmed}` : '>';
    })
    .join('\n')
    .replace(/^(>\n)+/, '')
    .replace(/(\n>)+$/, '');
}

/** Sentinel scheme used for image sources between HTML generation and the Markdown pass. */
export const IMAGE_TOKEN_SCHEME = 'tmimg://';

export interface ImageTokenReplacement {
  /** Replacement for the `![alt](...)` token ('' removes it) */
  image: string;
  /** Blockquote / comment to place after the image */
  block?: string;
}

/**
 * Replaces every `![alt](tmimg://<n>)` (optionally with a `"title"`) in `markdown`.
 *
 * - The alt text may span lines (Turndown keeps single newlines in `alt`); it is
 *   handed to `replace` with the whitespace collapsed.
 * - Where the image is removed ('omit') the spaces it leaves behind are cleaned up,
 *   and a link that only wrapped the image (`[![](..)](href)`) is dropped with it.
 * - A block (OCR text) is put in its own paragraph after the line that holds the
 *   image, so it never splits a sentence or a link; inside a list item it is
 *   indented to belong to that item.
 * - Tokens that cannot be parsed are removed so the sentinel never reaches the output.
 *
 * @param replace - receives the token's id, its alt text and its title part
 *   (`' "title"'` or `''`)
 */
export function replaceImageTokens(
  markdown: string,
  replace: (id: number, alt: string, title: string) => ImageTokenReplacement
): string {
  const marker = `](${IMAGE_TOKEN_SCHEME}`;
  const tokenTail = /^(\d+)((?:[ \t]+"(?:[^"\\\n]|\\.)*")?)\)/;
  let done = '';
  let pos = 0; // everything before `pos` is already in `done` (or consumed)
  let from = 0;
  let pending: string[] = [];
  let pendingIndent = '';

  const flush = (): string => {
    const text = pending
      .map((block) =>
        pendingIndent
          ? block
              .split('\n')
              .map((line) => (line ? pendingIndent + line : line))
              .join('\n')
          : block
      )
      .join('\n\n');
    pending = [];
    return `\n\n${text}`;
  };

  /** Copies `markdown[pos..end)` to the output, flushing pending blocks at the first line end. */
  const copyUntil = (end: number): void => {
    const segment = markdown.slice(pos, end);
    if (pending.length > 0) {
      const nl = segment.indexOf('\n');
      if (nl >= 0) {
        // Same-line text stays, the block follows, the next paragraph/item resumes.
        const isList = pendingIndent !== '';
        const tailText = segment.slice(nl);
        done = (done + segment.slice(0, nl)).replace(/[ \t]+$/, '');
        done += flush() + (isList ? tailText : tailText.replace(/^\n+/, '\n\n'));
        pos = end;
        return;
      }
    }
    done += segment;
    pos = end;
  };

  for (;;) {
    const m = markdown.indexOf(marker, from);
    if (m < 0) break;
    const tail = tokenTail.exec(markdown.slice(m + marker.length, m + marker.length + 4096));
    // Never reach back over a paragraph break.
    const paragraphStart = markdown.lastIndexOf('\n\n', m) + 1;
    const start = markdown.lastIndexOf('![', m);
    if (!tail || start < 0 || start < paragraphStart) {
      from = m + marker.length;
      continue;
    }
    const alt = markdown.slice(start + 2, m).replace(/\s*\n\s*/g, ' ');
    const tokenEnd = m + marker.length + tail[0].length;
    const { image, block } = replace(Number(tail[1]), alt, tail[2]);

    copyUntil(start);
    if (block && pending.length === 0) {
      const lineStart = markdown.lastIndexOf('\n', start) + 1;
      const listMarker = /^[ \t]*(?:[*+-]|\d+[.)])[ \t]+/.exec(markdown.slice(lineStart, start));
      pendingIndent = listMarker ? ' '.repeat(listMarker[0].length) : '';
    }
    if (block) pending.push(block);

    pos = tokenEnd;
    from = tokenEnd;
    if (image === '') {
      const atLineStart = done === '' || done.endsWith('\n');
      if (done.endsWith('[') && markdown.startsWith('](', pos)) {
        // The image was the only content of a link: drop the link too.
        const close = markdown.indexOf(')', pos);
        if (close >= 0) {
          done = done.slice(0, -1);
          pos = close + 1;
          from = pos;
        }
      }
      const spaces = /^[ \t]+/.exec(markdown.slice(pos));
      if (spaces && (atLineStart || /[ \t]$/.test(done))) {
        // No stray leading space on a line, no double space where an inline image was.
        pos += spaces[0].length;
        from = pos;
      }
    } else {
      done += image;
    }
  }
  copyUntil(markdown.length);
  if (pending.length > 0) done += flush();
  // Safety net: the sentinel must never leak.
  return done.replace(/!\[[^\]]*\]\(tmimg:\/\/\d+[^)\n]*\)|tmimg:\/\/\d+/g, '');
}

/**
 * Moves images that carry an image token out of tables. Turndown drops everything
 * but the text of a table cell, so a token left inside a cell would be lost (and
 * its OCR text with it); it is placed right after the outermost table instead.
 *
 * @returns true when something was moved
 */
export function hoistTokenImagesOutOfTables($: CheerioAPI): boolean {
  let moved = false;
  const lastAfter = new Map<unknown, ReturnType<CheerioAPI>>();
  $('table img').each((_, el) => {
    const src = $(el).attr('src') ?? '';
    if (!src.startsWith(IMAGE_TOKEN_SCHEME)) return;
    const outer = $(el).parents('table').last();
    if (outer.length === 0) return;
    const holder = $('<p></p>');
    holder.append($(el).clone());
    const anchor = lastAfter.get(outer[0]) ?? outer;
    anchor.after(holder);
    lastAfter.set(outer[0], holder);
    $(el).remove();
    moved = true;
  });
  return moved;
}
