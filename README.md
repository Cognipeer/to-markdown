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
- Excel spreadsheets (.xlsx, .xls)
- CSV data
- Jupyter notebooks (.ipynb)
- PowerPoint presentations (.pptx)
- XML files and RSS/ATOM feeds
- Plain text files

## Usage

```javascript
import { convertToMarkdown, saveToMarkdownFile } from "@cognipeer/to-markdown";

// Convert from file path
const result = await convertToMarkdown("/path/to/document.docx");
console.log(result);

// Convert from buffer
const buffer = fs.readFileSync("document.pdf");
const result = await convertToMarkdown(buffer, {
  fileName: "document.pdf",
});
console.log(result);

// Convert from base64 string
const base64Content = "data:application/pdf;base64,JVBERi0xLjUNCiW...";
const result = await convertToMarkdown(base64Content);
console.log(result);

// Save converted markdown to a file
await saveToMarkdownFile(result, "converted-document", "./output");
```

## API

### convertToMarkdown(input, options)

Converts the input to Markdown.

**Parameters:**

- `input`:
  - String (file path)
  - String (base64 data)
  - Buffer (file content)
- `options`: Object (optional)
  - `fileName`: String - Name of the file (helpful for buffer inputs)
  - `forceExtension`: String - Force a specific file extension for processing
  - `url`: String - Original URL (used for web content like YouTube or Bing search)

**Returns:**

- The converted markdown content as a string

### saveToMarkdownFile(content, fileName, outputDir)

Saves the markdown content to a file.

**Parameters:**

- `content`: String - The markdown content to save
- `fileName`: String - Name for the output file
- `outputDir`: String - Directory to save the file (defaults to "output")

**Returns:**

- Promise that resolves to the path of the saved file

## Supported File Types

- **PDF**: Converts PDF documents to Markdown
- **Word (.docx)**: Converts Microsoft Word documents to Markdown
- **HTML/HTM**: Converts HTML content to Markdown
- **Jupyter Notebooks (.ipynb)**: Converts notebooks to Markdown preserving code blocks
- **Excel (.xlsx, .xls)**: Converts Excel spreadsheets to Markdown tables
- **CSV**: Converts CSV data to Markdown tables
- **PowerPoint (.pptx)**: Extracts text from presentation slides
- **ZIP**: Extracts contents and converts applicable files to Markdown
- **XML/RSS/ATOM**: Converts XML and feed formats to Markdown
- **Images (.jpg, .png, .gif)**: Extracts image metadata
- **Audio (.mp3, .wav)**: Extracts audio metadata
- **Text (.txt)**: Converts plain text files
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
  "./output"
);
console.log(`Saved to: ${savedPath}`);
```

## License

MIT
