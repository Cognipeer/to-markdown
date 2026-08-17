# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
