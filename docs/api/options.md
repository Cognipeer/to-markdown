---
layout: default
title: Converter Options
parent: API Overview
nav_order: 1
---

# Converter Options

The `ConverterOptions` interface provides configuration options to customize the conversion behavior.

## Interface Definition

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

## Options

### fileName

- **Type:** `string` (optional)
- **Description:** Specifies the file name, which is particularly useful when converting from Buffer or base64 data. Helps with automatic format detection.

**Example:**
```typescript
const buffer = readFileSync('./document.pdf');
const markdown = await convertToMarkdown(buffer, {
  fileName: 'document.pdf'
});
```

---

### forceExtension

- **Type:** `string` (optional)
- **Description:** Forces the converter to treat the input as a specific file type, bypassing automatic detection.

**Example:**
```typescript
// Force treat as PDF even if detection fails
const markdown = await convertToMarkdown(buffer, {
  forceExtension: '.pdf'
});
```

**Supported Extensions:**
- `.pdf` - PDF documents
- `.doc` - Binary Word 97-2003 documents
- `.docx` - Word documents
- `.html`, `.htm` - HTML files
- `.xlsx`, `.xls` - Excel spreadsheets
- `.csv` - CSV files
- `.ipynb` - Jupyter notebooks
- `.pptx` - PowerPoint presentations
- `.xml`, `.rss`, `.atom` - XML/Feed formats
- `.txt` - Text files
- `.zip` - ZIP archives
- `.jpg`, `.jpeg`, `.png`, `.gif` - Images
- `.mp3`, `.wav` - Audio files

---

### url

- **Type:** `string` (optional)
- **Description:** Original URL of the content, used for special handling of web content like YouTube videos or Bing search results.

**Example:**
```typescript
// Convert YouTube page
const markdown = await convertToMarkdown(htmlBuffer, {
  url: 'https://www.youtube.com/watch?v=...'
});

// Convert Bing search results
const markdown = await convertToMarkdown(htmlBuffer, {
  url: 'https://www.bing.com/search?q=...'
});
```

---

### ocr

- **Type:** `boolean | OCROptions` (optional)
- **Description:** Enable OCR for images, scanned PDFs, multi-page TIFF and (with `embeddedImages`) images inside DOCX/PPTX/HTML. `true` uses Tesseract with defaults. Use `provider: 'handler'` with a custom `handler(buffer, context)` callback when you want full control over OCR (the library performs no HTTP requests in that mode).

**Example:**
```typescript
const markdown = await convertToMarkdown("scan.pdf", {
  ocr: {
    provider: "handler",
    pdfMode: "auto",
    handler: async (buffer, context) => myOcr(buffer, context),
  },
});
```

#### OCROptions fields

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `provider` | `OCRProvider` | `'tesseract'` | OCR engine: Tesseract, a VLM provider or your own `handler`. |
| `lang` | `string \| string[]` | `'eng'` | Tesseract codes (`'tur+eng'`) or ISO 639-1 codes (`'tr+en'`, `['tr','en']`). ISO codes are mapped for Tesseract and passed to handlers as `langHint`. |
| `pdfMode` | `'auto' \| 'auto-page' \| 'always' \| 'never'` | `'auto'` | `auto`: OCR the whole PDF only when it has no text. `auto-page`: OCR only pages whose text layer is missing, garbled or too short. `always`: OCR every page and replace the text. `never`: no PDF OCR. |
| `pageTrigger` | `{ minChars?, maxGarbledRatio?, requireImage? }` | `32`, `0.3`, `true` | Candidate rules for `auto-page`. A page with fewer than `minChars` non-whitespace characters needs a raster image (unless `requireImage: false`); `maxGarbledRatio: 0` disables the garbled check. |
| `render` | `{ scale?, maxPixels?, format?, jpegQuality?, grayscale? }` | `2`, `40_000_000`, `'png'`, `85`, `false` | How PDF pages are rasterised. `scale` is reduced when the page would exceed `maxPixels`. |
| `maxPages` | `number` | none | OCR at most this many pages (`auto-page`: candidate pages; other modes: the first N pages). Skipped candidates are reported with an `ocr_page_limit` warning. |
| `concurrency` | `number` | `1` | Parallel OCR tasks. Results keep document order. Tesseract uses up to 4 workers. |
| `timeoutMs` | `number` | none | Timeout of one OCR task. A timed-out task is handled like a failure and adds an `ocr_timeout` warning. |
| `signal` | `AbortSignal` | none | Cancels the conversion; the promise rejects with the signal's reason (`AbortError`). Never swallowed by `onError`. |
| `onProgress` | `(event: OCRProgressEvent) => void` | none | Called after every finished OCR task. |
| `onError` | `'comment' \| 'skip' \| 'throw'` | per format | `comment` (image files: `<!-- OCR failed: msg -->`), `skip` (`auto-page` PDFs and embedded images; recorded in the report), `throw`. |
| `handler` | `OCRHandler` | none | Required when `provider: 'handler'`. May return a string or `{ text, markdown?, confidence? }`. |
| `documentHandler` | `OCRDocumentHandler` | none | OCR the whole PDF in one call instead of one rendered image per page. |
| `vlm` | `VLMOptions` | none | Required for VLM providers. New: `retries` (2) and `timeoutMs`. |
| `tesseract` | `TesseractOptions` | none | `langPath`, `cachePath`, `offline`, `psm`, `oem`, `gzip` (default `true`). `offline: true` requires `langPath` and never downloads or caches language data. |
| `embeddedImages` | `boolean \| EmbeddedImageOCROptions` | off | OCR images embedded in DOCX/PPTX/HTML. Defaults: `minWidth` 64, `minHeight` 64, `maxImages` 50, `dedupe` true. |
| `autoRotate` | `boolean` | `true` | Rotate image files with an EXIF orientation before OCR. |

