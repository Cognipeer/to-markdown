---
layout: default
title: Type Definitions
parent: API Overview
nav_order: 2
---

# Type Definitions

Complete TypeScript type definitions for `@cognipeer/to-markdown`.

## Core Types

### ConverterInput

Input type for the converter function.

```typescript
type ConverterInput = string | Buffer;
```

Can be:
- **string**: File path, base64 data, or data URL
- **Buffer**: File content as Node.js Buffer

---

### ConverterOptions

Configuration options for file conversion.

```typescript
interface ConverterOptions {
  fileName?: string;
  forceExtension?: string;
  url?: string;
  ocr?: boolean | OCROptions;
  doc?: DocOptions;
  images?: 'inline' | 'placeholder' | 'omit';
  imageMetadata?: boolean;
}
```

See [Converter Options]({{ site.baseurl }}{% link api/options.md %}) for detailed documentation.

---

## Enums

### FileExtension

Enumeration of supported file extensions.

```typescript
enum FileExtension {
  PDF = '.pdf',
  DOC = '.doc',
  DOCX = '.docx',
  HTML = '.html',
  HTM = '.htm',
  TXT = '.txt',
  IPYNB = '.ipynb',
  XML = '.xml',
  RSS = '.rss',
  ATOM = '.atom',
  XLSX = '.xlsx',
  XLS = '.xls',
  CSV = '.csv',
  MP3 = '.mp3',
  WAV = '.wav',
  PPTX = '.pptx',
  ZIP = '.zip',
  JPG = '.jpg',
  JPEG = '.jpeg',
  PNG = '.png',
  GIF = '.gif',
  // ... JSON, YAML, YML, EPUB, MSG
  TIF = '.tif',     // 3.6.0
  TIFF = '.tiff',   // 3.6.0
  WEBP = '.webp',   // 3.6.0
  BMP = '.bmp',     // 3.6.0
}
```

---

### DocOptions

Configuration for binary Word 97-2003 DOC conversion.

```typescript
interface DocOptions {
  includeHeaders?: boolean;
  includeFootnotes?: boolean;
  maxInputBytes?: number;
  maxOutputChars?: number;
}
```

- `includeHeaders` defaults to `true`.
- `includeFootnotes` defaults to `true`.
- `maxInputBytes` defaults to 25 MiB and cannot exceed 50 MiB.
- `maxOutputChars` defaults to 2,000,000 and cannot exceed 4,000,000.

### DOC Conversion Errors

```typescript
type DocErrorCode =
  | 'DOC_INVALID'
  | 'DOC_ENCRYPTED'
  | 'DOC_LIMIT_EXCEEDED'
  | 'DOC_UNSUPPORTED';

class DocConversionError extends Error {
  readonly code: DocErrorCode;
}
```

Both `DocConversionError` and `DocErrorCode` are exported from the package root.

---

## Metadata Types

### ImageMetadata

Metadata extracted from image files.

```typescript
interface ImageMetadata {
  width?: number;
  height?: number;
  format?: string;
  size?: number;
}
```

---

### AudioMetadata

Metadata extracted from audio files.

```typescript
interface AudioMetadata {
  title?: string;
  artist?: string;
  album?: string;
  duration?: number;
  bitrate?: number;
}
```

---

## OCR Types

### OCRProvider

```typescript
type OCRProvider =
  | 'tesseract'
  | 'openai-vlm'
  | 'anthropic-vlm'
  | 'ollama-vlm'
  | 'azure-vision'
  | 'custom-vlm'
  | 'handler';
```

Use `'handler'` when you supply your own async OCR function. The library does not perform HTTP requests in that mode.

---

### OCRHandlerContext

Metadata passed to a custom OCR handler. All fields are optional.

