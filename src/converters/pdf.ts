import { getPdfOps, loadPdf } from '../utils/pdfjs.js';
import type {
  OCRDocumentHandlerContext,
  OCROptions,
  OCRPageTrigger,
  OCRRenderOptions,
  PageReport,
} from '../types/index.js';
import { withConversionContext, type ConversionContext } from '../utils/conversionContext.js';
import { countChars } from '../utils/chars.js';
import { toIsoLangList } from '../utils/lang.js';
import { OcrTimeoutError, ocrConcurrency, runOcrTasks, type NormalizedOcrResult } from '../utils/ocrRunner.js';

type PdfDocument = Awaited<ReturnType<typeof loadPdf>>;

// ── Constants (ported from MarkItDown _pdf_converter.py) ─────────────────
const PARTIAL_NUMBERING_RE = /^\.\d+$/;

// ── Interfaces ────────────────────────────────────────────────────────────

interface PDFWord {
  text: string;
  x0: number;   // left edge (pts)
  x1: number;   // right edge (pts)
  top: number;  // distance from top of page (pts) — matches pdfplumber "top"
}

interface RowInfo {
  yKey: number;
  words: PDFWord[];
  text: string;
  xGroups: number[];         // distinct X-column starts (gap > 50 pts)
  isParagraph: boolean;
  numColumns: number;
  hasPartialNumbering: boolean;
  isTableRow: boolean;
}

// ── Post-processor: merge MasterFormat-style partial numbering (.1, .2) ──

function mergePartialNumberingLines(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const stripped = lines[i].trim();
    if (PARTIAL_NUMBERING_RE.test(stripped)) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      if (j < lines.length) {
        result.push(`${stripped} ${lines[j].trim()}`);
        i = j + 1;
      } else {
        result.push(lines[i]);
        i++;
      }
    } else {
      result.push(lines[i]);
      i++;
    }
  }
  return result.join('\n');
}

// ── Markdown table renderer (ported from _to_markdown_table) ─────────────

function toMarkdownTable(table: string[][], includeSeparator = true): string {
  if (!table.length) return '';
  const norm = table.map(row => row.map(c => c ?? ''));
  const filtered = norm.filter(row => row.some(c => c.trim()));
  if (!filtered.length) return '';

  const colWidths = filtered[0].map((_, ci) =>
    Math.max(...filtered.map(row => (row[ci] ?? '').length), 3)
  );
  const fmtRow = (row: string[]) =>
    '|' + row.map((cell, i) => (cell ?? '').padEnd(colWidths[i])).join('|') + '|';

  if (includeSeparator) {
    const [header, ...rows] = filtered;
    return [
      fmtRow(header),
      '|' + colWidths.map(w => '-'.repeat(w)).join('|') + '|',
      ...rows.map(fmtRow),
    ].join('\n');
  }
  return filtered.map(fmtRow).join('\n');
}

// ── Word extraction from a pdfjs page ────────────────────────────────────

async function extractPageWords(page: any): Promise<{ words: PDFWord[]; pageWidth: number }> {
  const viewport = page.getViewport({ scale: 1 });
  const pageHeight: number = viewport.height;
  const pageWidth: number  = viewport.width;

  const tc = await page.getTextContent();
  const words: PDFWord[] = [];

  for (const item of tc.items as any[]) {
    if (!item.str?.trim()) continue;
    const x0: number = item.transform[4];
    const y0: number = item.transform[5];   // PDF bottom-up baseline
    const w: number  = item.width  ?? 0;
    const h: number  = item.height ?? 0;
    // Convert to top-down (matches pdfplumber "top" = pageHeight - (y0 + h))
    const top: number = pageHeight - (y0 + h);
    words.push({ text: item.str, x0, x1: x0 + w, top });
  }

  return { words, pageWidth };
}

// ── Plain-text fallback (equivalent to pdfminer per-page extraction) ──────

async function extractPagePlainText(page: any): Promise<string> {
  const tc = await page.getTextContent();
  let text = '';
  for (const item of tc.items as any[]) {
    if ('str' in item) {
      text += item.str;
      if ((item as any).hasEOL) text += '\n';
    }
  }
  return text.trim();
}

