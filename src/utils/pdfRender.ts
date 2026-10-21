import { canvasImport, loadPdf } from './pdfjs.js';

/**
 * Renders a single PDF page to a PNG buffer.
 *
 * Renders through unpdf with pdfjs-dist (see ./pdfjs.ts) and `@napi-rs/canvas`,
 * both dependencies of this package.
 */
export async function renderPdfPageToPng(
  buffer: Buffer,
  pageNum: number = 1,
  scale: number = 2.0
): Promise<Buffer> {
  const header = buffer.subarray(0, Math.min(buffer.length, 1024)).toString('latin1');
  if (!header.includes('%PDF-')) {
    throw new Error('Invalid PDF buffer: missing PDF header');
  }

  const { renderPageAsImage } = await import('unpdf');

  // renderPageAsImage returns ArrayBuffer; convert to Buffer for Node.js consumers
  const result = await renderPageAsImage(
    await loadPdf(buffer),
    pageNum,
    { canvasImport, scale }
  );

  return Buffer.from(result);
}
