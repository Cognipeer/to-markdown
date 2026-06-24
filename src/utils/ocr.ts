import type { OCROptions } from '../types/index.js';

/**
 * Extracts text from an image buffer using Tesseract.js.
 *
 * Requires the optional peer dependency:
 *   npm install tesseract.js
 *
 * @param buffer - Image buffer (PNG, JPEG, etc.)
 * @param opts   - OCR options (language, etc.)
 */
export async function ocrImage(
  buffer: Buffer,
  opts: OCROptions = {}
): Promise<string> {
  const { lang = 'eng' } = opts;

  let createWorker: (lang: string) => Promise<any>;
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — optional peer dependency
    const tesseract = await import('tesseract.js');
    createWorker = tesseract.createWorker;
  } catch {
    throw new Error(
      'OCR requires tesseract.js: npm install tesseract.js'
    );
  }

  const worker = await createWorker(lang);
  try {
    const { data } = await worker.recognize(buffer);
    return (data.text ?? '').trim();
  } finally {
    await worker.terminate();
  }
}
