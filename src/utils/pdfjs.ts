/**
 * The one place that decides which pdf.js this package uses.
 *
 * unpdf's bundled pdf.js cannot load pdf.js's wasm image decoders, so pages
 * stored as CCITT G4 or JBIG2 images — how black-and-white scanners save
 * documents — render as blank pages and OCR reads nothing from them. The
 * official pdfjs-dist build can, once it is told where the decoders are.
 */
import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { definePDFJSModule, getDocumentProxy } from 'unpdf';

const require = createRequire(import.meta.url);
const pdfjsDir = dirname(require.resolve('pdfjs-dist/package.json'));
const wasmUrl = join(pdfjsDir, 'wasm') + sep;

let configured: Promise<void> | null = null;

/** Opens a PDF with pdfjs-dist and its image decoders. */
export async function loadPdf(buffer: Uint8Array): ReturnType<typeof getDocumentProxy> {
  configured ??= definePDFJSModule(() => import('pdfjs-dist/legacy/build/pdf.mjs'));
  await configured;
  return getDocumentProxy(new Uint8Array(buffer), { wasmUrl });
}

/**
 * The canvas module pdfjs-dist itself loads. pdf.js builds clip paths with that
 * module's Path2D, and a second copy of the canvas package rejects them.
 */
export const canvasImport = () =>
  import(pathToFileURL(require.resolve('@napi-rs/canvas', { paths: [pdfjsDir] })).href);
