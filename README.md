# @cognipeer/to-markdown

A versatile utility library for converting various file formats to Markdown.

## Installation

```bash
npm install @cognipeer/to-markdown
```

## Features

This library supports converting the following file formats to Markdown:

- PDF documents
- Word documents (.docx)
- HTML content
- Excel spreadsheets (.xlsx)
- CSV data
- ZIP archives
- XML files
- Images
- Audio metadata

## Usage

```javascript
import { convertToMarkdown } from "@cognipeer/to-markdown";

// Convert from buffer
const buffer = fs.readFileSync("document.pdf");
const result = await convertToMarkdown(buffer, {
  filename: "document.pdf",
  mimeType: "application/pdf",
});
console.log(result.markdown);

// Convert from file path
const result = await convertToMarkdown("/path/to/document.docx");
console.log(result.markdown);
```

## API

### convertToMarkdown(input, options)

Converts the input to Markdown.

**Parameters:**

- `input`: Buffer or string (file path)
- `options`: Object (optional)
  - `filename`: String - Name of the file (required when input is a buffer)
  - `mimeType`: String - MIME type of the file (optional, will be detected if not provided)

**Returns:**

- Promise that resolves to an object:
  - `markdown`: String - The converted markdown content
  - `metadata`: Object - Additional metadata extracted from the file (if available)

## Supported File Types

- **PDF**: Converts PDF documents to Markdown
- **Word (.docx)**: Converts Microsoft Word documents to Markdown
- **HTML**: Converts HTML content to Markdown
- **Excel (.xlsx)**: Converts Excel spreadsheets to Markdown tables
- **CSV**: Converts CSV data to Markdown tables
- **ZIP**: Extracts contents and converts applicable files to Markdown
- **XML**: Converts XML to Markdown
- **Images**: Embeds images or provides links in Markdown format
- **Audio**: Extracts metadata from audio files in Markdown format

## Examples

### Convert PDF to Markdown

```javascript
import { convertToMarkdown } from "@cognipeer/to-markdown";
import fs from "fs";

const pdfBuffer = fs.readFileSync("document.pdf");
const result = await convertToMarkdown(pdfBuffer, {
  filename: "document.pdf",
});

console.log(result.markdown);
```

### Convert DOCX to Markdown

```javascript
import { convertToMarkdown } from "@cognipeer/to-markdown";

const result = await convertToMarkdown("/path/to/document.docx");
console.log(result.markdown);
```

## License

MIT
