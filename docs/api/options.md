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
- **Description:** Enable OCR for images and scanned PDFs. Use `provider: 'handler'` with a custom `handler(buffer, context)` callback when you want full control over OCR (the library performs no HTTP requests in that mode).

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

See [Type Definitions]({{ site.baseurl }}{% link api/types.md %}) for `OCROptions`, `OCRHandler`, and `OCRHandlerContext`.

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
