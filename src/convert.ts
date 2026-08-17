import type { ConverterInput, ConverterOptions } from './types/index.js';
import { detectFileType } from './utils/fileDetection.js';
import { convertPdfToMarkdown } from './converters/pdf.js';
import { convertDocxToMarkdown } from './converters/docx.js';
import { convertHtmlToMarkdown } from './converters/html.js';
import {
  convertTextFileToMarkdown,
  convertYoutubeToMarkdown,
  convertBingSerpToMarkdown,
} from './converters/text.js';
import { convertIpynbToMarkdown } from './converters/notebook.js';
import { convertRssAtomToMarkdown } from './converters/xml.js';
import { convertExcelToMarkdown, convertCsvToMarkdown } from './converters/spreadsheet.js';
import { convertAudioToMarkdown, convertImageToMarkdown } from './converters/media.js';
import { convertPptxToMarkdown, convertZipToMarkdown } from './converters/archive.js';
import { convertJsonToMarkdown, convertYamlToMarkdown } from './converters/data.js';
import { convertEpubToMarkdown } from './converters/epub.js';
import { convertMsgToMarkdown } from './converters/msg.js';

/**
 * Main function to convert various file formats to Markdown.
 *
 * @param input   - File path (string), base64 data URL (string), or Buffer
 * @param options - Optional configuration for conversion
 * @returns Converted Markdown content
 *
 * @example
 * ```typescript
 * // From file path
 * const md = await convertToMarkdown('/path/to/document.docx');
 *
 * // From buffer
 * const buf = fs.readFileSync('report.pdf');
 * const md  = await convertToMarkdown(buf, { fileName: 'report.pdf' });
 *
 * // With OCR (opt-in, requires: npm install tesseract.js)
 * const md = await convertToMarkdown('scan.pdf', { ocr: true });
 * ```
 */
export async function convertToMarkdown(
  input: ConverterInput,
  options: ConverterOptions = {}
): Promise<string> {
  const { buffer, extension: ext } = await detectFileType(input, options);

  switch (ext) {
    case '.pdf':
      return await convertPdfToMarkdown(buffer, options.ocr, options.fileName);

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
      return await convertImageToMarkdown(buffer, ext, options.ocr, options.fileName);

    case '.json':
      return convertJsonToMarkdown(buffer);

    case '.yaml':
    case '.yml':
      return convertYamlToMarkdown(buffer);

    case '.epub':
      return await convertEpubToMarkdown(buffer);

    case '.msg':
      return convertMsgToMarkdown(buffer);

    default:
      if (options.url && options.url.includes('youtube.com')) {
        return convertYoutubeToMarkdown(buffer, options.url);
      }
      if (options.url && options.url.includes('bing.com/search')) {
        return convertBingSerpToMarkdown(buffer, options.url);
      }
      return convertTextFileToMarkdown(buffer);
  }
}