/**
 * Reads the text layer of each page, without OCR. A page without a text layer
 * (a scanned page) comes back as an empty string.
 */
export async function extractPdfPages(buffer: Buffer): Promise<string[]> {
  const pdf = await loadPdf(buffer);
  const pages: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    pages.push(await extractPagePlainText(page));
    page.cleanup();
  }
  return pages;
}

// ── Core form/table extractor (port of _extract_form_content_from_words) ─

function extractFormContentFromWords(words: PDFWord[], pageWidth: number): string | null {
  if (!words.length) return null;

  // Step 1: group words by Y (top) position, tolerance = 5 pts
  const Y_TOLERANCE = 5;
  const rowsByY = new Map<number, PDFWord[]>();
  for (const word of words) {
    const yKey = Math.round(word.top / Y_TOLERANCE) * Y_TOLERANCE;
    if (!rowsByY.has(yKey)) rowsByY.set(yKey, []);
    rowsByY.get(yKey)!.push(word);
  }

  const sortedYKeys = [...rowsByY.keys()].sort((a, b) => a - b);

  // Step 2: first pass — analyze each row
  const rowInfo: RowInfo[] = [];
  for (const yKey of sortedYKeys) {
    const rowWords = rowsByY.get(yKey)!.sort((a, b) => a.x0 - b.x0);
    if (!rowWords.length) continue;

    const firstX0 = rowWords[0].x0;
    const lastX1  = rowWords[rowWords.length - 1].x1;
    const lineWidth    = lastX1 - firstX0;
    const combinedText = rowWords.map(w => w.text).join(' ');

    // Distinct x-position groups — gap threshold 50 pts (same as MarkItDown)
    const xGroups: number[] = [];
    for (const x of rowWords.map(w => w.x0).sort((a, b) => a - b)) {
      if (!xGroups.length || x - xGroups[xGroups.length - 1] > 50) {
        xGroups.push(x);
      }
    }

    const isParagraph         = lineWidth > pageWidth * 0.55 && combinedText.length > 60;
    const hasPartialNumbering = PARTIAL_NUMBERING_RE.test(rowWords[0].text.trim());

    rowInfo.push({
      yKey, words: rowWords, text: combinedText,
      xGroups, isParagraph,
      numColumns: xGroups.length,
      hasPartialNumbering,
      isTableRow: false,
    });
  }

  // Step 3: collect x-positions from rows with 3+ columns (table-like rows)
  const allTableXPositions: number[] = [];
  for (const info of rowInfo) {
    if (info.numColumns >= 3 && !info.isParagraph) {
      allTableXPositions.push(...info.xGroups);
    }
  }
  if (!allTableXPositions.length) return null;

  // Step 4: adaptive tolerance — 70th-percentile of inter-position gaps, clamped [25, 50]
  allTableXPositions.sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 0; i < allTableXPositions.length - 1; i++) {
    const gap = allTableXPositions[i + 1] - allTableXPositions[i];
    if (gap > 5) gaps.push(gap);
  }

  let adaptiveTolerance: number;
  if (gaps.length >= 3) {
    const sorted = [...gaps].sort((a, b) => a - b);
    adaptiveTolerance = Math.max(25, Math.min(50, sorted[Math.floor(sorted.length * 0.70)]));
  } else {
    adaptiveTolerance = 35;
  }

  // Step 5: compute global column boundaries
  const globalColumns: number[] = [];
  for (const x of allTableXPositions) {
    if (!globalColumns.length || x - globalColumns[globalColumns.length - 1] > adaptiveTolerance) {
      globalColumns.push(x);
    }
  }

  // Step 6: validate column structure (same guards as MarkItDown)
  if (globalColumns.length < 2) return null;

  const contentWidth   = globalColumns[globalColumns.length - 1] - globalColumns[0];
  const avgColWidth    = contentWidth / globalColumns.length;
  if (avgColWidth < 30) return null;

  const columnsPerInch = globalColumns.length / (contentWidth / 72);
  if (columnsPerInch > 10) return null;

  const adaptiveMaxColumns = Math.max(15, Math.floor(20 * (pageWidth / 612)));
  if (globalColumns.length > adaptiveMaxColumns) return null;

  // Step 7: classify each row as table row or prose
  for (const info of rowInfo) {
    if (info.isParagraph)         { info.isTableRow = false; continue; }
    if (info.hasPartialNumbering) { info.isTableRow = false; continue; }

    const alignedColumns = new Set<number>();
    for (const word of info.words) {
      for (let ci = 0; ci < globalColumns.length; ci++) {
        if (Math.abs(word.x0 - globalColumns[ci]) < 40) {
          alignedColumns.add(ci);
          break;
        }
      }
    }
    info.isTableRow = alignedColumns.size >= 2;
  }

  // Step 8: find consecutive table regions
  const tableRegions: Array<[number, number]> = [];
  let i = 0;
  while (i < rowInfo.length) {
    if (rowInfo[i].isTableRow) {
      const start = i;
      while (i < rowInfo.length && rowInfo[i].isTableRow) i++;
      tableRegions.push([start, i]);
    } else {
      i++;
    }
  }

  // Step 9: require at least 20% of rows to be table rows
  const totalTableRows = tableRegions.reduce((s, [st, en]) => s + (en - st), 0);
  if (rowInfo.length > 0 && totalTableRows / rowInfo.length < 0.2) return null;

  // Step 10: build output — tables as Markdown, prose as plain text
  const numCols = globalColumns.length;

  function extractCells(info: RowInfo): string[] {
    const cells: string[] = new Array(numCols).fill('');
    for (const word of info.words) {
      let assignedCol = numCols - 1;
      for (let ci = 0; ci < numCols - 1; ci++) {
        if (word.x0 < globalColumns[ci + 1] - 20) {
          assignedCol = ci;
          break;
        }
      }
      cells[assignedCol] = cells[assignedCol]
        ? `${cells[assignedCol]} ${word.text}`
        : word.text;
    }
    return cells;
  }

  const resultLines: string[] = [];
  let idx = 0;
  while (idx < rowInfo.length) {
    const region = tableRegions.find(([s]) => s === idx);
    if (region) {
      const [start, end] = region;
      const tableData = rowInfo.slice(start, end).map(extractCells);
      if (tableData.length) resultLines.push(toMarkdownTable(tableData));
      idx = end;
    } else {
      const inTable = tableRegions.some(([s, e]) => s < idx && idx < e);
      if (!inTable) resultLines.push(rowInfo[idx].text);
      idx++;
    }
  }

  return resultLines.join('\n');
}

