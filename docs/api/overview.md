---
layout: default
title: API Overview
nav_order: 3
has_children: true
permalink: /api/overview
---

# API Overview

The `@cognipeer/to-markdown` library provides a simple yet powerful API for converting various file formats to Markdown.

## Core Functions

### convertToMarkdown

Main function for converting files to Markdown format.

```typescript
function convertToMarkdown(
  input: ConverterInput,
  options?: ConverterOptions
): Promise<string>
```

**Parameters:**
- `input`: File path (string), base64 data (string), or Buffer
- `options`: Optional configuration object

**Returns:** Promise that resolves to Markdown string

**Example:**
```typescript
const markdown = await convertToMarkdown('./document.pdf');
```

---

### saveToMarkdownFile

Saves converted Markdown content to a file.

```typescript
function saveToMarkdownFile(
  content: string,
  fileName: string,
  outputDir?: string
): Promise<string>
```

**Parameters:**
- `content`: The Markdown content to save
- `fileName`: Name for the output file (without .md extension)
- `outputDir`: Directory to save the file (default: "output")

**Returns:** Promise that resolves to the file path

**Example:**
```typescript
await saveToMarkdownFile(markdown, 'document', './output');
```

## Type Definitions

### ConverterInput

Union type for input formats:

```typescript
type ConverterInput = string | Buffer;
```

### ConverterOptions

Configuration options for conversion:

```typescript
interface ConverterOptions {
  fileName?: string;        // File name for buffer inputs
  forceExtension?: string;  // Force specific file extension
  url?: string;            // Original URL (for web content)
  doc?: DocOptions;        // Binary Word DOC conversion options
}
```

### FileExtension

Enum of supported file extensions:

```typescript
enum FileExtension {
  PDF = '.pdf',
  DOC = '.doc',
  DOCX = '.docx',
  HTML = '.html',
  // ... and more
}
```

## See Also

- [Converter Options]({{ site.baseurl }}{% link api/options.md %})
- [Type Definitions]({{ site.baseurl }}{% link api/types.md %})
- [Error Handling]({{ site.baseurl }}{% link guides/error-handling.md %})
