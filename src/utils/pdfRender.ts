/**
 * Renders a single PDF page to a PNG buffer.
 *
 * Uses unpdf (bundled dependency) so it is not affected by the host
 * application's pdfjs-dist version.
 *
 * Requires a Node.js canvas implementation. unpdf renders through
 * `@napi-rs/canvas`, which is shipped as a dependency of this package.
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

  // unpdf's Node canvas factory is built against `@napi-rs/canvas`: it calls
  // `canvas.encode('png')`, which the legacy `canvas` package does not provide.
  let canvasImport: () => Promise<any>;
  try {
    await import('@napi-rs/canvas');
    canvasImport = () => import('@napi-rs/canvas');
  } catch {
    throw new Error(
      'PDF rendering requires a canvas library: npm install @napi-rs/canvas'
    );
  }

  // renderPageAsImage returns ArrayBuffer; convert to Buffer for Node.js consumers
  const result = await renderPageAsImage(
    new Uint8Array(buffer),
    pageNum,
    { canvasImport, scale }
  );

  return Buffer.from(result);
}