// ── Main export ───────────────────────────────────────────────────────────

/**
 * Converts a PDF buffer to Markdown.
 *
 * Algorithm mirrors MarkItDown's PdfConverter:
 * 1. Per-page: try form/table extraction via word-coordinate analysis.
 *    If successful → emit structured Markdown (tables + prose).
 *    If not → collect plain text for this page.
 * 2. If zero pages had form/table content → redo full doc as plain text
 *    (equivalent to pdfminer.high_level.extract_text fallback).
 * 3. Post-process MasterFormat-style partial numbering (.1, .2 → merge).
 */
export async function convertPdfToMarkdown(
  buffer: Buffer,
  ocr?: boolean | OCROptions,
  fileName?: string,
  ctx?: ConversionContext
): Promise<string> {
  return withConversionContext(ctx, { ocr }, (conv) => convertPdf(buffer, ocr, fileName, conv));
}

async function convertPdf(
  buffer: Buffer,
  ocr: boolean | OCROptions | undefined,
  fileName: string | undefined,
  conv: ConversionContext
): Promise<string> {
  const pdf = await loadPdf(buffer);
  try {
    return await convertLoadedPdf(pdf, buffer, ocr, fileName, conv);
  } finally {
    // Release the parsed document (and its worker); the markdown is a plain string by now.
    await pdf.loadingTask.destroy().catch(() => undefined);
  }
}