```typescript
interface OCRHandlerContext {
  page?: number;              // 1-based PDF page or TIFF frame
  pageCount?: number;
  mimeType?: string;
  sourceExtension?: string;
  fileName?: string;
  imageWidth?: number;
  imageHeight?: number;
  kind?: OCRImageKind;        // 'pdf-page' | 'image' | 'tiff-page' | 'embedded-image'
  index?: number;             // 0-based index of an embedded image
  sourcePath?: string;        // e.g. 'word/media/image1.png'
  slide?: number;             // PPTX slide number
  langHint?: string[];        // ISO 639-1 codes, e.g. ['tr', 'en']
  signal?: AbortSignal;       // aborted on cancel or task timeout
}
```

---

### OCRHandler

```typescript
type OCRHandler = (
  buffer: Buffer,
  context: OCRHandlerContext
) => Promise<string | OCRHandlerResult>;
```

A handler that returns a string keeps working unchanged.

### OCRHandlerResult

```typescript
interface OCRHandlerResult {
  text: string;
  markdown?: string;      // preferred over `text` when present
  confidence?: number;
}
```

### OCRDocumentHandler

OCR the whole PDF in one call. `pages` lists the 1-based pages that need OCR.

```typescript
interface OCRDocumentHandlerContext {
  pages: number[];
  pageCount: number;
  fileName?: string;
  langHint?: string[];
  signal?: AbortSignal;
}

type OCRDocumentHandler = (
  pdf: Buffer,
  context: OCRDocumentHandlerContext
) => Promise<Array<{ page: number; text: string; markdown?: string }>>;
```

---

### OCROptions

```typescript
interface OCROptions {
  provider?: OCRProvider;
  lang?: string | string[];
  pdfMode?: OCRPdfMode;
  vlm?: VLMOptions;
  handler?: OCRHandler;
  // added in 3.6.0
  pageTrigger?: OCRPageTrigger;
  render?: OCRRenderOptions;
  maxPages?: number;
  concurrency?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  onProgress?: (event: OCRProgressEvent) => void;
  onError?: 'comment' | 'skip' | 'throw';
  documentHandler?: OCRDocumentHandler;
  tesseract?: TesseractOptions;
  embeddedImages?: boolean | EmbeddedImageOCROptions;
  autoRotate?: boolean;
}
```

When `provider` is `'handler'`, `handler` (or `documentHandler` for PDFs) is required. See
[Converter Options]({{ site.baseurl }}{% link api/options.md %}) for the defaults of every field.

### OCRPdfMode

```typescript
type OCRPdfMode = 'auto' | 'auto-page' | 'always' | 'never';
```

### OCRPageTrigger

```typescript
interface OCRPageTrigger {
  minChars?: number;         // default 32
  maxGarbledRatio?: number;  // default 0.3 (0 disables)
  requireImage?: boolean;    // default true
}
```

### OCRRenderOptions

```typescript
interface OCRRenderOptions {
  scale?: number;         // default 2
  maxPixels?: number;     // default 40_000_000
  format?: 'png' | 'jpeg';// default 'png'
  jpegQuality?: number;   // default 85
  grayscale?: boolean;    // default false
}
```

### VLMOptions

```typescript
interface VLMOptions {
  model: string;
  apiKey?: string;
  apiBase?: string;
  prompt?: string;
  maxTokens?: number;
  retries?: number;     // 3.6.0, default 2
  timeoutMs?: number;   // 3.6.0
}
```

### TesseractOptions

```typescript
interface TesseractOptions {
  langPath?: string;   // directory or URL with <lang>.traineddata[.gz]
  cachePath?: string;
  offline?: boolean;   // requires langPath; never downloads
  psm?: number;
  oem?: number;
  gzip?: boolean;      // default true
}
```

### EmbeddedImageOCROptions

```typescript
interface EmbeddedImageOCROptions {
  minWidth?: number;   // default 64
  minHeight?: number;  // default 64
  maxImages?: number;  // default 50
  dedupe?: boolean;    // default true
}
```

### OCRImageKind and OCRProgressEvent

