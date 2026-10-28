import { loadPdf } from '../utils/pdfjs.js';
import type { OCROptions, PageReport } from '../types/index.js';
import { withConversionContext, type ConversionContext } from '../utils/conversionContext.js';
import { countChars } from '../utils/chars.js';
import { runOcrTasks } from '../utils/ocrRunner.js';

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
    // 'auto-page' behaves like 'auto' until per-page OCR lands (TM-2).
    const shouldOcr =
      ocrMode === 'always' ||
      ((ocrMode === 'auto' || ocrMode === 'auto-page') && !extractedText.trim());

    if (shouldOcr) {
      try {
        const { renderPdfPageToPng } = await import('../utils/pdfRender.js');
        const { ocrImageDetailed } = await import('../utils/ocr.js');
        const pdf2 = await loadPdf(buffer);
        const pageCount = pdf2.numPages;
        const renderErrors: Array<string | undefined> = new Array(pageCount).fill(undefined);
        const tasks = Array.from({ length: pageCount }, (_, i) => {
          const p = i + 1;
          return {
            page: p,
            run: async (signal: AbortSignal | undefined) => {
              let png: Buffer;
              const renderStart = Date.now();
              try {
                png = await renderPdfPageToPng(buffer, p);
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
                  mimeType: 'image/png',
                  sourceExtension: '.pdf',
                  fileName,
                  kind: 'pdf-page',
                  ...(signal ? { signal } : {}),
                },
                conv
              ); // API errors propagate to outer catch
            },
          };
        });

        const outcomes = await runOcrTasks(tasks, {
          concurrency: ocrOpts.concurrency,
          timeoutMs: ocrOpts.timeoutMs,
          signal: conv.signal,
          onProgress: ocrOpts.onProgress,
          kind: 'pdf-page',
          stopOnError: true,
        });

        const ocrTexts: string[] = [];
        const reports: PageReport[] = [];
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
          if (outcome.value === null) {
            reports.push({ page, source: 'error', chars: 0, error: renderErrors[i] });
            continue;
          }
          const text = outcome.value.markdown ?? outcome.value.text;
          if (text) {
            ocrTexts.push(text);
            reports.push({
              page,
              source: 'ocr',
              chars: countChars(text),
              reason: ocrMode === 'always' ? 'always' : 'auto',
              ms: outcome.ms,
            });
          } else {
            reports.push({ page, source: 'empty', chars: 0, reason: ocrMode === 'always' ? 'always' : 'auto', ms: outcome.ms });
          }
        }
        if (ocrTexts.length > 0) {
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
