import { getDocumentProxy } from 'unpdf';

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
export async function convertPdfToMarkdown(buffer: Buffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));

  const markdownChunks: string[] = [];
  let formPageCount = 0;

  for (let p = 1; p <= pdf.numPages; p++) {
    try {
      const page = await pdf.getPage(p);
      const { words, pageWidth } = await extractPageWords(page);

      const formContent = extractFormContentFromWords(words, pageWidth);

      if (formContent !== null) {
        formPageCount++;
        if (formContent.trim()) markdownChunks.push(formContent.trim());
      } else {
        // Plain-text fallback for non-structured pages
        const text = await extractPagePlainText(page);
        if (text) markdownChunks.push(text);
      }

      page.cleanup(); // Free cached page data (mirrors pdfplumber page.close())
    } catch {
      // Skip unreadable pages silently
    }
  }

  // If no page had form/table content, redo as a pure plain-text document.
  // This mirrors MarkItDown's: if form_page_count == 0: use pdfminer.
  let markdown: string;
  if (formPageCount === 0) {
    const plainChunks: string[] = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      try {
        const page = await pdf.getPage(p);
        const text = await extractPagePlainText(page);
        if (text) plainChunks.push(text);
        page.cleanup();
      } catch { /* skip */ }
    }
    markdown = plainChunks.join('\n\n');
  } else {
    markdown = markdownChunks.join('\n\n');
  }

  return mergePartialNumberingLines(markdown);
}
