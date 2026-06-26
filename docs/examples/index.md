---
layout: default
title: Examples
nav_order: 5
description: "Code examples for @cognipeer/to-markdown"
---

# Examples
{: .no_toc }

## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Basic Usage

### Converting from a File Path

The simplest way to convert a file is to provide its path:

```typescript
import { convertToMarkdown } from '@cognipeer/to-markdown';

const markdown = await convertToMarkdown('./path/to/document.pdf');
console.log(markdown);
```

### Converting from a Buffer

```typescript
import { convertToMarkdown } from '@cognipeer/to-markdown';
import { readFileSync } from 'fs';

const buffer = readFileSync('./document.docx');
const markdown = await convertToMarkdown(buffer, {
  fileName: 'document.docx'
});
console.log(markdown);
```

### Converting from Base64

```typescript
import { convertToMarkdown } from '@cognipeer/to-markdown';

// With data URL
const base64 = 'data:application/pdf;base64,JVBERi0xLjU...';
const markdown = await convertToMarkdown(base64);

// Or plain base64 with a hint for format detection
const plainBase64 = 'JVBERi0xLjU...';
const markdown2 = await convertToMarkdown(plainBase64, {
  fileName: 'document.pdf'
});
```

## Spreadsheet Conversion

### Excel to Markdown Table

```typescript
import { convertToMarkdown } from '@cognipeer/to-markdown';

const markdown = await convertToMarkdown('./data.xlsx');
console.log(markdown);
// Output: Markdown table with rows and columns
```

### CSV to Markdown Table

```typescript
import { convertToMarkdown } from '@cognipeer/to-markdown';

const markdown = await convertToMarkdown('./data.csv');
console.log(markdown);
```

## Advanced Usage

### Saving Output to a File

```typescript
import { convertToMarkdown, saveToMarkdownFile } from '@cognipeer/to-markdown';

const markdown = await convertToMarkdown('./document.pdf');
const outputPath = await saveToMarkdownFile(
  markdown,
  'converted-document', // filename without extension
  './output'            // output directory
);

console.log(`Saved to: ${outputPath}`);
```

### Jupyter Notebook Conversion

```typescript
import { convertToMarkdown } from '@cognipeer/to-markdown';

const markdown = await convertToMarkdown('./notebook.ipynb');
console.log(markdown);
```

### Error Handling

```typescript
import { convertToMarkdown } from '@cognipeer/to-markdown';

try {
  const markdown = await convertToMarkdown('./document.pdf');
  console.log(markdown);
} catch (error) {
  console.error('Conversion failed:', error.message);
}
```

## Source Files

The full example source files are available in the
[`examples/`](https://github.com/Cognipeer/to-markdown/tree/main/examples)
directory of the repository.
