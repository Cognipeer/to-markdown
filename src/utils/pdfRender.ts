/**
 * Renders a single PDF page to a PNG buffer.
 *
 * Requires optional peer dependencies:
 *   npm install pdfjs-dist
 *   npm install @napi-rs/canvas   (or)   npm install canvas
 */
export async function renderPdfPageToPng(
  buffer: Buffer,
  pageNum: number = 1,
  scale: number = 2.0
): Promise<Buffer> {
  // 1. Load pdfjs-dist
  let pdfjsLib: any;
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — optional peer dependency
    pdfjsLib = await import('pdfjs-dist');
  } catch {
    throw new Error(
      'PDF rendering requires pdfjs-dist: npm install pdfjs-dist'
    );
  }

  // 2. Load a canvas implementation (@napi-rs/canvas preferred, then canvas)
  let createCanvas: (w: number, h: number) => any;
  try {
    // @ts-ignore — optional peer dependency
    const m = await import('@napi-rs/canvas');
    createCanvas = m.createCanvas;
  } catch {
    try {
      // @ts-ignore — optional peer dependency
      const m = await import('canvas');
      createCanvas = m.createCanvas;
    } catch {
      throw new Error(
        'PDF rendering requires a canvas library: npm install @napi-rs/canvas'
      );
    }
  }

  const pdf = await pdfjsLib.getDocument(new Uint8Array(buffer)).promise;
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale });

  const canvas = createCanvas(
    Math.ceil(viewport.width),
    Math.ceil(viewport.height)
  );
  const context = canvas.getContext('2d');
  await page.render({ canvasContext: context, viewport }).promise;

  return canvas.toBuffer('image/png');
}