async function convertLoadedPdf(
  pdf: PdfDocument,
  buffer: Buffer,
  ocr: boolean | OCROptions | undefined,
  fileName: string | undefined,
  conv: ConversionContext
): Promise<string> {
  const numPages = pdf.numPages;
  conv.stats.pageCount = numPages;

  const markdownChunks: string[] = [];
  const pageTexts: string[] = new Array(numPages).fill('');
  const pageErrors: Array<string | undefined> = new Array(numPages).fill(undefined);
  let formPageCount = 0;

  for (let p = 1; p <= numPages; p++) {
    try {
      const page = await pdf.getPage(p);
      const { words, pageWidth } = await extractPageWords(page);

      const formContent = extractFormContentFromWords(words, pageWidth);

      if (formContent !== null) {
        formPageCount++;
        if (formContent.trim()) {
          markdownChunks.push(formContent.trim());
          pageTexts[p - 1] = formContent.trim();
        }
      } else {
        // Plain-text fallback for non-structured pages
        const text = await extractPagePlainText(page);
        if (text) {
          markdownChunks.push(text);
          pageTexts[p - 1] = text;
        }
      }

      page.cleanup(); // Free cached page data (mirrors pdfplumber page.close())
    } catch (err: any) {
      // Skip unreadable pages silently
      pageErrors[p - 1] = err?.message ?? String(err);
    }
  }

  // If no page had form/table content, redo as a pure plain-text document.
  // This mirrors MarkItDown's: if form_page_count == 0: use pdfminer.
  let markdown: string;
  if (formPageCount === 0) {
    const plainChunks: string[] = [];
    for (let p = 1; p <= numPages; p++) {
      try {
        const page = await pdf.getPage(p);
        const text = await extractPagePlainText(page);
        if (text) plainChunks.push(text);
        pageTexts[p - 1] = text || '';
        pageErrors[p - 1] = undefined;
        page.cleanup();
      } catch (err: any) {
        /* skip */
        pageErrors[p - 1] = err?.message ?? String(err);
      }
    }
    markdown = plainChunks.join('\n\n');
  } else {
    markdown = markdownChunks.join('\n\n');
  }

  const extractedText = mergePartialNumberingLines(markdown);

  const textReports = (): PageReport[] =>
    pageTexts.map((text, i) => {
      const chars = countChars(text);
      const report: PageReport = { page: i + 1, source: chars > 0 ? 'text' : 'empty', chars };
      if (pageErrors[i] !== undefined && chars === 0) {
        report.source = 'error';
        report.error = pageErrors[i];
      }
      return report;
    });
  conv.pages = textReports();

  // ── OCR integration (opt-in) ─────────────────────────────────────────────
  if (ocr) {
    const ocrOpts: OCROptions = typeof ocr === 'object' ? ocr : {};
    const ocrMode = ocrOpts.pdfMode ?? 'auto';

    if (ocrMode === 'auto-page') {
      return convertPagesWithOcr(pdf, buffer, fileName, ocrOpts, conv, pageTexts, pageErrors, extractedText);
    }

    const shouldOcr = ocrMode === 'always' || (ocrMode === 'auto' && !extractedText.trim());

    if (shouldOcr) {
      try {
        const { ocrImageDetailed } = await import('../utils/ocr.js');
        const pdf2 = await loadPdf(buffer);
        const pageCount = pdf2.numPages;
        // `maxPages` limits the OCR to the first N pages (default: all pages).
        const limit = positiveInt(ocrOpts.maxPages);
        const processed = limit !== undefined ? Math.min(limit, pageCount) : pageCount;
        if (processed < pageCount) {
          conv.warn('ocr_page_limit', `${pageCount} pages, ${processed} processed`);
        }
        const outcomeText: Array<NormalizedOcrResult | null | undefined> = new Array(pageCount).fill(undefined);
        const outcomeMs: number[] = new Array(pageCount).fill(0);
        const reason = ocrMode === 'always' ? 'always' : 'auto';
        const renderErrors: Array<string | undefined> = new Array(pageCount).fill(undefined);

        if (ocrOpts.documentHandler) {
          const pages = Array.from({ length: processed }, (_, i) => i + 1);
          let docResult: Awaited<ReturnType<typeof runDocumentHandler>>;
          try {
            docResult = await runDocumentHandler(buffer, pages, pageCount, fileName, ocrOpts, conv);
          } catch (err: any) {
            if (!(conv.signal && conv.signal.aborted)) {
              if (err instanceof OcrTimeoutError) conv.warn('ocr_timeout', `pages ${pages.join(',')}`);
              else conv.warn('ocr_page_failed', `pages ${pages.join(',')}: ${err?.message ?? String(err)}`);
            }
            throw err;
          } finally {
            await pdf2.loadingTask.destroy().catch(() => undefined);
          }
          for (const p of pages) {
            outcomeText[p - 1] = docResult.results.get(p) ?? { text: '' };
            outcomeMs[p - 1] = docResult.ms;
          }
        } else {
          const advancedRender = needsPageRenderer(ocrOpts.render);
          const tasks = Array.from({ length: processed }, (_, i) => {
            const p = i + 1;
            return {
              page: p,
              run: async (signal: AbortSignal | undefined) => {
                let png: Buffer;
                let mimeType = 'image/png';
                let imageSize: { imageWidth: number; imageHeight: number } | undefined;
                const renderStart = Date.now();
                try {
                  if (advancedRender) {
                    const { renderPdfPageForOcr } = await import('../utils/pdfRender.js');
                    const rendered = await renderPdfPageForOcr(pdf2, p, ocrOpts.render);
                    png = rendered.buffer;
                    mimeType = rendered.mimeType;
                    imageSize = { imageWidth: rendered.width, imageHeight: rendered.height };
                  } else {
                    const { renderPdfPageToPng } = await import('../utils/pdfRender.js');
                    const scale = ocrOpts.render?.scale;
                    png = scale ? await renderPdfPageToPng(buffer, p, scale) : await renderPdfPageToPng(buffer, p);
                  }
                } catch (err: any) {
                  /* skip unrenderable pages */
                  renderErrors[i] = err?.message ?? String(err);
                  return null;
                } finally {
                  conv.stats.renderMs += Date.now() - renderStart;
                }
                return ocrImageDetailed(
                  png,
                  ocrOpts,
                  {
                    page: p,
                    pageCount,
                    mimeType,
                    sourceExtension: '.pdf',
                    fileName,
                    kind: 'pdf-page',
                    ...(imageSize ?? {}),
                    ...(signal ? { signal } : {}),
                  },
                  conv
                ); // API errors propagate to outer catch
              },
            };
          });

          try {
            const outcomes = await runOcrTasks(tasks, {
              concurrency: ocrConcurrency(ocrOpts),
              timeoutMs: ocrOpts.timeoutMs,
              signal: conv.signal,
              onProgress: ocrOpts.onProgress,
              kind: 'pdf-page',
              stopOnError: true,
            });
            for (let i = 0; i < outcomes.length; i++) {
              const outcome = outcomes[i];
              const page = i + 1;
              if (outcome.status === 'error') {
                conv.warn(
                  outcome.timedOut ? 'ocr_timeout' : 'ocr_page_failed',
                  outcome.timedOut ? `page ${page}` : `page ${page}: ${outcome.error.message}`
                );
                throw outcome.error;
              }
              if (outcome.status === 'skipped') continue;
              outcomeText[i] = outcome.value;
              outcomeMs[i] = outcome.ms;
            }
          } finally {
            await pdf2.loadingTask.destroy().catch(() => undefined);
          }
        }

        const ocrTexts: string[] = [];
        const reports: PageReport[] = [];
        let produced = false;
        for (let i = 0; i < pageCount; i++) {
          const page = i + 1;
          if (page > processed) {
            // Beyond `maxPages`: not OCRed, the text layer (if any) is kept.
            const native = pageTexts[i];
            if (native) ocrTexts.push(native);
            reports.push({ page, source: 'skipped', chars: countChars(native), reason });
            continue;
          }
          const result = outcomeText[i];
          if (result === undefined) continue;
          if (result === null) {
            reports.push({ page, source: 'error', chars: 0, error: renderErrors[i] });
            continue;
          }
          const text = result.markdown ?? result.text;
          if (text) {
            produced = true;
            ocrTexts.push(text);
            reports.push({ page, source: 'ocr', chars: countChars(text), reason, ms: outcomeMs[i] });
          } else {
            reports.push({ page, source: 'empty', chars: 0, reason, ms: outcomeMs[i] });
          }
        }
        if (produced) {
          conv.pages = reports;
          return ocrTexts.join('\n\n');
        }
      } catch (err: any) {
        // Cancellation is never swallowed by the text fallback.
        if (conv.signal && conv.signal.aborted) throw err;
        if (!extractedText.trim()) {
          throw new Error(`PDF OCR failed: ${err.message}`);
        }
        // OCR failed but text extraction worked — fall through
      }
    }
  }

  return extractedText;
}

