# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.2.0] - 2026-07-22

### Added

- OCR provider `'handler'`: pass a custom async `handler(buffer, context)` callback; the library performs no HTTP requests in this mode
- `OCRHandler`, `OCRHandlerContext`, and `handler` field on `OCROptions`
- OCR handler context includes page metadata (PDF), MIME hint, source extension, fileName, and image dimensions

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
- **Version Bump**: 1.0.1 → 2.0.0 (breaking in terms of package structure)

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
