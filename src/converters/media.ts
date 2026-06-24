import sizeOf from 'image-size';
import { parseBuffer } from 'music-metadata';
import { formatMarkdown } from '../utils/markdown.js';
import type { ImageMetadata, AudioMetadata, OCROptions } from '../types/index.js';

/**
 * Converts image buffer to Markdown with metadata.
 * Pass `ocr: true` (or an OCROptions object) to also extract text via Tesseract.js.
 * Requires optional peer dep for OCR: npm install tesseract.js
 *
 * @param buffer - Image file buffer
 * @param ext    - File extension
 * @param ocr    - OCR option (opt-in, default off)
 */
export async function convertImageToMarkdown(
  buffer: Buffer,
  ext: string,
  ocr?: boolean | OCROptions
): Promise<string> {
  try {
    const dimensions = sizeOf(buffer);

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
        const text = await ocrImage(buffer, ocrOpts);
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
