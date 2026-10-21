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
// pdf.js rejects these locations unless they end in "/", also on Windows where
// path.sep is "\"; Node reads Windows paths written with "/" as well.
const pdfjsFolder = (name: string) => join(pdfjsDir, name).split(sep).join('/') + '/';
const wasmUrl = pdfjsFolder('wasm');
// Fonts a PDF uses without embedding them (Helvetica, Times, Courier). Without
// pdf.js's own copies that text is drawn with the system's fonts, and a server
// image that has none draws nothing.
const standardFontDataUrl = pdfjsFolder('standard_fonts');

let configured: Promise<void> | null = null;

/** Opens a PDF with pdfjs-dist, its image decoders and its standard fonts. */
export async function loadPdf(buffer: Uint8Array): ReturnType<typeof getDocumentProxy> {
  configured ??= definePDFJSModule(() => import('pdfjs-dist/legacy/build/pdf.mjs'));
  await configured;
  return getDocumentProxy(new Uint8Array(buffer), { wasmUrl, standardFontDataUrl });
}

/**
 * The canvas module pdfjs-dist itself loads. pdf.js builds clip paths with that
 * module's Path2D, and a second copy of the canvas package rejects them.
 */
export const canvasImport = () =>
  import(pathToFileURL(require.resolve('@napi-rs/canvas', { paths: [pdfjsDir] })).href);
