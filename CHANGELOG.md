# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.6.1] - 2026-10-30

### Fixed

- PPTX picture alt text: a backslash in a picture description is now escaped
  along with the brackets. Before, a backslash in front of a bracket, or at the
  end of the description, ended the alt text early. Pictures are listed with
  `images: 'placeholder'` and with `ocr.embeddedImages`.
- DOCX, HTML and EPUB picture alt text: `turndown` is now required at 7.2.3 or
  later, the first version that escapes it. An installed 7.2.0 to 7.2.2 wrote
  it unescaped.

## [3.6.0] - 2026-10-28

### Added

- Per-page PDF OCR: `ocr.pdfMode: 'auto-page'` OCRs only the pages whose text
  layer is missing, garbled or too short (a scan with a stamp), keeps the
  native text of the other pages and preserves page order. Tune it with
  `pageTrigger` (`minChars`, `maxGarbledRatio`, `requireImage`).
- `convertToMarkdownDetailed(input, options?)`: the same Markdown plus a report
  (per-page source and reason, per-image results, warnings, OCR/render timings).
- OCR handler results can be objects (`{ text, markdown?, confidence? }`);
  handler context gained `kind`, `index`, `sourcePath`, `slide`, `langHint` and
  `signal`. `ocr.documentHandler` OCRs a whole PDF in one call.
- OCR pipeline controls: `render` (scale, `maxPixels`, jpeg, grayscale),
  `maxPages`, `concurrency`, `timeoutMs`, `signal` (abort), `onProgress` and
  `onError` (`comment` / `skip` / `throw`).
- Tesseract: one reusable worker per conversion (up to 4 with `concurrency`),
  `tesseract.langPath`, `cachePath`, `offline` (never downloads or writes
  language data), `psm`, `oem`, `gzip`; ISO 639-1 language codes (`'tr+en'`)
  and the exported `toTesseractLang()` helper.
- VLM providers: real media type, conversion of unsupported formats to PNG,
  retries with backoff (`vlm.retries`, `Retry-After`) and `vlm.timeoutMs`.
- Embedded images in DOCX, PPTX, HTML and EPUB: `images: 'placeholder' | 'omit'`
  and OCR of embedded images with `ocr.embeddedImages` (size filter, dedupe,
  `maxImages`). EPUB images are not OCRed yet.
- Multi-page TIFF support (`Pages: N` header, per-frame OCR), EXIF
  auto-rotation before image OCR (`ocr.autoRotate`), `imageMetadata: false`
  and `imageTextHeading: false` (with both, an image converts to its
  recognised text alone).
- `FileExtension.TIF`, `TIFF`, `WEBP` and `BMP`.
- `benchmark/ocr/run.ts` and an opt-in real Tesseract test
  (`TM_TEST_TESSERACT=1`, `TM_TESSDATA_DIR`); neither is part of `npm test`.

### Fixed

- `.tif`, `.tiff`, `.webp` and `.bmp` files were decoded as UTF-8 text and
  produced garbage; they are now handled as images.
- PPTX conversion wrote a temporary file into the working directory; the
  archive is now read from memory.

### Notes

- No breaking changes. With the options 3.5.0 knew (including `ocr: true`
  and the legacy `pdfMode` values) the document structure and text are
  identical to 3.5.0 for the inputs covered by the golden-output test, which
  uses a fixed fake OCR handler.
- Public types only gained optional members and new types. `OCRHandler`,
  `OCROptions.lang` (still a `string`) and every existing result type are
  unchanged; two input options accept more values: `pdfMode` adds
  `'auto-page'`, and `handler` also takes an `OCRRichHandler` (a handler that
  may resolve to `{ text, markdown?, confidence? }`). Language lists go in the
  new `OCROptions.languages`.

### Behaviour notes

Calls that already worked in 3.5.0 differ in these runtime details:

- VLM requests (`openai-vlm`, `anthropic-vlm`, `ollama-vlm`, `custom-vlm`)
  send the real media type of the image instead of always `image/png`; types
  the APIs do not accept are converted to PNG.
- VLM calls retry on HTTP 429, 5xx and network errors (default `retries: 2`,
  backoff 1 s and 2 s), so a persistent failure takes about 3 s longer to
  surface. Opt out with `vlm.retries: 0`.
