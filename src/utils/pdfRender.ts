/**
 * Renders a single PDF page to a PNG buffer.
 *
 * Uses unpdf (bundled dependency) so it is not affected by the host
 * application's pdfjs-dist version.
 *
 * Requires optional peer dependency for Node.js canvas rendering:
 *   npm install canvas   (or)   npm install @napi-rs/canvas
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

  // unpdf ships its own bundled pdfjs — not affected by host's pdfjs-dist version
  const { renderPageAsImage } = await import('unpdf');

  // Resolve canvas implementation: prefer `canvas`, fall back to `@napi-rs/canvas`
  let canvasImport: (() => Promise<any>) | undefined;
  try {
    await import('canvas');
    canvasImport = () => import('canvas');
  } catch {
    try {
      // @ts-ignore — optional peer dependency
      await import('@napi-rs/canvas');
      // @ts-ignore — optional peer dependency
      canvasImport = () => import('@napi-rs/canvas');
    } catch {
      throw new Error(
        'PDF rendering requires a canvas library: npm install canvas'
      );
    }
  }

  // renderPageAsImage returns ArrayBuffer; convert to Buffer for Node.js consumers
  const result = await renderPageAsImage(
    new Uint8Array(buffer),
    pageNum,
    { canvas: canvasImport, scale }
  );

  return Buffer.from(result);
}
