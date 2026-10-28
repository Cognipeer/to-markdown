import { convertToHtml } from 'mammoth';
import { formatMarkdown } from '../utils/markdown.js';
import { htmlToMarkdown } from './html.js';
import type { ConverterOptions } from '../types/index.js';
import type { ConversionContext } from '../utils/conversionContext.js';

/**
 * Converts DOCX buffer to Markdown
 * @param buffer - DOCX file buffer
 * @returns Markdown string
 */
export async function convertDocxToMarkdown(
  buffer: Buffer,
  _options?: ConverterOptions,
  _ctx?: ConversionContext
): Promise<string> {
  try {
    const result = await convertToHtml({ buffer }, { styleMap: [] });
    const html = result.value || '';

    let markdown = htmlToMarkdown(html);
    markdown = formatMarkdown(markdown);

    return markdown;
  } catch (err: any) {
    throw new Error(`Failed to convert DOCX: ${err.message}`);
  }
}
