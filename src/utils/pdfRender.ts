import type { OCRRenderOptions } from '../types/index.js';
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

  const pdf = await loadPdf(buffer);
  try {
    // renderPageAsImage returns ArrayBuffer; convert to Buffer for Node.js consumers
    const result = await renderPageAsImage(pdf, pageNum, { canvasImport, scale });
    return Buffer.from(result);
  } finally {
    // unpdf only destroys documents it loaded itself.
    try {
      await pdf.loadingTask?.destroy?.();
    } catch {
      /* best effort */
    }
  }
}

/** A PDF page rasterised for OCR. */
export interface RenderedPdfPage {
  buffer: Buffer;
  mimeType: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
}

const DEFAULT_RENDER_SCALE = 2;
const DEFAULT_MAX_PIXELS = 40_000_000;

/**
 * Renders one page of an already loaded PDF for OCR, honouring
 * {@link OCRRenderOptions}: the scale is reduced so that width*height stays
 * within `maxPixels`; the result can be re-encoded as JPEG and/or grayscale
 * (sharp). Reusing the loaded document avoids re-parsing the PDF per page.
 */
export async function renderPdfPageForOcr(
  pdf: Awaited<ReturnType<typeof loadPdf>>,
  pageNum: number,
  render: OCRRenderOptions = {}
): Promise<RenderedPdfPage> {
  const { renderPageAsImage } = await import('unpdf');

  const requested = render.scale && render.scale > 0 ? render.scale : DEFAULT_RENDER_SCALE;
  const maxPixels = render.maxPixels && render.maxPixels > 0 ? render.maxPixels : DEFAULT_MAX_PIXELS;

  const page = await pdf.getPage(pageNum);
  const base = page.getViewport({ scale: 1 });
  page.cleanup();
  let scale = requested;
  // Canvas sizes are rounded up: shrink until the rounded size fits.
  for (let i = 0; i < 40; i++) {
    const w = Math.ceil(base.width * scale);
    const h = Math.ceil(base.height * scale);
    if (w * h <= maxPixels) break;
    scale = Math.min(scale, Math.sqrt(maxPixels / (base.width * base.height))) * 0.995;
  }

  let png = Buffer.from(await renderPageAsImage(pdf, pageNum, { canvasImport, scale }));
  const dims = readPngSize(png);
  let width = dims?.width ?? Math.ceil(base.width * scale);
  let height = dims?.height ?? Math.ceil(base.height * scale);

  const jpeg = render.format === 'jpeg';
  if (jpeg || render.grayscale) {
    const sharp = (await import('sharp')).default;
    // Transparent areas become white (JPEG has no alpha; OCR wants dark-on-light).
    let pipeline = sharp(png).flatten({ background: '#ffffff' });
    if (render.grayscale) pipeline = pipeline.grayscale().toColourspace('b-w');
    pipeline = jpeg
      ? pipeline.jpeg({ quality: render.jpegQuality && render.jpegQuality > 0 ? render.jpegQuality : 85 })
      : pipeline.png();
    const out = await pipeline.toBuffer({ resolveWithObject: true });
    png = out.data;
    width = out.info.width;
    height = out.info.height;
  }
  return { buffer: png, mimeType: jpeg ? 'image/jpeg' : 'image/png', width, height };
}

function readPngSize(png: Buffer): { width: number; height: number } | undefined {
  if (png.length < 24 || png.toString('latin1', 1, 4) !== 'PNG') return undefined;
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}
