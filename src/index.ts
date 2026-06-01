import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { isAbsolute, join } from 'path';
import type { ConverterInput, ConverterOptions, FileExtension, BatchInput, BatchResult } from './types/index.js';
import { detectFileType } from './utils/fileDetection.js';
import { convertPdfToMarkdown } from './converters/pdf.js';
import { convertDocxToMarkdown } from './converters/docx.js';
import { convertHtmlToMarkdown } from './converters/html.js';
import { convertTextFileToMarkdown, convertYoutubeToMarkdown, convertBingSerpToMarkdown } from './converters/text.js';
import { convertIpynbToMarkdown } from './converters/notebook.js';
import { convertRssAtomToMarkdown } from './converters/xml.js';
import { convertExcelToMarkdown, convertCsvToMarkdown } from './converters/spreadsheet.js';
import { convertAudioToMarkdown, convertImageToMarkdown } from './converters/media.js';
import { convertPptxToMarkdown, convertZipToMarkdown } from './converters/archive.js';
import { convertJsonToMarkdown, convertYamlToMarkdown } from './converters/data.js';
export { convertUrlToMarkdown } from './converters/url.js';

/**
 * Main function to convert various file formats to Markdown
 * 
 * @param input - File path (string), base64 data (string), or Buffer
 * @param options - Optional configuration for conversion
 * @returns Promise<string> - The converted markdown content
 * 
 * @example
 * ```typescript
 * // Convert from file path
 * const result = await convertToMarkdown('/path/to/document.docx');
 * 
 * // Convert from buffer
 * const buffer = fs.readFileSync('document.pdf');
 * const result = await convertToMarkdown(buffer, { fileName: 'document.pdf' });
 * 
 * // Convert from base64
 * const base64 = 'data:application/pdf;base64,JVBERi0xLjUNCiW...';
 * const result = await convertToMarkdown(base64);
 * ```
 */
export async function convertToMarkdown(
  input: ConverterInput,
  options: ConverterOptions = {}
): Promise<string> {
  const { buffer, extension: ext } = await detectFileType(input, options);

  switch (ext) {
    case '.pdf':
      return await convertPdfToMarkdown(buffer);

    case '.docx':
      return await convertDocxToMarkdown(buffer);

    case '.html':
    case '.htm':
      return convertHtmlToMarkdown(buffer);

    case '.txt':
      return convertTextFileToMarkdown(buffer);

    case '.ipynb':
      return await convertIpynbToMarkdown(buffer);

    case '.xml':
    case '.rss':
    case '.atom':
      return await convertRssAtomToMarkdown(buffer);

    case '.xlsx':
    case '.xls':
      return await convertExcelToMarkdown(buffer);

    case '.csv':
      return convertCsvToMarkdown(buffer);

    case '.mp3':
    case '.wav':
      return await convertAudioToMarkdown(buffer, ext);

    case '.pptx':
      return await convertPptxToMarkdown(buffer);

    case '.zip':
      return await convertZipToMarkdown(buffer, options);

    case '.jpg':
    case '.jpeg':
    case '.png':
    case '.gif':
      return await convertImageToMarkdown(buffer, ext);

    case '.json':
      return convertJsonToMarkdown(buffer);

    case '.yaml':
    case '.yml':
      return convertYamlToMarkdown(buffer);

    default:
      // Handle special cases based on URL
      if (options.url && options.url.includes('youtube.com')) {
        return convertYoutubeToMarkdown(buffer, options.url);
      }

      if (options.url && options.url.includes('bing.com/search')) {
        return convertBingSerpToMarkdown(buffer, options.url);
      }

      return convertTextFileToMarkdown(buffer);
  }
}

/**
 * Saves markdown content to a file
 * 
 * @param content - The markdown content to save
 * @param fileName - Name for the output file (without extension)
 * @param outputDir - Directory to save the file (defaults to "output")
 * @returns Promise<string> - Path to the saved file
 * 
 * @example
 * ```typescript
 * const markdown = await convertToMarkdown('document.pdf');
 * const filePath = await saveToMarkdownFile(markdown, 'document', './output');
 * console.log(`Saved to: ${filePath}`);
 * ```
 */
export async function saveToMarkdownFile(
  content: string,
  fileName: string,
  outputDir: string = 'output'
): Promise<string> {
  try {
    const outputPath = isAbsolute(outputDir)
      ? outputDir
      : join(process.cwd(), outputDir);

    if (!existsSync(outputPath)) {
      mkdirSync(outputPath, { recursive: true });
    }

    const mdFileName = fileName.endsWith('.md') ? fileName : `${fileName}.md`;
    const filePath = join(outputPath, mdFileName);

    writeFileSync(filePath, content, 'utf-8');
    return filePath;
  } catch (err: any) {
    throw new Error(`Failed to save markdown file: ${err.message}`);
  }
}

/**
 * Converts multiple inputs to Markdown in parallel.
 *
 * @param items  - Array of {input, options?} objects
 * @returns Array of BatchResult — one entry per input, with result or error
 *
 * @example
 * ```typescript
 * const results = await convertBatchToMarkdown([
 *   { input: 'report.pdf' },
 *   { input: Buffer.from('<h1>Hi</h1>'), options: { forceExtension: '.html' } },
 * ]);
 * ```
 */
export async function convertBatchToMarkdown(items: BatchInput[]): Promise<BatchResult[]> {
  return Promise.all(
    items.map(async ({ input, options = {} }) => {
      const inputId = typeof input === 'string' ? input : 'buffer';
      try {
        const result = await convertToMarkdown(input, options);
        return { inputId, result };
      } catch (err: any) {
        return { inputId, error: err.message };
      }
    })
  );
}

// Export all types
export * from './types/index.js';

// Default export for backward compatibility
export default {
  convertToMarkdown,
  convertBatchToMarkdown,
  saveToMarkdownFile,
};
