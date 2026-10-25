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
- 🔎 **OCR Support**: Extract text from scanned PDFs and images
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
  - `doc?: DocOptions` - Options for binary Word `.doc` conversion

`OCROptions` includes:

- `provider?: 'tesseract' | 'openai-vlm' | 'anthropic-vlm' | 'ollama-vlm' | 'azure-vision' | 'custom-vlm' | 'handler'`
- `lang?: string` - Tesseract language code (default: `eng`)
- `pdfMode?: 'auto' | 'always' | 'never'` - PDF OCR mode (default: `auto`)
- `vlm?: { model: string; apiKey?: string; apiBase?: string; prompt?: string; maxTokens?: number }`
- `handler?: (buffer, context) => Promise<string>` - Custom async OCR callback (required when `provider: 'handler'`; library makes no HTTP calls)

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
