import AdmZip from 'adm-zip';
import { writeFileSync, unlinkSync } from 'fs';
import { join, extname } from 'path';
import { parseStringPromise } from 'xml2js';
import { formatMarkdown } from '../utils/markdown.js';
import { convertHtmlToMarkdown } from './html.js';
import { convertCsvToMarkdown } from './spreadsheet.js';
import type { ConverterOptions } from '../types/index.js';

/**
 * Converts PowerPoint buffer to Markdown
 * @param buffer - PPTX file buffer
 * @returns Markdown string
 */
export async function convertPptxToMarkdown(buffer: Buffer): Promise<string> {
  try {
    const tempPath = join(process.cwd(), 'temp_pptx_' + Date.now() + '.zip');
    writeFileSync(tempPath, buffer);

    const zip = new AdmZip(tempPath);
    const entries = zip.getEntries();

    let md = '';

    for (const entry of entries) {
      if (entry.entryName.startsWith('ppt/slides/slide')) {
        const slideXml = entry.getData().toString('utf-8');
        const slideMd = await extractTextFromSlideXml(slideXml);

        md += `\n\n<!-- ${entry.entryName} -->\n` + slideMd + '\n';
      }
    }

    unlinkSync(tempPath);

    return formatMarkdown(md);
  } catch (err: any) {
    throw new Error(`Failed to convert PPTX: ${err.message}`);
  }
}

/**
 * Extracts text from PowerPoint slide XML
 * @param xml - Slide XML content
 * @returns Extracted text
 */
async function extractTextFromSlideXml(xml: string): Promise<string> {
  const result = await parseStringPromise(xml);
  const texts: string[] = [];

  function traverse(obj: any): void {
    if (!obj) return;
    if (obj['a:t']) {
      texts.push(obj['a:t'].join(' '));
    }
    for (const k in obj) {
      if (typeof obj[k] === 'object') {
        traverse(obj[k]);
      }
    }
  }

  traverse(result);

  return texts.join(' ');
}

/**
 * Converts ZIP archive buffer to Markdown
 * @param buffer - ZIP file buffer
 * @param options - Converter options
 * @returns Markdown string
 */
export async function convertZipToMarkdown(
  buffer: Buffer,
  options: ConverterOptions
): Promise<string> {
  try {
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries();

    const TEXT_EXTS = new Set(['.txt', '.md', '.csv', '.html', '.htm', '.xml', '.json', '.yaml', '.yml', '.js', '.ts', '.py', '.sh', '.css', '.sql']);

    let md = `# ZIP Archive Contents\n\n`;

    for (const entry of entries) {
      if (entry.isDirectory) continue;

      const fileName = entry.entryName;
      const ext = extname(fileName).toLowerCase();
      md += `## File: ${fileName}\n\n`;

      if (TEXT_EXTS.has(ext)) {
        try {
          const content = entry.getData().toString('utf-8');
          if (ext === '.md') {
            md += content + '\n\n';
          } else if (ext === '.csv') {
            md += convertCsvToMarkdown(entry.getData()) + '\n\n';
          } else if (ext === '.html' || ext === '.htm') {
            md += convertHtmlToMarkdown(entry.getData()) + '\n\n';
          } else if (ext === '.json') {
            md += '```json\n' + content.trim() + '\n```\n\n';
          } else if (ext === '.yaml' || ext === '.yml') {
            md += '```yaml\n' + content.trim() + '\n```\n\n';
          } else if (['.js', '.ts', '.py', '.sh', '.css', '.sql'].includes(ext)) {
            md += '```' + ext.slice(1) + '\n' + content.trim() + '\n```\n\n';
          } else {
            md += content + '\n\n';
          }
        } catch {
          md += `(Could not read content - ${entry.getData().length} bytes)\n\n`;
        }
      } else {
        md += `(Binary file - ${entry.getData().length} bytes)\n\n`;
      }
    }

    return md.trim();
  } catch (err: any) {
    throw new Error(`Failed to convert ZIP: ${err.message}`);
  }
}