- Image OCR applies the EXIF orientation by default (`autoRotate: true`):
  handlers and Tesseract receive the re-encoded, rotated image for JPEGs with
  an orientation tag. Opt out with `ocr.autoRotate: false`.
- ISO `lang` values such as `'tr'` are mapped to Tesseract codes (`'tur'`);
  other values pass through unchanged.
- OCR handler contexts always carry `kind` and `index`, plus `signal` when a
  signal is active.
- With the Tesseract provider, `concurrency` is capped at 4 (the worker count).

## [3.5.0] - 2026-10-21

### Fixed

- PDF pages stored as CCITT G4 or JBIG2 images, which is how black-and-white
  scanners save documents, rendered as blank pages, so OCR read nothing from
  them. PDFs are now opened with pdfjs-dist, which loads the wasm image
  decoders that unpdf's bundled pdf.js could not.
- Text in fonts a PDF uses without embedding them (Helvetica, Times, Courier)
  was drawn with the system's fonts (unpdf turns on `useSystemFonts`), so it
  rendered blank on servers without any, such as slim Docker images. pdf.js
  now uses its own copies of those fonts.

### Added

- `extractPdfPages(buffer)`: the text layer of each PDF page, without OCR. A
  scanned page without a text layer comes back as an empty string.

### Changed

- `pdfjs-dist` is now a dependency.

## [3.4.2] - 2026-09-11

### Fixed

- Run npm publishing on a GitHub-hosted runner so npm can verify the signed
  provenance bundle.

## [3.4.1] - 2026-09-11

### Added

- Binary Word 97-2003 `.doc` to Markdown conversion with bounded Compound File
  parsing, list-marker recovery, header and footnote preservation by default,
  and per-call input/output limits.

### Fixed

- Preserve tabs in visible Word field results after dropping field instructions,
  preventing table-of-contents labels from running into page numbers.
- Classify Word 6/95 document identifiers as unsupported instead of invalid.
- Reject configured DOC base64 inputs before decoding when their decoded size
  exceeds the input limit.
- Normalize Word-specific ordered-list markers to CommonMark-compatible Markdown
  and preserve nested-list indentation at the start of a document.
- Return header-only and footnote-only DOC stories instead of treating them as
  empty documents.

## [3.2.2] - 2026-08-27

### Changed

- Release packaging is now validated through the CRM-managed npm Trusted Publishing workflow

## [3.2.1] - 2026-08-26

### Fixed

- Invalid PDF input is rejected immediately instead of hanging during parsing

## [3.2.0] - 2026-08-17

### Added

- OCR provider `'handler'`: pass a custom async `handler(buffer, context)` callback; the library performs no HTTP requests in this mode
- `OCRHandler`, `OCRHandlerContext`, and `handler` field on `OCROptions`
- OCR handler context includes page metadata (PDF), MIME hint, source extension, fileName, and image dimensions

## [3.1.1] - 2026-08-03

### Changed

- `music-metadata` is now lazy-loaded (dynamic `import()`) inside the audio converter instead of a top-level import, avoiding its startup cost for consumers that never process audio files

## [3.1.0] - 2026-07-17

### Fixed

- HTML to Markdown conversion no longer collapses tables, fenced code blocks, and ordered/nested lists onto a single line; `formatMarkdown` is now structure-aware and preserves per-line formatting for tables, list items, blockquotes, headings, and horizontal rules
- Ordered (`<ol>`) and nested list numbering/indentation is preserved instead of flattening every `<li>` into a top-level bullet
- Removed stray `<head>`/`<title>` leakage into the converted body
- Fixed whitespace handling inside `<pre>` blocks and parsing of void elements like `<img>`
- Spreadsheet/CSV table output (which shares the same formatting pipeline) is no longer mangled

## [3.0.3] - 2026-07-06

### Fixed

- PDF page rendering now delegates to `unpdf`'s bundled `renderPageAsImage()` instead of a manual `pdfjs-dist` pipeline, avoiding version conflicts when a host application bundles a different `pdfjs-dist` version (this previously caused scanned PDF OCR to silently return empty results)

### Added

- `canvas` added as a direct dependency for Node.js PDF rendering

## [3.0.2] - 2026-07-02

