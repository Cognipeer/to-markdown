# @cognipeer/to-markdown

**Convert PDF, Word, Excel, PowerPoint, HTML, EPUB, notebooks, images and more to clean Markdown, ready for LLM and RAG ingestion.**

[![npm](https://img.shields.io/npm/v/@cognipeer/to-markdown?color=success)](https://npmjs.com/package/@cognipeer/to-markdown)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue)](https://www.typescriptlang.org/)
[![npm downloads](https://img.shields.io/npm/dm/@cognipeer/to-markdown)](https://www.npmjs.com/package/@cognipeer/to-markdown)
[![License](https://img.shields.io/github/license/Cognipeer/to-markdown)](https://github.com/Cognipeer/to-markdown/blob/main/LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/Cognipeer/to-markdown?style=social)](https://github.com/Cognipeer/to-markdown)
[![Docs](https://img.shields.io/badge/docs-docs.cognipeer.com-0A7CFF)](https://docs.cognipeer.com/to-markdown/)

[Docs](https://docs.cognipeer.com/to-markdown/) · [Quick start](#-quick-start) · [Examples](./examples) · [Changelog](./CHANGELOG.md) · [Contact](mailto:developer@cognipeer.com)

**Adoption:** in active use at more than 30 companies that Cognipeer supports as enterprise customers. Open-source users are not included in this count.

## ✨ Features

- 🎯 **Multiple Format Support**: Convert PDF, DOC, DOCX, HTML, Excel, CSV, and more
- 🔎 **OCR Support**: Extract text from scanned PDFs (per page), images, multi-page TIFF and images embedded in DOCX/PPTX/HTML
- 📦 **Simple API**: Easy to use with Promise-based interface
- 🔧 **TypeScript First**: Written in TypeScript with full type definitions
- 🚀 **Fast & Efficient**: Optimized for performance with modular architecture
- 📚 **Well Documented**: Comprehensive documentation with examples
- 🎨 **Customizable**: Options to control conversion behavior

## 📦 Installation

```bash
npm install @cognipeer/to-markdown
```

**Using other package managers:**

```bash
# Yarn
yarn add @cognipeer/to-markdown

# pnpm
pnpm add @cognipeer/to-markdown
```

Optional OCR dependency (for default `tesseract` OCR provider):

```bash
npm install tesseract.js
```

## 📊 Benchmarks

We compared to-markdown 3.5.0 with Microsoft MarkItDown 0.1.9 on PDF, DOCX, PPTX, XLSX, HTML and CSV
using a small synthetic corpus with ground truth. **The benchmark was written by the to-markdown
maintainers**, and MarkItDown wins in places (notably PPTX structure, and slightly PDF text F1).
Each cell is `to-markdown / MarkItDown`; scores are percentages, times are median milliseconds per
file over 20 runs, in-process, on one laptop.

| Format | Files | Text F1 | Structure score | Median ms/file |
| --- | --- | --- | --- | --- |
| DOCX | 5 | 100.0 / 100.0 | 100.0 / 100.0 | 18.1 / 75.6 |
| PDF | 5 | 98.8 / 100.0 | 83.0 / 80.0 | 7.85 / 94.1 |
| PPTX | 2 | 100.0 / 100.0 | 25.0 / 75.0 | 1.12 / 10.7 |
| XLSX | 3 | 100.0 / 97.8 | 100.0 / 96.7 | 1.24 / 5.97 |
| HTML | 5 | 100.0 / 100.0 | 100.0 / 100.0 | 0.81 / 3.29 |
| CSV | 7 | 100.0 / 100.0 | 100.0 / 100.0 | 0.027 / 1.48 |

The corpus is too clean to separate the tools on DOCX, HTML and CSV (both score 100), and several
PDF differences rest on a single file. The PDF structure score covers list recall and table F1 only,
because neither tool recovers PDF headings or links. Speed ratios are order of magnitude: timings are
noisy, and much of the gap on tiny files is MarkItDown's per-call content-type detection (called
through its converter classes directly, HTML is about 1.3x apart and CSV is a tie).

Method, per-file results, failures, limitations and a one-command reproduction are in
[benchmark/markitdown-comparison](./benchmark/markitdown-comparison/README.md).

## 🔧 Development

### Building from Source

```bash
# Install dependencies
npm install

# Build TypeScript and bundles
npm run build

# Watch mode for development
npm run dev
```

### Scripts

- `npm run build` - Build TypeScript and create bundles
- `npm run build:ts` - Compile TypeScript only
- `npm run build:rollup` - Create rollup bundles only
- `npm run clean` - Remove dist directory
- `npm run dev` - Watch mode for TypeScript compilation

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 Changelog

Full history: [CHANGELOG.md](./CHANGELOG.md).

### Version 3.6.1

- Fixed PPTX picture alt text ending early when a description has a backslash before a bracket or at its end.
- Raised the `turndown` floor to 7.2.3, so the alt text of DOCX, HTML and EPUB pictures is always escaped.

### Version 3.6.0

- Added per-page PDF OCR (`pdfMode: 'auto-page'`), `documentHandler`, render options, `concurrency`,
  `timeoutMs`, `signal`, `onProgress`, `onError` and `maxPages`.
- Added `convertToMarkdownDetailed()` with page, image and timing reports, and `toTesseractLang()`.
- Added offline Tesseract (`tesseract.langPath` / `offline`), ISO language codes and one reusable worker per conversion.
- Added the `images` option (`placeholder` / `omit`) and OCR of images embedded in DOCX, PPTX and HTML.
- Fixed TIFF, WEBP and BMP files being decoded as text.
- No breaking changes; defaults unchanged.

### Version 3.5.0

- Fixed scanned PDF pages stored as CCITT G4 or JBIG2 images coming out blank, so
  OCR now reads them (PDFs are opened with pdfjs-dist and its image decoders).
- Fixed blank text on servers without system fonts for PDFs that use
  non-embedded standard fonts (Helvetica, Times, Courier).
- Added `extractPdfPages(buffer)`: the text layer of each page, without OCR.

### Version 3.4.2

- Fixed npm Trusted Publishing provenance verification by running the publish
  workflow on a GitHub-hosted runner.
- Added bounded binary Word 97-2003 `.doc` to Markdown conversion with body,
  header, and footnote story preservation, typed errors, and CommonMark list
  normalization.

### Version 3.2.0

- 🧩 Added `'handler'` OCR provider — supply a custom async callback (with page/image context) and the library makes no HTTP requests of its own

### Version 3.1.x

- 🩹 Fixed HTML→Markdown conversion collapsing tables, fenced code blocks, and ordered/nested lists
- ⚡ Lazy-loaded `music-metadata` in the audio converter to reduce startup cost

### Version 3.0.x

- 🔎 Added OCR support for images and scanned PDFs
- ⚙️ Added `ocr` option in `ConverterOptions` (`boolean | OCROptions`)
- 🌐 Added OCR provider support: `tesseract`, `openai-vlm`, `anthropic-vlm`, `ollama-vlm`, `azure-vision`, `custom-vlm`
- 🧠 Added PDF OCR modes: `auto`, `always`, `never`
- 🐛 Fixed OCR VLM API compatibility and PDF rendering reliability

### Version 2.0.1

- 🖼️ Image metadata extraction now uses `image-size`

### Version 2.0.0

- ✨ Rewritten in TypeScript with full type definitions
- 🏗️ Modular architecture with separate converter modules
- 📚 Comprehensive documentation with GitHub Pages
- 💡 Added usage examples
- 🎯 Improved error handling
- 📦 Better package exports (ESM + CJS)

### Version 1.0.1

- Initial release with JavaScript implementation

📖 See [CHANGELOG.md](./CHANGELOG.md) for the complete, detailed release history.

## Cognipeer open-source projects

| Project | What it does |
| --- | --- |
| [Cognipeer Console](https://github.com/Cognipeer/console) | Self-hosted AI gateway and control plane: OpenAI-compatible routing, RAG, MCP hub, guardrails and agent tracing |
| [console-sdk](https://github.com/Cognipeer/console-sdk) | TypeScript SDK for the Cognipeer Console API |
| [agent-sdk](https://github.com/Cognipeer/agent-sdk) | Lightweight, message-first agent runtime |
| [agent-server](https://github.com/Cognipeer/agent-server) | Ready-made REST API layer for AI agents |
| [chat-ui](https://github.com/Cognipeer/chat-ui) | React chat UI components for AI agents |
| [graph-builder](https://github.com/Cognipeer/graph-builder) | Turn text sources into a queryable graph |
| [cognipeer-observability](https://github.com/Cognipeer/cognipeer-observability) | Drop-in agent tracing for LangChain, LangGraph, OpenAI Agents and OpenTelemetry |

If this project is useful to you, a ⭐ on GitHub helps other developers find it.

Questions or enterprise support: [developer@cognipeer.com](mailto:developer@cognipeer.com).

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 👤 Author

**Cognipeer**

- GitHub: [@Cognipeer](https://github.com/Cognipeer)
- npm: [@cognipeer](https://www.npmjs.com/~cognipeer)

## 🙏 Acknowledgments

Built with these amazing libraries:

- [pdf2md](https://github.com/opendocsg/pdf2md) - PDF parsing
- [mammoth](https://github.com/mwilliamson/mammoth.js) - DOCX conversion
- [turndown](https://github.com/mixmark-io/turndown) - HTML to Markdown
- [xlsx](https://github.com/SheetJS/sheetjs) - Excel parsing
- [cheerio](https://github.com/cheeriojs/cheerio) - HTML parsing
- [sharp](https://github.com/lovell/sharp) - Image processing

## 🔗 Links

- [Documentation](https://docs.cognipeer.com/to-markdown/)
- [npm Package](https://www.npmjs.com/package/@cognipeer/to-markdown)
- [GitHub Repository](https://github.com/Cognipeer/to-markdown)
- [Issue Tracker](https://github.com/Cognipeer/to-markdown/issues)

---

Made with ❤️ by [Cognipeer](https://github.com/Cognipeer)

## 🚀 Quick Start

### Basic Usage

```typescript
import { convertToMarkdown, saveToMarkdownFile } from "@cognipeer/to-markdown";

// Convert from file path
const markdown = await convertToMarkdown("/path/to/document.docx");
console.log(markdown);

// Convert from buffer
const buffer = fs.readFileSync("document.pdf");
const markdown = await convertToMarkdown(buffer, {
  fileName: "document.pdf",
});
console.log(markdown);

// Convert from base64 string
const base64Content = "data:application/pdf;base64,JVBERi0xLjUNCiW...";
const markdown = await convertToMarkdown(base64Content);
console.log(markdown);

// Save converted markdown to a file
await saveToMarkdownFile(markdown, "converted-document", "./output");
```

### TypeScript Usage

```typescript
import {
  convertToMarkdown,
  saveToMarkdownFile,
  type ConverterOptions,
  type ConverterInput,
} from "@cognipeer/to-markdown";

// Type-safe conversion
const options: ConverterOptions = {
  fileName: "document.pdf",
  forceExtension: ".pdf",
  ocr: {
    provider: "tesseract",
    lang: "eng",
    pdfMode: "auto",
  },
};

const input: ConverterInput = "./document.pdf";
const result: string = await convertToMarkdown(input, options);
```

### Convert Binary Word DOC

```typescript
const markdown = await convertToMarkdown(docBuffer, {
  fileName: "policy.doc",
});
```

Binary Word `.doc` conversion supports Word 97-2003 documents. The default
output contains body text and non-empty header stories as Markdown-compatible
sections, including non-empty footnotes. Set `doc.includeHeaders` or
`doc.includeFootnotes` to `false` to omit those stories. Tables remain
tab-separated rows unless cell structure can be established without guesswork.
`DocOptions` also provides per-call input and output limits.

```typescript
const markdown = await convertToMarkdown(docBase64, {
  fileName: "policy.doc",
  doc: {
    maxInputBytes: 10 * 1024 * 1024,
    maxOutputChars: 500_000,
  },
});
```

For Buffer or plain-base64 input, provide `fileName` or `forceExtension: ".doc"`.
The Compound File signature is shared by some older Office formats, so an input
name is required to choose the DOC converter unambiguously. DOC input is limited
to 25 MiB by default and 50 MiB maximum; output is limited to 2,000,000
characters by default and 4,000,000 maximum.

The converter normalizes Word list metadata to CommonMark-compatible unordered
and ordered lists. It does not extract images, OCR text, or embedded-object
payloads, and it rejects encrypted, malformed, Word 6/95, and other unsupported
legacy formats with `DocConversionError`.

## 📖 API Reference

### `convertToMarkdown(input, options?)`

Converts various file formats to Markdown.

**Parameters:**

- `input: ConverterInput` - File path (string), base64 data (string), or Buffer
- `options?: ConverterOptions` - Optional configuration
  - `fileName?: string` - Name of the file (helpful for buffer inputs)
  - `forceExtension?: string` - Force a specific file extension for processing
  - `url?: string` - Original URL (used for web content like YouTube or Bing search)
  - `ocr?: boolean | OCROptions` - Enable OCR for images and scanned PDFs (opt-in)
  - `images?: 'inline' | 'placeholder' | 'omit'` - How images embedded in DOCX/HTML/EPUB/PPTX are rendered (default: `inline`, same as 3.5.0)
  - `imageMetadata?: boolean` - Image files: emit the `ImageSize:` / `Format:` header (default: `true`)
  - `imageTextHeading?: boolean` - Image files: put the OCR text under a `## Extracted Text` heading (default: `true`)
  - `doc?: DocOptions` - Options for binary Word `.doc` conversion

`OCROptions` includes:

- `provider?: 'tesseract' | 'openai-vlm' | 'anthropic-vlm' | 'ollama-vlm' | 'azure-vision' | 'custom-vlm' | 'handler'`
- `lang?: string` - Tesseract codes (`'eng'`, `'tur+eng'`) or ISO 639-1 codes (`'tr'`, `'tr+en'`); default `eng`
- `languages?: string[]` - the same as a list (`['tr', 'en']`); wins over `lang` when both are set
- `pdfMode?: 'auto' | 'auto-page' | 'always' | 'never'` - PDF OCR mode (default: `auto`)
- `vlm?: { model: string; apiKey?: string; apiBase?: string; prompt?: string; maxTokens?: number; retries?: number; timeoutMs?: number }`
- `handler?: (buffer, context) => Promise<string | { text; markdown?; confidence? }>` - Custom async OCR callback (required when `provider: 'handler'`; library makes no HTTP calls)
- `documentHandler?: (pdf, { pages, pageCount, ... }) => Promise<Array<{ page; text; markdown? }>>` - OCR the whole PDF in one call
- `pageTrigger?: { minChars?; maxGarbledRatio?; requireImage? }` - which pages `auto-page` OCRs (defaults 32 / 0.3 / true)
- `render?: { scale?; maxPixels?; format?: 'png' | 'jpeg'; jpegQuality?; grayscale? }` - how PDF pages are rasterised
- `maxPages?`, `concurrency?`, `timeoutMs?`, `signal?`, `onProgress?`, `onError?: 'comment' | 'skip' | 'throw'`
- `tesseract?: { langPath?; cachePath?; offline?; psm?; oem?; gzip? }` - local language data and engine settings
- `embeddedImages?: boolean | { minWidth?; minHeight?; maxImages?; dedupe? }` - OCR images inside DOCX/PPTX/HTML (default off)
- `autoRotate?: boolean` - honour EXIF orientation of image files before OCR (default `true`)

Every new option is optional. Without them, `ocr: true` and the 3.5.0 `OCROptions` produce byte-identical output.

`DocOptions` includes:

- `includeHeaders?: boolean` - Include non-empty document headers (default: `true`)
- `includeFootnotes?: boolean` - Include non-empty document footnotes (default: `true`)
- `maxInputBytes?: number` - DOC input limit (default: 25 MiB; maximum: 50 MiB)
- `maxOutputChars?: number` - Markdown output limit (default: 2,000,000; maximum: 4,000,000)

DOC conversion failures are instances of `DocConversionError` with one of these
codes: `DOC_INVALID`, `DOC_ENCRYPTED`, `DOC_LIMIT_EXCEEDED`, or `DOC_UNSUPPORTED`.

**Returns:** `Promise<string>` - The converted markdown content

**Example:**

```typescript
const markdown = await convertToMarkdown("./document.pdf", {
  forceExtension: ".pdf",
});
```

### OCR Examples

```typescript
// 1) OCR scanned PDF with default provider (tesseract)
const scannedPdf = await convertToMarkdown("./scan.pdf", {
  ocr: true,
});

// 2) OCR image with explicit tesseract options
const imageText = await convertToMarkdown("./receipt.png", {
  ocr: { provider: "tesseract", lang: "eng" },
});

// 3) OCR PDF only when native text extraction is empty
const autoFallback = await convertToMarkdown("./document.pdf", {
  ocr: { pdfMode: "auto" },
});

// 4) Custom OCR handler — you control the OCR call (no fetch inside the library)
const customOcr = await convertToMarkdown("./scan.pdf", {
  ocr: {
    provider: "handler",
    pdfMode: "auto",
    handler: async (buffer, context) => {
      // context: page, pageCount, mimeType, sourceExtension, fileName, imageWidth, imageHeight
      return await myOcrSdk.recognize(buffer, context);
    },
  },
});
```

### `convertToMarkdownDetailed(input, options?)`

Same conversion as `convertToMarkdown` (`markdown` is identical), plus a report of what happened:

```typescript
import { convertToMarkdownDetailed } from "@cognipeer/to-markdown";

const { markdown, pages, images, warnings, stats } = await convertToMarkdownDetailed("./mixed.pdf", {
  ocr: { pdfMode: "auto-page", lang: "tr+en" },
});

// pages: [{ page: 1, source: 'text', chars: 412 },
//         { page: 2, source: 'ocr', chars: 380, reason: 'no-text', ms: 540 }, ...]
// stats: { pageCount, ocrCalls, ocrPages, ocrImages, ocrMs, renderMs }
// warnings: ['ocr_page_failed: page 3: ...', 'ocr_page_limit: ...', 'ocr_timeout: page 4', ...]
```

`pages[].source` is `text`, `ocr`, `empty`, `error` or `skipped`. `images[]` lists embedded and standalone
images with their size, whether OCR produced text and why one was skipped (`small`, `duplicate`, `limit`).

### OCR Guide (3.6)

**Per-page OCR for mixed PDFs (`pdfMode: 'auto-page'`).** `auto` (the default) OCRs the whole document only when
the text layer is empty, so a PDF that mixes native pages with scanned pages loses the scans. `auto-page` checks
every page and OCRs just the ones that need it:

- no text at all (`no-text`);
- a garbled text layer, i.e. more than `pageTrigger.maxGarbledRatio` (0.3) replacement or private-use characters (`garbled`);
- fewer than `pageTrigger.minChars` (32) non-whitespace characters **and** a raster image on the page (`low-text`,
  typical for scans with a stamp or page number; set `requireImage: false` to drop the image requirement).

OCR text replaces the page's text layer; pages that were fine keep their native text, and page order is preserved.
`maxPages` caps the number of OCRed pages (the rest are reported as `skipped` with an `ocr_page_limit` warning).
A failed page keeps its native text and is reported as `error`; set `onError: 'throw'` to fail, or `'comment'` to
leave `<!-- OCR failed (page N): ... -->`. If every page needed OCR and nothing succeeded, the conversion throws
`PDF OCR failed: ...` like the legacy modes.

```typescript
const md = await convertToMarkdown("./mixed.pdf", {
  ocr: {
    pdfMode: "auto-page",
    lang: "tr+en",
    concurrency: 2,
    render: { scale: 2, maxPixels: 20_000_000, grayscale: true },
    onProgress: ({ completed, total }) => console.log(`${completed}/${total}`),
  },
});
```

**Handlers and `documentHandler`.** With `provider: 'handler'` you run the OCR yourself. The handler may return a
string or an object `{ text, markdown?, confidence? }`; `markdown` is preferred over `text` when present. The context
carries `kind` (`pdf-page`, `image`, `tiff-page`, `embedded-image`), `page`, `pageCount`, `index`, `sourcePath`,
`slide`, `mimeType`, `imageWidth`, `imageHeight`, `langHint` (ISO codes) and `signal`. To OCR the whole PDF with one
call (for example with a document-level OCR service), pass `documentHandler`; it receives the PDF buffer and the
candidate pages and returns `[{ page, text, markdown? }]`. No pages are rendered in that case.

```typescript
const md = await convertToMarkdown("./scan.pdf", {
  ocr: {
    provider: "handler",
    pdfMode: "auto-page",
    handler: async (png, ctx) => ({ text: await myOcr(png, ctx.langHint), confidence: 0.93 }),
    // or, one call for the whole document:
    // documentHandler: async (pdf, { pages }) => myDocumentOcr(pdf, pages),
  },
});
```

**Tesseract: offline, `langPath`, language mapping.** One Tesseract worker is created per conversion and reused for
all pages and images (`concurrency > 1` uses up to 4 workers). Language data is normally downloaded on first use;
for servers without internet, point `langPath` at a directory containing `<lang>.traineddata.gz` and set
`offline: true`. Nothing is downloaded or written to the working directory, and a missing language file fails fast
(`tesseract_lang_missing`). `lang` accepts ISO 639-1 codes: `'tr+en'` becomes `'tur+eng'` (see also the exported
`toTesseractLang`). Other settings: `cachePath`, `psm`, `oem`, `gzip` (set `false` for uncompressed `.traineddata`).

```typescript
const md = await convertToMarkdown("./scan.pdf", {
  ocr: {
    lang: "tr+en",
    pdfMode: "auto-page",
    tesseract: { offline: true, langPath: "/opt/tessdata", psm: 6 },
  },
});
```

**Timeouts, abort and errors.** `timeoutMs` limits one OCR task (a timeout counts as a failure and adds an
`ocr_timeout` warning). Pass `signal` to cancel: the conversion rejects with the signal's reason (an `AbortError`),
and abort is never swallowed by `onError`. `onError` is `'comment'` (default for image files: `<!-- OCR failed: msg -->`),
`'skip'` (default for `auto-page` and embedded images) or `'throw'`; it does not apply to the legacy `auto` / `always` PDF
modes, which keep their 3.5.0 behaviour. With `documentHandler`, `timeoutMs` covers the single call for the whole document.
EPUB images are never OCRed: setting `embeddedImages` on an EPUB only adds an `embedded_image_ocr_unsupported` warning. VLM providers retry HTTP 429/5xx and network
errors (`vlm.retries`, default 2, with 1 s / 2 s backoff and `Retry-After` up to 30 s) and send the real image type.

**TIFF, WEBP and BMP.** `.tif`, `.tiff`, `.webp` and `.bmp` are now treated as images. (Before 3.6 they were decoded
as text, which produced garbage.) Multi-page TIFFs get a `Pages: N` header line and, with OCR, every frame is
recognised and the texts are joined under one `## Extracted Text`. Images with an EXIF orientation are rotated
before OCR (`autoRotate: false` disables it). `imageMetadata: false` removes the `ImageSize:` / `Format:` header and
`imageTextHeading: false` the `## Extracted Text` heading; with both, an image converts to its recognised text alone.

**Images embedded in documents.** `images` controls how DOCX, HTML, EPUB and PPTX render images:

- `'inline'` (default): exactly the 3.5.0 output (DOCX/HTML data URIs);
- `'placeholder'`: `![alt](image-1.png)` references instead of base64 data, keeping the alt text;
- `'omit'`: images are dropped.

`ocr.embeddedImages` additionally runs OCR on embedded images of DOCX, PPTX and HTML (`data:` images only; URLs are
never fetched) and inserts the text as a blockquote right after the image. Images smaller than 64x64 are skipped,
identical images are OCRed once, and at most 50 images per document are processed (tune with
`{ minWidth, minHeight, maxImages, dedupe }`). EPUB images are not OCRed in 3.6.

```typescript
const md = await convertToMarkdown("./report.docx", {
  images: "placeholder",
  ocr: { provider: "tesseract", lang: "tr+en", embeddedImages: true },
});
```

---

### `saveToMarkdownFile(content, fileName, outputDir?)`

Saves the markdown content to a file.

**Parameters:**

- `content: string` - The markdown content to save
- `fileName: string` - Name for the output file (without .md extension)
- `outputDir?: string` - Directory to save the file (defaults to "output")

**Returns:** `Promise<string>` - Path to the saved file

**Example:**

```typescript
const filePath = await saveToMarkdownFile(markdown, "document", "./output");
console.log(`Saved to: ${filePath}`);
```

## 📚 Documentation

For comprehensive documentation, please visit our [documentation site](https://docs.cognipeer.com/to-markdown/).

- [Getting Started Guide](https://docs.cognipeer.com/to-markdown/getting-started)
- [API Documentation](https://docs.cognipeer.com/to-markdown/api/overview)
- [Format Support](https://docs.cognipeer.com/to-markdown/guides/formats)
- [Error Handling](https://docs.cognipeer.com/to-markdown/guides/error-handling)

## 💡 Examples

Check out the [`examples/`](./examples) directory for more usage examples:

- [Basic Usage](./examples/basic-usage.ts) - File path, buffer, and base64 conversions
- [Spreadsheet Conversion](./examples/spreadsheet-conversion.ts) - Excel and CSV to Markdown tables
- [Advanced Usage](./examples/advanced-usage.ts) - Jupyter notebooks and complex HTML

### Running Examples

```bash
# Using tsx (recommended for development)
npx tsx examples/basic-usage.ts

# Or build and run
npm run build
node dist/examples/basic-usage.js
```

## 🏗️ Project Structure

```
to-markdown/
├── src/
│   ├── converters/      # Format-specific converters
│   │   ├── pdf.ts
│   │   ├── docx.ts
│   │   ├── html.ts
│   │   └── ...
│   ├── types/           # TypeScript type definitions
│   │   └── index.ts
│   ├── utils/           # Utility functions
│   │   ├── markdown.ts
│   │   └── fileDetection.ts
│   └── index.ts         # Main entry point
├── examples/            # Usage examples
├── docs/                # GitHub Pages documentation
├── dist/                # Compiled output
└── package.json
```

- **Web content**: Special handling for YouTube videos and Bing search results

## Examples

### Convert PDF to Markdown

```javascript
import { convertToMarkdown } from "@cognipeer/to-markdown";
import fs from "fs";

const pdfBuffer = fs.readFileSync("document.pdf");
const markdown = await convertToMarkdown(pdfBuffer, {
  fileName: "document.pdf",
});

console.log(markdown);
```

### Convert DOCX to Markdown

```javascript
import { convertToMarkdown } from "@cognipeer/to-markdown";

const markdown = await convertToMarkdown("/path/to/document.docx");
console.log(markdown);
```

### Convert HTML to Markdown

```javascript
import { convertToMarkdown, saveToMarkdownFile } from "@cognipeer/to-markdown";
import fs from "fs";

const htmlContent = fs.readFileSync("page.html", "utf-8");
const markdown = await convertToMarkdown(htmlContent, {
  forceExtension: ".html",
});
console.log(markdown);
```

### Convert and Save to File

```javascript
import { convertToMarkdown, saveToMarkdownFile } from "@cognipeer/to-markdown";

const markdown = await convertToMarkdown("/path/to/document.pdf");
const savedPath = await saveToMarkdownFile(
  markdown,
  "converted-document",
  "./output",
);
console.log(`Saved to: ${savedPath}`);
```

## License

MIT