// ── OCR helpers ───────────────────────────────────────────────────────────

function positiveInt(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) return undefined;
  return Math.floor(value);
}

/**
 * True when the render options ask for more than a different scale, i.e. the
 * page must go through the document-reusing renderer instead of the legacy
 * `renderPdfPageToPng(buffer, page, scale)`.
 */
function needsPageRenderer(render: OCRRenderOptions | undefined): boolean {
  return (
    !!render &&
    (render.maxPixels !== undefined ||
      render.format === 'jpeg' ||
      render.grayscale === true)
  );
}

interface DocumentOcrResult {
  results: Map<number, NormalizedOcrResult>;
  ms: number;
}

/**
 * Calls `ocr.documentHandler` once with the pages that need OCR (through the
 * shared runner: `timeoutMs` and cancellation apply). Throws when the handler
 * fails; progress is reported per page afterwards.
 */
async function runDocumentHandler(
  buffer: Buffer,
  pages: number[],
  pageCount: number,
  fileName: string | undefined,
  ocrOpts: OCROptions,
  conv: ConversionContext
): Promise<DocumentOcrResult> {
  const handler = ocrOpts.documentHandler!;
  const started = Date.now();
  conv.stats.ocrCalls++;
  try {
    const outcomes = await runOcrTasks(
      [
        {
          run: async (signal) => {
            const context: OCRDocumentHandlerContext = { pages, pageCount };
            if (fileName !== undefined) context.fileName = fileName;
            const hint = toIsoLangList(ocrOpts.lang);
            if (hint) context.langHint = hint;
            if (signal) context.signal = signal;
            return handler(buffer, context);
          },
        },
      ],
      { timeoutMs: ocrOpts.timeoutMs, signal: conv.signal, kind: 'pdf-page' }
    );
    const outcome = outcomes[0];
    if (outcome.status === 'error') throw outcome.error;
    if (outcome.status !== 'ok') throw new Error('document handler did not run');

    const requested = new Set(pages);
    const results = new Map<number, NormalizedOcrResult>();
    for (const entry of Array.isArray(outcome.value) ? outcome.value : []) {
      if (!entry || !requested.has(entry.page)) continue;
      const text = (typeof entry.text === 'string' ? entry.text : '').trim();
      const markdown = typeof entry.markdown === 'string' ? entry.markdown.trim() : '';
      const normalized: NormalizedOcrResult = { text };
      if (markdown) normalized.markdown = markdown;
      results.set(entry.page, normalized);
    }
    conv.stats.ocrPages += results.size;
    if (ocrOpts.onProgress) {
      pages.forEach((page, i) => {
        try {
          ocrOpts.onProgress!({ kind: 'pdf-page', completed: i + 1, total: pages.length, page });
        } catch {
          /* progress callbacks must not break the conversion */
        }
      });
    }
    return { results, ms: outcome.ms };
  } finally {
    conv.stats.ocrMs += Date.now() - started;
  }
}

