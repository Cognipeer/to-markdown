---
layout: default
title: Getting Started
nav_order: 2
description: "Installation and basic setup for @cognipeer/to-markdown"
---

# Getting Started
{: .no_toc }

## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Installation

Install the package using npm:

```bash
npm install @cognipeer/to-markdown
```

Or using yarn:

```bash
yarn add @cognipeer/to-markdown
```

Or using pnpm:

```bash
pnpm add @cognipeer/to-markdown
```

## Basic Usage

### Converting from File Path

The simplest way to convert a file is to provide its path:

```typescript
import { convertToMarkdown } from '@cognipeer/to-markdown';

const markdown = await convertToMarkdown('./path/to/document.pdf');
console.log(markdown);
```

### Converting from Buffer

You can also convert files that are already loaded as buffers:

```typescript
import { convertToMarkdown } from '@cognipeer/to-markdown';
import { readFileSync } from 'fs';

const buffer = readFileSync('./document.docx');
const markdown = await convertToMarkdown(buffer, {
  fileName: 'document.docx' // Optional but recommended
});
console.log(markdown);
```

### Converting from Base64

Convert base64-encoded data directly:

```typescript
import { convertToMarkdown } from '@cognipeer/to-markdown';

// With data URL
const base64 = 'data:application/pdf;base64,JVBERi0xLjU...';
const markdown = await convertToMarkdown(base64);

// Or plain base64
const plainBase64 = 'JVBERi0xLjU...';
const markdown2 = await convertToMarkdown(plainBase64, {
  fileName: 'document.pdf' // Helps with format detection
});
```

### Converting a Legacy Word DOC

```typescript
const docBuffer = readFileSync('./policy.doc');
const markdown = await convertToMarkdown(docBuffer, {
  fileName: 'policy.doc',
  doc: {
    includeFootnotes: false,
  },
});
```

Binary Word `.doc` conversion includes non-empty headers and footnotes by
default. Use `includeHeaders: false` or `includeFootnotes: false` only when a
caller intentionally needs to omit those stories.

## Saving Output

Use the `saveToMarkdownFile` function to save converted markdown to a file:

```typescript
import { convertToMarkdown, saveToMarkdownFile } from '@cognipeer/to-markdown';

const markdown = await convertToMarkdown('./document.pdf');
const outputPath = await saveToMarkdownFile(
  markdown,
  'converted-document', // filename without extension
  './output' // output directory
);

console.log(`Saved to: ${outputPath}`);
```

## TypeScript Support

The library is written in TypeScript and provides full type definitions:

```typescript
import { 
  convertToMarkdown, 
  saveToMarkdownFile,
  type ConverterOptions,
  type ConverterInput 
} from '@cognipeer/to-markdown';

const options: ConverterOptions = {
  fileName: 'document.pdf',
  forceExtension: '.pdf'
};

const input: ConverterInput = buffer; // or string
const result = await convertToMarkdown(input, options);
```

## Next Steps

- Learn about [converter options]({{ site.baseurl }}{% link api/options.md %})
- Explore [format-specific conversions]({{ site.baseurl }}{% link guides/formats.md %})
- Check out [examples]({{ site.baseurl }}{% link examples/index.md %})
