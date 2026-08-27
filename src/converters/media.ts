import { imageDimensionsFromData } from 'image-dimensions';
import { lookup } from 'mime-types';
import { parseBuffer } from 'music-metadata';
import { formatMarkdown } from '../utils/markdown.js';
import type { OCROptions } from '../types/index.js';

function imageMimeType(
  ext: string,
  fileName?: string,
  formatType?: string
): string | undefined {
  if (formatType) {
    const fromDetectedFormat = lookup(
      `file.${formatType === 'jpg' ? 'jpeg' : formatType}`
    );
    if (fromDetectedFormat) return fromDetectedFormat;
  }

  const normalizedExt = (ext.startsWith('.') ? ext : `.${ext}`).toLowerCase();
  const fromExtension = lookup(`file${normalizedExt}`);
  if (fromExtension) return fromExtension;

  const fromFileName = fileName ? lookup(fileName) : false;
  if (fromFileName) return fromFileName;

  return undefined;
}

/**
 * Converts image buffer to Markdown with metadata.
 * Pass `ocr: true` (or an OCROptions object) to also extract text via Tesseract.js.
 * Requires optional peer dep for OCR: npm install tesseract.js
 *
 * @param buffer   - Image file buffer
 * @param ext      - File extension
 * @param ocr      - OCR option (opt-in, default off)
 * @param fileName - Original file name from ConverterOptions, when provided
 */
export async function convertImageToMarkdown(
  buffer: Buffer,
  ext: string,
  ocr?: boolean | OCROptions,
  fileName?: string
): Promise<string> {
  try {
    const measured = imageDimensionsFromData(buffer);
    if (!measured) {
      throw new Error('unsupported or invalid image data');
    }

    // `image-dimensions` reports JPEG as `jpeg`; the rest of this package (and
    // its Markdown output) uses the `jpg` spelling.
    const dimensions = {
      width: measured.width,
      height: measured.height,
      type: measured.type === 'jpeg' ? 'jpg' : measured.type,
    };

    let md = '';

    if (dimensions.width && dimensions.height) {
      md += `ImageSize: ${dimensions.width}x${dimensions.height}\n`;
    }

    if (dimensions.type) {
      md += `Format: ${dimensions.type}\n`;
    }

    // OCR — opt-in only
    if (ocr) {
      try {
        const { ocrImage } = await import('../utils/ocr.js');
        const ocrOpts: OCROptions = typeof ocr === 'object' ? ocr : {};
        const text = await ocrImage(buffer, ocrOpts, {
          mimeType: imageMimeType(ext, fileName, dimensions.type),
          sourceExtension: ext,
          fileName,
          imageWidth: dimensions.width,
          imageHeight: dimensions.height,
        });
        if (text) md += `\n\n## Extracted Text\n\n${text}\n`;
      } catch (ocrErr: any) {
        md += `\n\n<!-- OCR failed: ${ocrErr.message} -->\n`;
      }
    }

    return formatMarkdown(md);
  } catch (err: any) {
    throw new Error(`Failed to convert image: ${err.message}`);
  }
}

/**
 * Converts audio buffer to Markdown with metadata
 * @param buffer - Audio file buffer
 * @param ext - File extension
 * @returns Markdown string with audio metadata
 */
export async function convertAudioToMarkdown(
  buffer: Buffer,
  ext: string
): Promise<string> {
  try {
    const { parseBuffer } = await import('music-metadata');
    const metadata = await parseBuffer(buffer);
    let md = '';

    if (metadata.common.title) md += `Title: ${metadata.common.title}\n`;
    if (metadata.common.artist) md += `Artist: ${metadata.common.artist}\n`;
    if (metadata.common.album) md += `Album: ${metadata.common.album}\n`;
    if (metadata.format.duration)
      md += `Duration: ${metadata.format.duration} sec\n`;
    if (metadata.format.bitrate)
      md += `Bitrate: ${metadata.format.bitrate} kbps\n`;

    // TODO: Add speech-to-text transcription

    return formatMarkdown(md);
  } catch (err: any) {
    throw new Error(`Failed to convert audio: ${err.message}`);
  }
}