All of these fields are optional and additive: `ocr: true` and `OCROptions` that only use the 3.5.0 fields give the same output as 3.5.0.

**Per-page OCR example:**
```typescript
const markdown = await convertToMarkdown("mixed.pdf", {
  ocr: {
    lang: "tr+en",
    pdfMode: "auto-page",
    concurrency: 2,
    timeoutMs: 60_000,
    tesseract: { offline: true, langPath: "/opt/tessdata" },
  },
});
```

See [Type Definitions]({{ site.baseurl }}{% link api/types.md %}) for `OCROptions`, `OCRHandler`, `OCRHandlerResult`, `OCRHandlerContext` and the other OCR types, and `convertToMarkdownDetailed()` for page and image reports.

---

### images

- **Type:** `'inline' | 'placeholder' | 'omit'` (optional, default `'inline'`)
- **Description:** How images embedded in DOCX, HTML, EPUB and PPTX are rendered. `inline` keeps the 3.5.0 output (DOCX/HTML data URIs, no images for PPTX). `placeholder` writes `![alt](image-<n>.<ext>)` (PPTX: the media file name) without the image data. `omit` removes the images. OCR text of embedded images (`ocr.embeddedImages`) is added as a blockquote after the image in every mode.

**Example:**
```typescript
const markdown = await convertToMarkdown("report.docx", { images: "placeholder" });
```

---

### imageMetadata

- **Type:** `boolean` (optional, default `true`)
- **Description:** For image files (PNG, JPEG, GIF, TIFF, WEBP, BMP), emit the `ImageSize: WxH Format: ...` header (multi-page TIFF also gets `Pages: N`). Set `false` to output only the OCR text.

---

### doc

- **Type:** `DocOptions` (optional)
- **Description:** Configures binary Word 97-2003 (`.doc`) conversion.

The default output contains body text plus non-empty headers and footnotes. For
Buffer or plain-base64 DOC input, set `fileName` or `forceExtension: '.doc'` so
the converter can distinguish the shared Compound File container from other
legacy Office formats.

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `includeHeaders` | `boolean` | `true` | Include non-empty headers under `## Document headers`. |
| `includeFootnotes` | `boolean` | `true` | Include non-empty footnotes under `## Footnotes`. |
| `maxInputBytes` | `number` | 25 MiB | DOC byte limit; maximum 50 MiB. Applies before configured base64 DOC input is decoded. |
| `maxOutputChars` | `number` | 2,000,000 | Markdown character limit; maximum 4,000,000. |

```typescript
const markdown = await convertToMarkdown(docBase64, {
  fileName: 'policy.doc',
  doc: {
    includeFootnotes: false,
    maxInputBytes: 10 * 1024 * 1024,
  },
});
```

See [Error Handling]({{ site.baseurl }}{% link guides/error-handling.md %}) for
controlled DOC conversion errors.

## Usage Examples

### Combining Options

You can combine multiple options:

```typescript
const markdown = await convertToMarkdown(buffer, {
  fileName: 'document.pdf',
  forceExtension: '.pdf',
});
```

### Buffer with Format Detection

When working with buffers without extension information:

```typescript
const buffer = getSomeBuffer();
const markdown = await convertToMarkdown(buffer, {
  fileName: 'unknown-file.pdf'  // Helps detect it's a PDF
});
```

### Web Content Conversion

For web-scraped content:

```typescript
const htmlContent = await fetchWebPage(url);
const markdown = await convertToMarkdown(htmlContent, {
  url: url  // Enables special handling for known sites
});
```

## Default Behavior

When no options are provided:
- File type is auto-detected from file path extension or buffer content
- If detection fails, content is treated as plain text
- No special URL-based processing is applied

## See Also

- [API Overview]({{ site.baseurl }}{% link api/overview.md %})
- [Type Definitions]({{ site.baseurl }}{% link api/types.md %})
