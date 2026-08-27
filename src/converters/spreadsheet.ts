import ExcelJS from 'exceljs';
import { readXls, CellError } from 'xls-reader';
// papaparse is CJS-only and its named exports are not statically detectable by
// Node's cjs-module-lexer, so a named ESM import throws at runtime. Use the
// default import, which always works for CJS interop.
import Papa from 'papaparse';
import iconv from 'iconv-lite';
import { formatMarkdown, arrayToMarkdownTable } from '../utils/markdown.js';

/** OLE2 / Compound File Binary signature — legacy `.xls` (BIFF8, Excel 97-2003). */
const OLE2_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

interface SheetData {
  name: string;
  rows: unknown[][];
}

/**
 * Renders a single spreadsheet cell as table text.
 *
 * Handles the value shapes ExcelJS can produce (rich text, formula results,
 * hyperlinks, error cells) as well as the primitives returned by xls-reader.
 */
function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (value instanceof CellError) return value.toString();

  if (typeof value === 'object') {
    const cell = value as Record<string, any>;
    // ExcelJS rich text
    if (Array.isArray(cell.richText)) {
      return cell.richText.map((part: any) => part?.text ?? '').join('');
    }
    // ExcelJS formula cell — prefer the cached result over the expression
    if ('result' in cell) return formatCell(cell.result);
    if ('formula' in cell) return '';
    // ExcelJS hyperlink
    if ('hyperlink' in cell) return String(cell.text ?? cell.hyperlink ?? '');
    // ExcelJS error cell
    if ('error' in cell) return String(cell.error);
    if ('text' in cell) return String(cell.text);
  }

  return String(value);
}

/** Normalizes ragged rows into a rectangular grid so the Markdown table stays well-formed. */
function toGrid(rows: unknown[][]): string[][] {
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return rows.map((row) => {
    const cells = row.map(formatCell);
    while (cells.length < width) cells.push('');
    return cells;
  });
}

/** Reads a legacy `.xls` (BIFF8) workbook via xls-reader. */
function readLegacyXls(buffer: Buffer): SheetData[] {
  return readXls(buffer).sheets.map((sheet) => ({
    name: sheet.name,
    rows: sheet.rows.map((row) => [...row]),
  }));
}

/** Reads an OOXML `.xlsx` workbook via ExcelJS. */
async function readOoxml(buffer: Buffer): Promise<SheetData[]> {
  const wb = new ExcelJS.Workbook();
  // ExcelJS types the loader against the DOM ArrayBuffer; a Node Buffer works at runtime.
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);

  return wb.worksheets.map((ws) => {
    const rows: unknown[][] = [];
    ws.eachRow({ includeEmpty: true }, (row) => {
      // `row.values` is 1-based, so index 0 is always empty padding.
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      rows.push(Array.from(values));
    });
    return { name: ws.name, rows };
  });
}

/**
 * Converts an Excel buffer to Markdown.
 *
 * Supports both OOXML (`.xlsx`, via ExcelJS) and legacy BIFF8 (`.xls`, via
 * xls-reader). The format is detected from the buffer signature rather than the
 * file extension, so mislabelled files are still handled correctly.
 *
 * @param buffer - Excel file buffer
 * @returns Markdown string
 */
export async function convertExcelToMarkdown(buffer: Buffer): Promise<string> {
  try {
    const isLegacyXls =
      buffer.length >= OLE2_SIGNATURE.length &&
      buffer.subarray(0, OLE2_SIGNATURE.length).equals(OLE2_SIGNATURE);

    const sheets = isLegacyXls ? readLegacyXls(buffer) : await readOoxml(buffer);

    let md = '';

    for (const sheet of sheets) {
      md += `## ${sheet.name}\n\n`;
      md += arrayToMarkdownTable(toGrid(sheet.rows)) + '\n\n';
    }

    return formatMarkdown(md);
  } catch (err: any) {
    throw new Error(`Failed to convert Excel: ${err.message}`);
  }
}

/**
 * Returns true if `buffer` contains only well-formed UTF-8 sequences.
 * A single invalid byte or truncated sequence is enough to return false.
 */
function isValidUtf8(buffer: Buffer): boolean {
  let i = 0;
  while (i < buffer.length) {
    const b = buffer[i];
    let extra = 0;
    if (b <= 0x7f) { i++; continue; }
    else if ((b & 0xe0) === 0xc0) { extra = 1; }
    else if ((b & 0xf0) === 0xe0) { extra = 2; }
    else if ((b & 0xf8) === 0xf0) { extra = 3; }
    else { return false; }
    for (let j = 1; j <= extra; j++) {
      if (i + j >= buffer.length || (buffer[i + j] & 0xc0) !== 0x80) return false;
    }
    i += 1 + extra;
  }
  return true;
}

/**
 * Detects encoding from a Buffer using BOM and heuristics,
 * then decodes it with iconv-lite.
 */
function decodeBuffer(buffer: Buffer): string {
  // UTF-8 BOM
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.slice(3).toString('utf-8');
  }
  // UTF-16 LE BOM
  if (buffer[0] === 0xff && buffer[1] === 0xfe) {
    return iconv.decode(buffer.slice(2), 'utf-16le');
  }
  // UTF-16 BE BOM
  if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    return iconv.decode(buffer.slice(2), 'utf-16be');
  }

  // Validate as UTF-8 first. UTF-8 multi-byte lead bytes (0xC0-0xFF) overlap with
  // Shift-JIS lead bytes, so heuristics alone would corrupt valid UTF-8 content.
  if (isValidUtf8(buffer)) {
    return buffer.toString('utf-8');
  }

  // Buffer is not valid UTF-8 — check for Shift-JIS / CP932 signature bytes.
  // Shift-JIS lead bytes: 0x81-0x9F, 0xE0-0xFC
  for (let i = 0; i < Math.min(buffer.length - 1, 1000); i++) {
    const b = buffer[i];
    if ((b >= 0x81 && b <= 0x9f) || (b >= 0xe0 && b <= 0xfc)) {
      return iconv.decode(buffer, 'cp932');
    }
  }

  // Fallback: treat as UTF-8 (replacement chars for invalid bytes)
  return buffer.toString('utf-8');
}

/**
 * Converts CSV buffer to Markdown, supporting UTF-8, UTF-16, and Shift-JIS/CP932 encodings.
 * @param buffer - CSV file buffer
 * @returns Markdown string
 */
export function convertCsvToMarkdown(buffer: Buffer): string {
  try {
    const text = decodeBuffer(buffer);
    const result = Papa.parse(text, { delimiter: ',', skipEmptyLines: true });
    const data = result.data as any[][];

    return formatMarkdown(arrayToMarkdownTable(data));
  } catch (err: any) {
    throw new Error(`Failed to convert CSV: ${err.message}`);
  }
}
