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

  // Heuristic: check for high bytes that suggest non-UTF-8 multibyte (Shift-JIS / CP932)
  // Shift-JIS lead bytes: 0x81-0x9F, 0xE0-0xFC
  let shiftJisScore = 0;
  for (let i = 0; i < Math.min(buffer.length - 1, 1000); i++) {
    const b = buffer[i];
    if ((b >= 0x81 && b <= 0x9f) || (b >= 0xe0 && b <= 0xfc)) {
      shiftJisScore++;
    }
  }
  if (shiftJisScore > 2) {
    return iconv.decode(buffer, 'cp932');
  }

  // Default: UTF-8
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
