import { read, utils } from 'xlsx';
import { parse } from 'papaparse';
import iconv from 'iconv-lite';
import { formatMarkdown, arrayToMarkdownTable } from '../utils/markdown.js';

/**
 * Converts Excel buffer to Markdown
 * @param buffer - Excel file buffer
 * @returns Markdown string
 */
export async function convertExcelToMarkdown(buffer: Buffer): Promise<string> {
  try {
    const wb = read(buffer, { type: 'buffer' });

    let md = '';

    wb.SheetNames.forEach((sheetName) => {
      md += `## ${sheetName}\n\n`;

      const ws = wb.Sheets[sheetName];
      const json = utils.sheet_to_json(ws, { header: 1 });

      md += arrayToMarkdownTable(json as any[][]) + '\n\n';
    });

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
    const result = parse(text, { delimiter: ',', skipEmptyLines: true });
    const data = result.data as any[][];

    return formatMarkdown(arrayToMarkdownTable(data));
  } catch (err: any) {
    throw new Error(`Failed to convert CSV: ${err.message}`);
  }
}