No functional changes — republished to reconcile the direct 3.0.1 hotfix commit with the corresponding pull request (#9) merge.

## [3.0.1] - 2026-07-02

### Fixed

- OCR VLM API compatibility: `max_tokens` to `max_completion_tokens` for OpenAI VLM requests, since newer models (gpt-5.x, o4-mini) rejected the old parameter — fixes OCR support for 12 additional models
- PDF rendering: added a Node.js canvas factory required by `pdfjs-dist` v4 (previously failed with `Cannot read properties of undefined (reading 'createCanvas')`)
- Rendering failures are now skipped per-page as expected, while OCR API errors correctly propagate to the caller instead of being silently swallowed

## [3.0.0] - 2026-06-26

### Added

- OCR support for images and scanned PDFs, with `tesseract.js` bundled as a direct dependency (default provider)
- Multi-provider VLM-based OCR: `openai-vlm`, `anthropic-vlm`, `ollama-vlm`, `azure-vision`, `custom-vlm`
- New converters: EPUB, URL, and structured data
- Benchmark and test suite (Vitest) covering real-world files across all supported formats

## [2.0.1] - 2025-10-09

### Changed

- Image metadata extraction now uses the `image-size` package

## [2.0.0] - 2025-10-09

### 🎉 Major Release - TypeScript Rewrite

This is a major rewrite of the library in TypeScript with improved architecture and documentation.

### ✨ Added

- **TypeScript Support**: Complete rewrite in TypeScript with full type definitions
- **Modular Architecture**: Organized codebase with separate converter modules
  - `src/converters/` - Format-specific converters (pdf, docx, html, etc.)
  - `src/types/` - TypeScript type definitions
  - `src/utils/` - Utility functions
- **Type Definitions**: Export all types for use in consuming applications
- **Examples Directory**: Added comprehensive examples in `examples/`
  - `basic-usage.ts` - Common conversion scenarios
  - `spreadsheet-conversion.ts` - Excel and CSV examples
  - `advanced-usage.ts` - Complex use cases
- **Documentation Site**: GitHub Pages documentation
  - Getting Started guide
  - Complete API reference
  - Format support guide
  - Error handling guide
- **GitHub Actions**: CI/CD workflows for build and publish
- **Contributing Guide**: Detailed contribution guidelines
- **Migration Guide**: v1.x to v2.0 migration documentation

### 🔧 Changed

- **Package Structure**:
  - Source files now in `src/*.ts` instead of `src/*.js`
  - Built files in `dist/` with proper type declarations
  - Improved package.json exports for better ESM/CJS compatibility
- **Build Process**:
  - TypeScript compilation with `tsc`
  - Rollup bundling for optimized output
  - Separate ESM and CJS builds
- **Version Bump**: 1.0.1 to 2.0.0 (breaking in terms of package structure)

### 📚 Improved

- **Type Safety**: Full TypeScript support with strict type checking
- **Developer Experience**: Better IDE autocomplete and IntelliSense
- **Code Organization**: Modular structure makes code easier to maintain
- **Documentation**: Comprehensive docs with examples
- **Error Messages**: More descriptive error messages with better context

### 🔄 Maintained

- **Backward Compatible API**: All existing JavaScript code continues to work
- **Same Functionality**: All conversion features from v1.x are preserved
- **No Breaking Changes**: API surface remains identical

## [1.0.1] - 2024

### Initial Release

- Support for PDF, DOCX, HTML, Excel, CSV, Jupyter, PowerPoint, XML/RSS, Images, Audio
- Basic conversion API with `convertToMarkdown()` and `saveToMarkdownFile()`
- JavaScript implementation with CommonJS and ESM support

---

## Migration Notes

### v1.x to v2.0

- **No code changes required** for basic usage
- TypeScript users get full type definitions
- Package now ships with `dist/` instead of `src/`
- See [MIGRATION.md](./MIGRATION.md) for detailed migration guide

## Future Plans

### Planned for v2.x

- [ ] Add comprehensive test suite
- [ ] OCR support for image text extraction
- [ ] Speech-to-text for audio transcription
- [ ] Performance optimizations
- [ ] Additional format support
- [ ] CLI tool for command-line usage
- [ ] Batch processing utilities

### Under Consideration

- [ ] Plugin system for custom converters
- [ ] Streaming API for large files
- [ ] Progress callbacks
- [ ] Markdown customization options
- [ ] Output format templates

---

For more information, see:

- [README.md](./README.md)
- [Documentation](https://cognipeer.github.io/to-markdown/)
- [Contributing Guidelines](./CONTRIBUTING.md)
