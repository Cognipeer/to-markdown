---
layout: default
title: Home
nav_order: 1
description: "A versatile utility library for converting various file formats to Markdown"
permalink: /
---

# @cognipeer/to-markdown

{: .fs-9 }

A versatile utility library for converting various file formats to Markdown.
{: .fs-6 .fw-300 }

[Get started now](#getting-started){: .btn .btn-primary .fs-5 .mb-4 .mb-md-0 .mr-2 }
[View it on GitHub](https://github.com/Cognipeer/to-markdown){: .btn .fs-5 .mb-4 .mb-md-0 }

---

## Features

- 🎯 **Multiple Format Support**: Convert PDF, DOC, DOCX, HTML, Excel, CSV, and more
- 📦 **Simple API**: Easy to use with Promise-based interface
- 🔧 **TypeScript**: Full TypeScript support with type definitions
- 🚀 **Fast & Efficient**: Optimized for performance
- 🎨 **Customizable**: Options to control conversion behavior

## Supported Formats

| Format | Extensions | Description |
|--------|-----------|-------------|
| PDF | `.pdf` | PDF documents |
| Word | `.doc` | Word 97-2003 documents with text, lists, headers, and footnotes |
| Word | `.docx` | Microsoft Word documents |
| HTML | `.html`, `.htm` | HTML web pages |
| Excel | `.xlsx`, `.xls` | Excel spreadsheets |
| CSV | `.csv` | Comma-separated values |
| Jupyter | `.ipynb` | Jupyter notebooks |
| PowerPoint | `.pptx` | PowerPoint presentations |
| XML/RSS | `.xml`, `.rss`, `.atom` | XML and feed formats |
| Images | `.jpg`, `.png`, `.gif` | Image files (metadata extraction) |
| Audio | `.mp3`, `.wav` | Audio files (metadata extraction) |
| Text | `.txt` | Plain text files |
| Archives | `.zip` | ZIP archives |

## Quick Example

```typescript
import { convertToMarkdown } from '@cognipeer/to-markdown';

// Convert a PDF file
const markdown = await convertToMarkdown('./document.pdf');
console.log(markdown);
```

## Getting Started

Ready to get started? Check out our [Installation Guide]({{ site.baseurl }}{% link getting-started.md %}) and [API Documentation]({{ site.baseurl }}{% link api/overview.md %}).

---

## About

This project is maintained by [Cognipeer](https://github.com/Cognipeer) and released under the MIT License.