const GARBLED_CHAR_RE = /[�\u0000-\u0008\u000B\u000C\u000E-\u001F-]/g;

/**
 * Share of unusable characters (U+FFFD, control characters, private-use area)
 * in a text layer, relative to its non-whitespace characters.
 */
export function garbledRatio(text: string): number {
  const chars = countChars(text);
  if (chars === 0) return 0;
  const garbled = text.match(GARBLED_CHAR_RE);
  return (garbled ? garbled.length : 0) / chars;
}

const RASTER_IMAGE_OPS = [
  'paintImageXObject',
  'paintInlineImageXObject',
  'paintImageMaskXObject',
  'paintImageXObjectRepeat',
  'paintImageMaskXObjectRepeat',
  'paintImageMaskXObjectGroup',
  'paintInlineImageXObjectGroup',
];

/** True when the page paints at least one raster image (from its operator list). */
async function pageHasRasterImage(pdf: PdfDocument, pageNum: number): Promise<boolean> {
  try {
    const OPS = await getPdfOps();
    const codes = new Set<number>();
    for (const name of RASTER_IMAGE_OPS) {
      if (typeof OPS[name] === 'number') codes.add(OPS[name]);
    }
    const page = await pdf.getPage(pageNum);
    try {
      const operatorList = await page.getOperatorList();
      const fns = operatorList.fnArray as ArrayLike<number>;
      for (let i = 0; i < fns.length; i++) {
        if (codes.has(fns[i])) return true;
      }
      return false;
    } finally {
      page.cleanup();
    }
  } catch {
    return false;
  }
}