```typescript
type OCRImageKind = 'pdf-page' | 'image' | 'tiff-page' | 'embedded-image';

interface OCRProgressEvent {
  kind: OCRImageKind;
  completed: number;
  total: number;
  page?: number;
}
```

---

## Detailed Conversion Types

### DetailedConversion

Returned by `convertToMarkdownDetailed(input, options?)`. `markdown` is identical to what
`convertToMarkdown` returns for the same input and options.

```typescript
interface DetailedConversion {
  markdown: string;
  extension: string;
  pages?: PageReport[];
  images?: ImageReport[];
  warnings: string[];   // "code: detail", e.g. 'ocr_page_failed: page 3: ...'
  stats: {
    pageCount?: number;
    ocrCalls: number;
    ocrPages: number;
    ocrImages: number;
    ocrMs: number;
    renderMs: number;
  };
}

interface PageReport {
  page: number;
  source: 'text' | 'ocr' | 'empty' | 'error' | 'skipped';
  chars: number;
  reason?: 'no-text' | 'low-text' | 'garbled' | 'always' | 'auto';
  error?: string;
  ms?: number;
}

interface ImageReport {
  index: number;
  kind: OCRImageKind;
  path?: string;
  width?: number;
  height?: number;
  ocr: boolean;
  chars?: number;
  skipped?: 'small' | 'duplicate' | 'limit';
  error?: string;
}
```

Warning codes: `ocr_page_failed`, `ocr_page_limit`, `ocr_image_failed`, `ocr_image_limit`,
`ocr_timeout`, `tesseract_lang_missing`.

### toTesseractLang

```typescript
function toTesseractLang(lang?: string | string[]): string | undefined;
// toTesseractLang('tr+en') === 'tur+eng'; unknown codes pass through
```

---

## Internal Types

### TurndownOptions

Options for HTML to Markdown conversion using Turndown.

```typescript
interface TurndownOptions {
  headingStyle: 'setext' | 'atx';
  hr: string;
  bulletListMarker: string;
  codeBlockStyle: 'indented' | 'fenced';
  emDelimiter: string;
  keepHeaderLevels?: boolean;
}
```

---

### FileTypeResult

Result of file type detection.

```typescript
interface FileTypeResult {
  ext: string;
  mime: string;
}
```

---

## Usage Examples

### Using Types in Your Code

```typescript
import { 
  convertToMarkdown,
  type ConverterInput,
  type ConverterOptions,
  FileExtension
} from '@cognipeer/to-markdown';

// Type-safe input
const input: ConverterInput = './document.pdf';

// Type-safe options
const options: ConverterOptions = {
  forceExtension: FileExtension.PDF
};

// Type-safe conversion
const markdown: string = await convertToMarkdown(input, options);
```

### Type Guards

Check input types:

```typescript
function isBufferInput(input: ConverterInput): input is Buffer {
  return Buffer.isBuffer(input);
}

if (isBufferInput(input)) {
  // input is Buffer
  console.log('Processing buffer of size:', input.length);
} else {
  // input is string
  console.log('Processing file:', input);
}
```

### Generic Functions

Create type-safe wrapper functions:

```typescript
async function convertFile<T extends ConverterInput>(
  input: T,
  options?: ConverterOptions
): Promise<string> {
  return await convertToMarkdown(input, options);
}
```

## Importing Types

Import only the types you need:

```typescript
// Import type only (doesn't include in runtime bundle)
import type { ConverterOptions } from '@cognipeer/to-markdown';

// Import enum (includes in runtime)
import { FileExtension } from '@cognipeer/to-markdown';

// Import everything
import { convertToMarkdown, type ConverterOptions, FileExtension } from '@cognipeer/to-markdown';
```

## See Also

- [API Overview]({{ site.baseurl }}{% link api/overview.md %})
- [Converter Options]({{ site.baseurl }}{% link api/options.md %})
