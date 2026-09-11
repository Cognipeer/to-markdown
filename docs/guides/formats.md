---
layout: default
title: Format Support
nav_order: 5
---

# Format Support

`@cognipeer/to-markdown` supports a wide variety of file formats. Each format is handled by a specialized converter optimized for that format's structure.

## Document Formats

### PDF Documents (.pdf)

Converts PDF documents to Markdown, preserving text structure and formatting.

```typescript
const markdown = await convertToMarkdown('./document.pdf');
```

**Features:**
- Text extraction
- Heading detection
- Paragraph formatting

---

### Word Documents (.docx)

Converts Microsoft Word documents to Markdown.

```typescript
const markdown = await convertToMarkdown('./document.docx');
```

**Features:**
- Text formatting (bold, italic)
- Headings and lists
- Tables
- Inline styles

---

### Legacy Word Documents (.doc)

Converts Word 97-2003 binary DOC files to Markdown-compatible text.

```typescript
const markdown = await convertToMarkdown('./policy.doc');
```

**Features:**
- Body text, paragraphs, and field results
- Unordered and ordered Markdown lists
- Non-empty headers and footnotes by default
- Tab-separated table rows when cell structure cannot be verified
- Bounded Compound File parsing and controlled errors for malformed input

**Limits and scope:**
- Default input limit: 25 MiB; maximum: 50 MiB
- Default output limit: 2,000,000 characters; maximum: 4,000,000
- Encrypted documents and Word 6/95 documents are rejected with typed errors
- Images, OCR text, visual layout, and embedded-object payloads are not extracted

Use `fileName` or `forceExtension: '.doc'` with Buffer or plain-base64 input.

---

### HTML/HTM (.html, .htm)

Converts HTML web pages to clean Markdown.

```typescript
const markdown = await convertToMarkdown('./page.html');
```

**Features:**
- Semantic HTML to Markdown
- Table conversion
- List handling
- Link preservation
- Code block detection

---

## Spreadsheet Formats

### Excel (.xlsx, .xls)

Converts Excel spreadsheets to Markdown tables.

```typescript
const markdown = await convertToMarkdown('./data.xlsx');
```

**Features:**
- Multiple sheet support
- Table formatting
- Header detection

**Output Example:**
```markdown
## Sheet1

| Name | Age | City |
| --- | --- | --- |
| John | 30 | NYC |
| Jane | 25 | LA |
```

---

### CSV (.csv)

Converts CSV files to Markdown tables.

```typescript
const markdown = await convertToMarkdown('./data.csv');
```

**Features:**
- Automatic delimiter detection
- Header row handling
- Clean table formatting

---

## Notebook Formats

### Jupyter Notebooks (.ipynb)

Converts Jupyter notebooks to Markdown, preserving code and markdown cells.

```typescript
const markdown = await convertToMarkdown('./analysis.ipynb');
```

**Features:**
- Markdown cell preservation
- Code block formatting
- Cell order maintained
- Output omission (text only)

**Output Example:**
```markdown
# Analysis Title

This is a markdown cell.

```python
import pandas as pd
df = pd.read_csv('data.csv')
```

## Results

The data shows...
```

---

## Presentation Formats

### PowerPoint (.pptx)

Extracts text content from PowerPoint presentations.

```typescript
const markdown = await convertToMarkdown('./presentation.pptx');
```

**Features:**
- Slide text extraction
- Slide order preservation
- Comments included

---

## Data Formats

### XML/RSS/ATOM (.xml, .rss, .atom)

Converts XML feeds and documents to structured Markdown.

```typescript
const markdown = await convertToMarkdown('./feed.rss');
```

**Features:**
- RSS feed parsing
- ATOM feed parsing
- Structured output
- Metadata preservation

**RSS Output Example:**
```markdown
# Blog Title

## Latest Article
Published on: 2025-01-01

Article content here...
```

---

## Media Formats

### Images (.jpg, .jpeg, .png, .gif)

Extracts metadata from image files.

```typescript
const markdown = await convertToMarkdown('./photo.jpg');
```

**Features:**
- Image dimensions
- Format information
- File size

**Note:** OCR support planned for future releases.

---

### Audio (.mp3, .wav)

Extracts metadata from audio files.

```typescript
const markdown = await convertToMarkdown('./song.mp3');
```

**Features:**
- Title, artist, album
- Duration
- Bitrate

**Note:** Speech-to-text support planned for future releases.

---

## Archive Formats

### ZIP Archives (.zip)

Processes ZIP archives and converts contained files.

```typescript
const markdown = await convertToMarkdown('./archive.zip');
```

**Features:**
- Recursive file processing
- Multiple file handling
- Content aggregation

---

## Text Formats

### Plain Text (.txt)

Processes plain text files with minimal transformation.

```typescript
const markdown = await convertToMarkdown('./notes.txt');
```

**Features:**
- UTF-8 encoding support
- Whitespace preservation

---

## Special Formats

### YouTube Pages

Extracts information from YouTube video pages.

```typescript
const markdown = await convertToMarkdown(htmlBuffer, {
  url: 'https://www.youtube.com/watch?v=...'
});
```

**Features:**
- Title extraction
- Description parsing

---

### Bing Search Results

Converts Bing search results to structured Markdown.

```typescript
const markdown = await convertToMarkdown(htmlBuffer, {
  url: 'https://www.bing.com/search?q=...'
});
```

**Features:**
- Search result extraction
- Clean formatting

---

## Format Detection

The library automatically detects file formats using:

1. **File extension** (for file paths)
2. **MIME type** (for base64 data URLs)
3. **Magic bytes** (for buffers without extension)
4. **Fallback** to plain text if detection fails

You can force a specific format:

```typescript
const markdown = await convertToMarkdown(buffer, {
  forceExtension: '.pdf'
});
```

## See Also

- [API Overview]({{ site.baseurl }}{% link api/overview.md %})
- [Converter Options]({{ site.baseurl }}{% link api/options.md %})