type PageReason = NonNullable<PageReport['reason']>;

/**
 * `pdfMode: 'auto-page'`: finds the pages whose text layer is missing, too thin
 * or garbled, OCRs only those and merges the result with the native text of the
 * other pages in page order.
 */
async function convertPagesWithOcr(
  pdf: PdfDocument,
  buffer: Buffer,
  fileName: string | undefined,
  ocrOpts: OCROptions,
  conv: ConversionContext,
  pageTexts: string[],
  pageErrors: Array<string | undefined>,
  extractedText: string
): Promise<string> {
  const numPages = pageTexts.length;
  const trigger: OCRPageTrigger = ocrOpts.pageTrigger ?? {};
  const minChars = trigger.minChars ?? 32;
  const maxGarbledRatio = trigger.maxGarbledRatio ?? 0.3;
  const requireImage = trigger.requireImage ?? true;
  const onError = ocrOpts.onError ?? 'skip';

  // 1. Candidates
  const candidates: Array<{ page: number; reason: PageReason }> = [];
  for (let p = 1; p <= numPages; p++) {
    const text = pageTexts[p - 1];
    const chars = countChars(text);
    if (chars === 0) {
      candidates.push({ page: p, reason: 'no-text' });
    } else if (maxGarbledRatio > 0 && garbledRatio(text) > maxGarbledRatio) {
      candidates.push({ page: p, reason: 'garbled' });
    } else if (chars < minChars && (!requireImage || (await pageHasRasterImage(pdf, p)))) {
      candidates.push({ page: p, reason: 'low-text' });
    }
  }

  const baseReport = (p: number): PageReport => {
    const chars = countChars(pageTexts[p - 1]);
    const report: PageReport = { page: p, source: chars > 0 ? 'text' : 'empty', chars };
    if (pageErrors[p - 1] !== undefined && chars === 0) {
      report.source = 'error';
      report.error = pageErrors[p - 1];
    }
    return report;
  };

  if (candidates.length === 0) return extractedText;

  // 2. maxPages caps the candidates (page order)
  const limit = positiveInt(ocrOpts.maxPages);
  const selected = limit !== undefined ? candidates.slice(0, limit) : candidates;
  if (selected.length < candidates.length) {
    conv.warn('ocr_page_limit', `${candidates.length} candidate pages, ${selected.length} processed`);
  }
  const reasonOf = new Map(candidates.map((c) => [c.page, c.reason]));
  const selectedPages = selected.map((c) => c.page);

  // 3. Execute
  interface PageOutcome {
    result?: NormalizedOcrResult;
    error?: Error;
    timedOut?: boolean;
    ms?: number;
  }
  const outcomes = new Map<number, PageOutcome>();
  const fail = (page: number, error: Error, timedOut: boolean, ms?: number) => {
    conv.warn(timedOut ? 'ocr_timeout' : 'ocr_page_failed', timedOut ? `page ${page}` : `page ${page}: ${error.message}`);
    outcomes.set(page, { error, timedOut, ms });
  };

  if (ocrOpts.documentHandler) {
    try {
      const doc = await runDocumentHandler(buffer, selectedPages, numPages, fileName, ocrOpts, conv);
      for (const page of selectedPages) {
        outcomes.set(page, { result: doc.results.get(page) ?? { text: '' }, ms: doc.ms });
      }
    } catch (err: any) {
      if (conv.signal && conv.signal.aborted) throw err;
      const error = err instanceof Error ? err : new Error(String(err));
      for (const page of selectedPages) fail(page, error, error instanceof OcrTimeoutError);
      if (onError === 'throw') throw error;
    }
  } else {
    const { ocrImageDetailed } = await import('../utils/ocr.js');
    const { renderPdfPageForOcr } = await import('../utils/pdfRender.js');
    const tasks = selectedPages.map((page) => ({
      page,
      run: async (signal: AbortSignal | undefined) => {
        const renderStart = Date.now();
        let rendered: Awaited<ReturnType<typeof renderPdfPageForOcr>>;
        try {
          rendered = await renderPdfPageForOcr(pdf, page, ocrOpts.render);
        } finally {
          conv.stats.renderMs += Date.now() - renderStart;
        }
        return ocrImageDetailed(
          rendered.buffer,
          ocrOpts,
          {
            page,
            pageCount: numPages,
            mimeType: rendered.mimeType,
            sourceExtension: '.pdf',
            fileName,
            kind: 'pdf-page',
            imageWidth: rendered.width,
            imageHeight: rendered.height,
            ...(signal ? { signal } : {}),
          },
          conv
        );
      },
    }));
    const results = await runOcrTasks(tasks, {
      concurrency: ocrConcurrency(ocrOpts),
      timeoutMs: ocrOpts.timeoutMs,
      signal: conv.signal,
      onProgress: ocrOpts.onProgress,
      kind: 'pdf-page',
      stopOnError: onError === 'throw',
    });
    for (let i = 0; i < results.length; i++) {
      const outcome = results[i];
      const page = selectedPages[i];
      if (outcome.status === 'ok') outcomes.set(page, { result: outcome.value, ms: outcome.ms });
      else if (outcome.status === 'error') {
        fail(page, outcome.error, outcome.timedOut, outcome.ms);
        if (onError === 'throw') throw outcome.error;
      }
    }
  }

  // 4. Merge in page order
  const texts = pageTexts.slice();
  const reports: PageReport[] = [];
  let firstError: Error | undefined;
  for (let p = 1; p <= numPages; p++) {
    const outcome = outcomes.get(p);
    const reason = reasonOf.get(p);
    if (!outcome) {
      const report = baseReport(p);
      if (reason) {
        // A candidate that was not processed (maxPages)
        report.source = 'skipped';
        report.reason = reason;
      }
      reports.push(report);
      continue;
    }
    if (outcome.error) {
      firstError ??= outcome.error;
      const report: PageReport = {
        page: p,
        source: 'error',
        chars: countChars(pageTexts[p - 1]),
        reason,
        error: outcome.error.message,
      };
      if (outcome.ms !== undefined) report.ms = outcome.ms;
      reports.push(report);
      continue;
    }
    const text = (outcome.result?.markdown ?? outcome.result?.text ?? '').trim();
    if (text) {
      texts[p - 1] = text;
      reports.push({ page: p, source: 'ocr', chars: countChars(text), reason, ms: outcome.ms });
    } else {
      const chars = countChars(pageTexts[p - 1]);
      reports.push({ page: p, source: chars > 0 ? 'text' : 'empty', chars, reason, ms: outcome.ms });
    }
  }
  conv.pages = reports;

  // 5. Nothing at all, and OCR failed: report it like the legacy whole-document mode
  if (firstError && !texts.some((t) => t) && onError !== 'comment') {
    throw new Error(`PDF OCR failed: ${firstError.message}`);
  }
  if (onError === 'comment') {
    for (let p = 1; p <= numPages; p++) {
      const outcome = outcomes.get(p);
      if (outcome?.error && !texts[p - 1]) {
        texts[p - 1] = `<!-- OCR failed (page ${p}): ${outcome.error.message} -->`;
      }
    }
  }

  return mergePartialNumberingLines(texts.filter(Boolean).join('\n\n'));
}
