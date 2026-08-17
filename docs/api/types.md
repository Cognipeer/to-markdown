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
}
```

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

Metadata passed to a custom OCR handler.

```typescript
interface OCRHandlerContext {
  page?: number;
  pageCount?: number;
  mimeType?: string;
  sourceExtension?: string;
  fileName?: string;
  imageWidth?: number;
  imageHeight?: number;
}
```

---

### OCRHandler

```typescript
type OCRHandler = (
  buffer: Buffer,
  context: OCRHandlerContext
) => Promise<string>;
```

---

### OCROptions

```typescript
interface OCROptions {
  provider?: OCRProvider;
  lang?: string;
  pdfMode?: 'auto' | 'always' | 'never';
  vlm?: VLMOptions;
  handler?: OCRHandler;
}
```

When `provider` is `'handler'`, `handler` is required.

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
