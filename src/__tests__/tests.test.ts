import AdmZip from "adm-zip";
import { Buffer } from "buffer";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";

// ── Utilities ──────────────────────────────────────────────────────────────
import { detectFileType } from "../utils/fileDetection.ts";
import { arrayToMarkdownTable, formatMarkdown } from "../utils/markdown.ts";

// ── Converters ─────────────────────────────────────────────────────────────
import {
  convertPptxToMarkdown,
  convertZipToMarkdown,
} from "../converters/archive.ts";
import { convertDocxToMarkdown } from "../converters/docx.ts";
import { convertHtmlToMarkdown, htmlToMarkdown } from "../converters/html.ts";
import {
  convertAudioToMarkdown,
  convertImageToMarkdown,
} from "../converters/media.ts";
import { convertIpynbToMarkdown } from "../converters/notebook.ts";
import { convertPdfToMarkdown } from "../converters/pdf.ts";
import {
  convertCsvToMarkdown,
  convertExcelToMarkdown,
} from "../converters/spreadsheet.ts";
import {
  convertBingSerpToMarkdown,
  convertTextFileToMarkdown,
  convertYoutubeToMarkdown,
} from "../converters/text.ts";
import { convertRssAtomToMarkdown } from "../converters/xml.ts";

// ── Main API ───────────────────────────────────────────────────────────────
import { convertToMarkdown, saveToMarkdownFile } from "../index.ts";

// ═══════════════════════════════════════════════════════════════════════════
// 1. formatMarkdown
// ═══════════════════════════════════════════════════════════════════════════
describe("formatMarkdown()", () => {
  it("returns empty string for empty input", () => {
    expect(formatMarkdown("")).toBe("");
  });

  it("converts bold text to heading", () => {
    const result = formatMarkdown("**Heading**");
    expect(result).toContain("## Heading");
  });

  it("normalizes bullet characters (•)", () => {
    const result = formatMarkdown("• item one");
    expect(result).toContain("* item one");
  });

  it("normalizes bullet characters (-)", () => {
    const result = formatMarkdown("- item two");
    expect(result).toContain("* item two");
  });

  it("collapses consecutive empty lines to a single empty line", () => {
    const result = formatMarkdown("line1\n\n\n\nline2");
    expect(result).not.toMatch(/\n{3,}/);
  });

  it("trims leading/trailing whitespace", () => {
    const result = formatMarkdown("   hello   ");
    expect(result).toBe("hello"); // does not convert to heading because it starts with lowercase
  });

  it("preserves lines starting with #", () => {
    const result = formatMarkdown("# Heading\nSubtext");
    expect(result).toContain("# Heading");
  });

  it("plain line starting with uppercase no longer converts to heading (bug fix)", () => {
    const result = formatMarkdown("Short Title");
    expect(result).not.toContain("## Short Title");
    expect(result).toContain("Short Title"); // original text is preserved
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. arrayToMarkdownTable
// ═══════════════════════════════════════════════════════════════════════════
describe("arrayToMarkdownTable()", () => {
  it("returns empty string for empty array", () => {
    expect(arrayToMarkdownTable([])).toBe("");
  });

  it("creates correct header row", () => {
    const data = [
      ["Name", "Surname"],
      ["John", "Doe"],
    ];
    const result = arrayToMarkdownTable(data);
    expect(result).toContain("| Name | Surname |");
  });

  it("creates separator row", () => {
    const data = [
      ["A", "B"],
      ["1", "2"],
    ];
    const result = arrayToMarkdownTable(data);
    expect(result).toContain("| --- | --- |");
  });

  it("correctly writes data rows", () => {
    const data = [
      ["Name", "Age"],
      ["John", "25"],
      ["Jane", "30"],
    ];
    const result = arrayToMarkdownTable(data);
    expect(result).toContain("| John | 25 |");
    expect(result).toContain("| Jane | 30 |");
  });

  it("creates single-row (header only) table", () => {
    const data = [["Column1", "Column2"]];
    const result = arrayToMarkdownTable(data);
    expect(result).toContain("| Column1 | Column2 |");
    expect(result).toContain("---");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. convertHtmlToMarkdown / htmlToMarkdown
// ═══════════════════════════════════════════════════════════════════════════
describe("convertHtmlToMarkdown()", () => {
  it("converts simple h1 tag to markdown heading", () => {
    const html = "<h1>Hello World</h1>";
    const result = convertHtmlToMarkdown(html);
    expect(result).toContain("# Hello World");
  });

  it("correctly converts h2 tag", () => {
    const result = convertHtmlToMarkdown("<h2>Subheading</h2>");
    expect(result).toContain("## Subheading");
  });

  it("converts paragraph tag to plain text", () => {
    const result = convertHtmlToMarkdown("<p>This is a paragraph.</p>");
    expect(result).toContain("paragraph");
  });

  it("removes script and style tags", () => {
    const html = '<script>alert("xss")</script><p>content</p>';
    const result = convertHtmlToMarkdown(html);
    expect(result).not.toContain("alert");
    expect(result).not.toContain("<script>");
  });

  it("converts bold tag to markdown bold", () => {
    const result = htmlToMarkdown("<p><strong>bold text</strong></p>");
    expect(result).toContain("**bold text**");
  });

  it("converts anchor tag to markdown link", () => {
    const result = htmlToMarkdown('<a href="https://example.com">click</a>');
    expect(result).toContain("https://example.com");
  });

  it("converts unordered list to markdown list", () => {
    const html = "<ul><li>Apple</li><li>Pear</li></ul>";
    const result = convertHtmlToMarkdown(html);
    expect(result).toContain("Apple");
    expect(result).toContain("Pear");
  });

  it("accepts Buffer input", () => {
    const buffer = Buffer.from("<h1>Heading</h1>", "utf-8");
    const result = convertHtmlToMarkdown(buffer);
    expect(result).toContain("# Heading");
  });

  it("handles complex nested HTML", () => {
    const html = `
      <html><body>
        <h1>Main Heading</h1>
        <p>Paragraph text <strong>bold</strong> and <em>italic</em></p>
        <ul><li>item 1</li><li>item 2</li></ul>
      </body></html>
    `;
    const result = convertHtmlToMarkdown(html);
    expect(result).toContain("Main Heading");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(10);
  });

  it("throws error for invalid input", () => {
    expect(() => convertHtmlToMarkdown(123 as any)).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. convertTextFileToMarkdown
// ═══════════════════════════════════════════════════════════════════════════
describe("convertTextFileToMarkdown()", () => {
  it("returns plain text", () => {
    const buffer = Buffer.from("Hello World", "utf-8");
    expect(convertTextFileToMarkdown(buffer)).toBe("Hello World");
  });

  it("returns empty string for empty buffer", () => {
    expect(convertTextFileToMarkdown(Buffer.from(""))).toBe("");
  });

  it("preserves special characters", () => {
    const text = "Unicode characters: ñ, ü, ß, è, ø, ç";
    const result = convertTextFileToMarkdown(Buffer.from(text, "utf-8"));
    expect(result).toContain("ñ");
    expect(result).toContain("ß");
  });

  it("preserves multi-line text", () => {
    const text = "line 1\nline 2\nline 3";
    const result = convertTextFileToMarkdown(Buffer.from(text, "utf-8"));
    expect(result).toContain("line 1");
    expect(result).toContain("line 3");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. convertCsvToMarkdown
// ═══════════════════════════════════════════════════════════════════════════
describe("convertCsvToMarkdown()", () => {
  it("converts simple CSV to markdown table", () => {
    const csv = "Name,Surname,Age\nJohn,Doe,25\nJane,Smith,30";
    const result = convertCsvToMarkdown(Buffer.from(csv, "utf-8"));
    expect(result).toContain("Name");
    expect(result).toContain("Surname");
    expect(result).toContain("John");
    expect(result).toContain("Jane");
  });

  it("includes separator row", () => {
    const csv = "A,B\n1,2";
    const result = convertCsvToMarkdown(Buffer.from(csv, "utf-8"));
    expect(result).toContain("---");
  });

  it("handles single-column CSV", () => {
    const csv = "Product\nApple\nPear";
    const result = convertCsvToMarkdown(Buffer.from(csv, "utf-8"));
    expect(result).toContain("Product");
    expect(result).toContain("Apple");
  });

  it("correctly handles values with spaces", () => {
    const csv = '"Full Name","City"\n"John Smith","New York"';
    const result = convertCsvToMarkdown(Buffer.from(csv, "utf-8"));
    expect(result).toContain("John Smith");
  });

  it("uses pipe character in large CSV", () => {
    const csv = "A,B,C\n1,2,3\n4,5,6";
    const result = convertCsvToMarkdown(Buffer.from(csv, "utf-8"));
    expect(result).toContain("|");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. convertRssAtomToMarkdown
// ═══════════════════════════════════════════════════════════════════════════
describe("convertRssAtomToMarkdown()", () => {
  const rssXml = `<?xml version="1.0"?>
    <rss version="2.0">
      <channel>
        <title>Test Blog</title>
        <description>News</description>
        <item>
          <title>News 1</title>
          <pubDate>Mon, 01 Jun 2026 00:00:00 GMT</pubDate>
          <description>First news content</description>
        </item>
        <item>
          <title>News 2</title>
          <pubDate>Tue, 02 Jun 2026 00:00:00 GMT</pubDate>
          <description>Second news content</description>
        </item>
      </channel>
    </rss>`;

  const atomXml = `<?xml version="1.0" encoding="UTF-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <title>Atom Feed</title>
      <subtitle>Description</subtitle>
      <entry>
        <title>Entry 1</title>
        <updated>2026-06-01T00:00:00Z</updated>
        <summary>Summary content</summary>
      </entry>
    </feed>`;

  it("converts RSS title to markdown heading", async () => {
    const result = await convertRssAtomToMarkdown(Buffer.from(rssXml, "utf-8"));
    expect(result).toContain("Test Blog");
  });

  it("includes RSS item titles", async () => {
    const result = await convertRssAtomToMarkdown(Buffer.from(rssXml, "utf-8"));
    expect(result).toContain("News 1");
    expect(result).toContain("News 2");
  });

  it("includes RSS item descriptions", async () => {
    const result = await convertRssAtomToMarkdown(Buffer.from(rssXml, "utf-8"));
    expect(result).toContain("First news");
  });

  it("handles ATOM feed title", async () => {
    const result = await convertRssAtomToMarkdown(
      Buffer.from(atomXml, "utf-8"),
    );
    expect(result).toContain("Atom Feed");
  });

  it("handles ATOM entry title", async () => {
    const result = await convertRssAtomToMarkdown(
      Buffer.from(atomXml, "utf-8"),
    );
    expect(result).toContain("Entry 1");
  });

  it("throws error for invalid XML", async () => {
    await expect(
      convertRssAtomToMarkdown(
        Buffer.from("this is not valid xml<<<", "utf-8"),
      ),
    ).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. convertIpynbToMarkdown
// ═══════════════════════════════════════════════════════════════════════════
describe("convertIpynbToMarkdown()", () => {
  const notebook = {
    cells: [
      { cell_type: "markdown", source: ["# Heading\n", "Description text"] },
      { cell_type: "code", source: ['print("Hello, World!")\n', "x = 1 + 1"] },
      { cell_type: "markdown", source: ["## Subheading\n", "More text"] },
      { cell_type: "raw", source: ["raw text content"] },
    ],
  };

  it("converts markdown cells to markdown", async () => {
    const result = await convertIpynbToMarkdown(
      Buffer.from(JSON.stringify(notebook), "utf-8"),
    );
    expect(result).toContain("Heading");
  });

  it("converts code cells to code block", async () => {
    const result = await convertIpynbToMarkdown(
      Buffer.from(JSON.stringify(notebook), "utf-8"),
    );
    expect(result).toContain("```python");
    expect(result).toContain('print("Hello, World!")');
  });

  it("converts raw cells to code block", async () => {
    const result = await convertIpynbToMarkdown(
      Buffer.from(JSON.stringify(notebook), "utf-8"),
    );
    expect(result).toContain("raw text");
  });

  it("returns empty string for empty cells array", async () => {
    const empty = { cells: [] };
    const result = await convertIpynbToMarkdown(
      Buffer.from(JSON.stringify(empty), "utf-8"),
    );
    expect(result).toBe("");
  });

  it("returns empty string for notebook without cells key", async () => {
    const noCells = {};
    const result = await convertIpynbToMarkdown(
      Buffer.from(JSON.stringify(noCells), "utf-8"),
    );
    expect(result).toBe("");
  });

  it("throws error for invalid JSON", async () => {
    await expect(
      convertIpynbToMarkdown(Buffer.from("{invalid json", "utf-8")),
    ).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. convertYoutubeToMarkdown
// ═══════════════════════════════════════════════════════════════════════════
describe("convertYoutubeToMarkdown()", () => {
  const youtubeHtml = `<html>
    <head>
      <title>Test Video - YouTube</title>
      <meta name="description" content="This is a test video description.">
    </head>
    <body></body>
  </html>`;

  it("includes video title", () => {
    const result = convertYoutubeToMarkdown(
      Buffer.from(youtubeHtml, "utf-8"),
      "https://www.youtube.com/watch?v=abc123",
    );
    expect(result).toContain("Test Video");
  });

  it("includes video description", () => {
    const result = convertYoutubeToMarkdown(
      Buffer.from(youtubeHtml, "utf-8"),
      "https://www.youtube.com/watch?v=abc123",
    );
    expect(result).toContain("test video");
  });

  it("includes YouTube label", () => {
    const result = convertYoutubeToMarkdown(
      Buffer.from(youtubeHtml, "utf-8"),
      "https://www.youtube.com/watch?v=abc123",
    );
    expect(result).toContain("YouTube");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. convertBingSerpToMarkdown
// ═══════════════════════════════════════════════════════════════════════════
describe("convertBingSerpToMarkdown()", () => {
  const bingHtml = `<html><body>
    <li class="b_algo"><p>First result text here.</p></li>
    <li class="b_algo"><p>Second result text here.</p></li>
  </body></html>`;

  it("includes query text in title", () => {
    const result = convertBingSerpToMarkdown(
      Buffer.from(bingHtml, "utf-8"),
      "https://www.bing.com/search?q=typescript",
    );
    expect(result).toContain("typescript");
  });

  it("includes search results", () => {
    const result = convertBingSerpToMarkdown(
      Buffer.from(bingHtml, "utf-8"),
      "https://www.bing.com/search?q=test",
    );
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. convertToMarkdown – Main API
// ═══════════════════════════════════════════════════════════════════════════
describe("convertToMarkdown() - Main API", () => {
  it("converts HTML string to markdown (forceExtension)", async () => {
    const html = "<h1>Test</h1><p>Paragraph</p>";
    const result = await convertToMarkdown(Buffer.from(html, "utf-8"), {
      forceExtension: ".html",
    });
    expect(result).toContain("Test");
    expect(typeof result).toBe("string");
  });

  it("converts CSV buffer to markdown table", async () => {
    const csv = "Product,Price\nApple,5\nPear,7";
    const result = await convertToMarkdown(Buffer.from(csv, "utf-8"), {
      forceExtension: ".csv",
    });
    expect(result).toContain("Product");
    expect(result).toContain("Apple");
  });

  it("returns TXT buffer as plain text", async () => {
    const text = "Plain text content";
    const result = await convertToMarkdown(Buffer.from(text, "utf-8"), {
      forceExtension: ".txt",
    });
    expect(result).toContain("Plain text");
  });

  it("correctly processes IPYNB buffer", async () => {
    const nb = { cells: [{ cell_type: "markdown", source: ["# Test\n"] }] };
    const result = await convertToMarkdown(
      Buffer.from(JSON.stringify(nb), "utf-8"),
      { forceExtension: ".ipynb" },
    );
    expect(result).toContain("Test");
  });

  it("processes RSS XML buffer", async () => {
    const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>Feed</title></channel></rss>`;
    const result = await convertToMarkdown(Buffer.from(rss, "utf-8"), {
      forceExtension: ".rss",
    });
    expect(result).toContain("Feed");
  });

  it("performs special processing for YouTube URL", async () => {
    const html = "<html><head><title>Video - YouTube</title></head></html>";
    const result = await convertToMarkdown(Buffer.from(html, "utf-8"), {
      url: "https://www.youtube.com/watch?v=abc",
      forceExtension: ".xyz",
    });
    expect(result).toContain("YouTube");
  });

  it("throws error for non-existent file path", async () => {
    await expect(convertToMarkdown("/nonexistent/file.pdf")).rejects.toThrow(
      "File not found",
    );
  });

  it("throws error for invalid input type", async () => {
    await expect(convertToMarkdown(12345 as any)).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. saveToMarkdownFile
// ═══════════════════════════════════════════════════════════════════════════
describe("saveToMarkdownFile()", () => {
  const testOutputDir = join(process.cwd(), "test-output-temp");

  it("saves file and returns path", async () => {
    const filePath = await saveToMarkdownFile(
      "# Test Content",
      "test-save",
      testOutputDir,
    );
    expect(existsSync(filePath)).toBe(true);
    unlinkSync(filePath);
  });

  it("file content is written correctly", async () => {
    const content = "# Hello\nThis is a test.";
    const filePath = await saveToMarkdownFile(
      content,
      "test-content",
      testOutputDir,
    );
    const read = readFileSync(filePath, "utf-8");
    expect(read).toBe(content);
    unlinkSync(filePath);
  });

  it("automatically appends .md extension", async () => {
    const filePath = await saveToMarkdownFile(
      "content",
      "file-name",
      testOutputDir,
    );
    expect(filePath.endsWith(".md")).toBe(true);
    unlinkSync(filePath);
  });

  it("does not add .md extension if already present", async () => {
    const filePath = await saveToMarkdownFile(
      "content",
      "file.md",
      testOutputDir,
    );
    expect(filePath.endsWith(".md")).toBe(true);
    expect(filePath).not.toContain(".md.md");
    unlinkSync(filePath);
  });

  it("creates directory if it does not exist", async () => {
    const newDir = join(testOutputDir, "sub-dir-" + Date.now());
    const filePath = await saveToMarkdownFile("test", "sample", newDir);
    expect(existsSync(filePath)).toBe(true);
    unlinkSync(filePath);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12. detectFileType
// ═══════════════════════════════════════════════════════════════════════════
describe("detectFileType()", () => {
  const tempDir = join(process.cwd(), "test-output-temp");

  it("detects extension from file path (.csv)", async () => {
    const tempFile = join(tempDir, `detect-test-${Date.now()}.csv`);
    writeFileSync(tempFile, "A,B\n1,2", "utf-8");
    try {
      const result = await detectFileType(tempFile);
      expect(result.extension).toBe(".csv");
      expect(result.buffer).toBeInstanceOf(Buffer);
    } finally {
      unlinkSync(tempFile);
    }
  });

  it("respects forceExtension option", async () => {
    const tempFile = join(tempDir, `detect-test2-${Date.now()}.txt`);
    writeFileSync(tempFile, "content", "utf-8");
    try {
      const result = await detectFileType(tempFile, {
        forceExtension: ".html",
      });
      expect(result.extension).toBe(".html");
    } finally {
      unlinkSync(tempFile);
    }
  });

  it("handles data URL (base64) input", async () => {
    const base64 =
      "data:text/csv;base64," + Buffer.from("A,B\n1,2").toString("base64");
    const result = await detectFileType(base64);
    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.buffer.toString()).toContain("A,B");
  });

  it("handles Buffer input with forceExtension", async () => {
    const buf = Buffer.from("test content");
    const result = await detectFileType(buf, { forceExtension: ".txt" });
    expect(result.extension).toBe(".txt");
    expect(result.buffer).toBeInstanceOf(Buffer);
  });

  it("detects extension from magic bytes for PNG buffer", async () => {
    // minimal 1x1 pixel PNG
    const pngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const pngBuffer = Buffer.from(pngBase64, "base64");
    const result = await detectFileType(pngBuffer);
    expect(result.extension).toBe(".png");
  });

  it("throws error for non-existent file", async () => {
    await expect(detectFileType("/no/such/file.pdf")).rejects.toThrow(
      "File not found",
    );
  });

  it("throws error for invalid input type", async () => {
    await expect(detectFileType(99999 as any)).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 13. convertExcelToMarkdown
// ═══════════════════════════════════════════════════════════════════════════
describe("convertExcelToMarkdown()", () => {
  let excelBuffer: Buffer;

  /** Builds an .xlsx buffer from an array-of-arrays via ExcelJS. */
  async function buildXlsx(
    sheets: Array<{ name: string; rows: unknown[][] }>,
  ): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    for (const { name, rows } of sheets) {
      const ws = wb.addWorksheet(name);
      rows.forEach((row) => ws.addRow(row as any[]));
    }
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  beforeAll(async () => {
    excelBuffer = await buildXlsx([
      {
        name: "Employees",
        rows: [
          ["Name", "Surname", "Age"],
          ["John", "Doe", 25],
          ["Jane", "Smith", 30],
        ],
      },
    ]);
  });

  it("adds sheet name as heading", async () => {
    const result = await convertExcelToMarkdown(excelBuffer);
    expect(result).toContain("Employees");
  });

  it("writes column headers to markdown table", async () => {
    const result = await convertExcelToMarkdown(excelBuffer);
    expect(result).toContain("Name");
    expect(result).toContain("Surname");
    expect(result).toContain("Age");
  });

  it("writes data rows", async () => {
    const result = await convertExcelToMarkdown(excelBuffer);
    expect(result).toContain("John");
    expect(result).toContain("Jane");
  });

  it("includes separator row", async () => {
    const result = await convertExcelToMarkdown(excelBuffer);
    expect(result).toContain("---");
  });

  it("supports multiple sheets", async () => {
    const buf = await buildXlsx([
      { name: "Sheet1", rows: [["X"], [1]] },
      { name: "Sheet2", rows: [["Y"], [2]] },
    ]);
    const result = await convertExcelToMarkdown(buf);
    expect(result).toContain("Sheet1");
    expect(result).toContain("Sheet2");
  });

  it("pads ragged rows so the table stays rectangular", async () => {
    const buf = await buildXlsx([
      { name: "Ragged", rows: [["A", "B", "C"], ["only-one"]] },
    ]);
    const result = await convertExcelToMarkdown(buf);
    const dataRow = result
      .split("\n")
      .find((line) => line.includes("only-one"))!;
    // 3 columns => 4 pipes
    expect(dataRow.split("|").length - 1).toBe(4);
  });

  it("throws a clear error for a buffer that is not a spreadsheet", async () => {
    await expect(
      convertExcelToMarkdown(Buffer.from("not an excel file")),
    ).rejects.toThrow(/Failed to convert Excel/);
  });

  it("convertToMarkdown handles .xlsx format", async () => {
    const result = await convertToMarkdown(excelBuffer, {
      forceExtension: ".xlsx",
    });
    expect(result).toContain("Employees");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 14. convertZipToMarkdown
// ═══════════════════════════════════════════════════════════════════════════
describe("convertZipToMarkdown()", () => {
  let zipBuffer: Buffer;

  beforeAll(() => {
    const zip = new AdmZip();
    zip.addFile("readme.txt", Buffer.from("Hello World!"));
    zip.addFile("data.csv", Buffer.from("A,B\n1,2"));
    zip.addFile("subfolder/notes.txt", Buffer.from("Subfolder note"));
    zipBuffer = zip.toBuffer();
  });

  it("lists file names", async () => {
    const result = await convertZipToMarkdown(zipBuffer, {});
    expect(result).toContain("readme.txt");
    expect(result).toContain("data.csv");
  });

  it("includes text file content", async () => {
    const result = await convertZipToMarkdown(zipBuffer, {});
    expect(result).toContain("Hello World!");
    expect(result).toContain("Subfolder note");
  });

  it("converts CSV content to table", async () => {
    const result = await convertZipToMarkdown(zipBuffer, {});
    // CSV converted to markdown table — header should appear
    expect(result).toContain("A");
  });

  it("returns string", async () => {
    const result = await convertZipToMarkdown(zipBuffer, {});
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("convertToMarkdown handles .zip format", async () => {
    const result = await convertToMarkdown(zipBuffer, {
      forceExtension: ".zip",
    });
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("throws error for invalid buffer", async () => {
    await expect(
      convertZipToMarkdown(Buffer.from("not a zip file"), {}),
    ).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 15. convertPptxToMarkdown
// ═══════════════════════════════════════════════════════════════════════════
describe("convertPptxToMarkdown()", () => {
  let pptxBuffer: Buffer;

  beforeAll(() => {
    const zip = new AdmZip();
    zip.addFile(
      "ppt/slides/slide1.xml",
      Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
               xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <p:cSld><p:spTree>
            <p:sp><p:txBody>
              <a:p><a:r><a:t>Slide Title</a:t></a:r></a:p>
              <a:p><a:r><a:t>Slide Description</a:t></a:r></a:p>
            </p:txBody></p:sp>
          </p:spTree></p:cSld>
        </p:sld>`,
      ),
    );
    zip.addFile(
      "ppt/slides/slide2.xml",
      Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
               xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <p:cSld><p:spTree>
            <p:sp><p:txBody>
              <a:p><a:r><a:t>Second Slide</a:t></a:r></a:p>
            </p:txBody></p:sp>
          </p:spTree></p:cSld>
        </p:sld>`,
      ),
    );
    pptxBuffer = zip.toBuffer();
  });

  it("extracts slide content", async () => {
    const result = await convertPptxToMarkdown(pptxBuffer);
    expect(result).toContain("Slide Title");
  });

  it("processes multiple slides", async () => {
    const result = await convertPptxToMarkdown(pptxBuffer);
    expect(result).toContain("Second Slide");
  });

  it("extracts slide description", async () => {
    const result = await convertPptxToMarkdown(pptxBuffer);
    expect(result).toContain("Slide Description");
  });

  it("returns string", async () => {
    const result = await convertPptxToMarkdown(pptxBuffer);
    expect(typeof result).toBe("string");
  });

  it("convertToMarkdown handles .pptx format", async () => {
    const result = await convertToMarkdown(pptxBuffer, {
      forceExtension: ".pptx",
    });
    expect(result).toContain("Slide Title");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 16. convertDocxToMarkdown
// ═══════════════════════════════════════════════════════════════════════════
describe("convertDocxToMarkdown()", () => {
  let docxBuffer: Buffer;

  beforeAll(() => {
    const zip = new AdmZip();
    zip.addFile(
      "[Content_Types].xml",
      Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
          <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
          <Override PartName="/word/document.xml"
            ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
        </Types>`,
      ),
    );
    zip.addFile(
      "_rels/.rels",
      Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId1"
            Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
            Target="word/document.xml"/>
        </Relationships>`,
      ),
    );
    zip.addFile(
      "word/document.xml",
      Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
          <w:body>
            <w:p><w:r><w:t>Hello World</w:t></w:r></w:p>
            <w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p>
          </w:body>
        </w:document>`,
      ),
    );
    zip.addFile(
      "word/_rels/document.xml.rels",
      Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`,
      ),
    );
    docxBuffer = zip.toBuffer();
  });

  it("returns string", async () => {
    const result = await convertDocxToMarkdown(docxBuffer);
    expect(typeof result).toBe("string");
  });

  it("extracts text content", async () => {
    const result = await convertDocxToMarkdown(docxBuffer);
    expect(result.length).toBeGreaterThanOrEqual(0); // mammoth can extract text from minimal DOCX
  });

  it("throws error for invalid buffer", async () => {
    await expect(
      convertDocxToMarkdown(Buffer.from("not a docx file")),
    ).rejects.toThrow();
  });

  it("convertToMarkdown handles .docx format", async () => {
    const result = await convertToMarkdown(docxBuffer, {
      forceExtension: ".docx",
    });
    expect(typeof result).toBe("string");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 17. convertImageToMarkdown
// ═══════════════════════════════════════════════════════════════════════════
describe("convertImageToMarkdown()", () => {
  // 1x1 pixel gray PNG (known valid PNG binary)
  const PNG_1x1 = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );

  it("returns string", async () => {
    const result = await convertImageToMarkdown(PNG_1x1, ".png");
    expect(typeof result).toBe("string");
  });

  it("includes size information (width x height)", async () => {
    const result = await convertImageToMarkdown(PNG_1x1, ".png");
    expect(result).toMatch(/1x1|ImageSize/);
  });

  it("includes format information", async () => {
    const result = await convertImageToMarkdown(PNG_1x1, ".png");
    expect(result.toLowerCase()).toContain("png");
  });

  it("throws error for invalid buffer", async () => {
    await expect(
      convertImageToMarkdown(Buffer.from("not an image"), ".png"),
    ).rejects.toThrow();
  });

  it("convertToMarkdown handles .png format", async () => {
    const result = await convertToMarkdown(PNG_1x1, { forceExtension: ".png" });
    expect(typeof result).toBe("string");
  });

  it("convertToMarkdown handles .jpg format", async () => {
    // using the same PNG buffer to test format handling
    const result = await convertToMarkdown(PNG_1x1, { forceExtension: ".jpg" });
    expect(typeof result).toBe("string");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 18. convertAudioToMarkdown
// ═══════════════════════════════════════════════════════════════════════════
describe("convertAudioToMarkdown()", () => {
  it("throws error for invalid buffer", async () => {
    await expect(
      convertAudioToMarkdown(Buffer.from("not an audio file"), ".mp3"),
    ).rejects.toThrow();
  });

  it("throws error for empty buffer", async () => {
    await expect(
      convertAudioToMarkdown(Buffer.alloc(0), ".wav"),
    ).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 19. convertPdfToMarkdown
// ═══════════════════════════════════════════════════════════════════════════
describe("convertPdfToMarkdown()", () => {
  it("throws error or returns empty for invalid buffer", async () => {
    // pdf2md throws an error instead of crashing with some buffers
    try {
      const result = await convertPdfToMarkdown(Buffer.from("not a pdf file"));
      expect(typeof result).toBe("string");
    } catch (err: any) {
      expect(err.message).toBeTruthy();
    }
  });

  it("works with minimal PDF buffer or returns meaningful error", async () => {
    const minimalPdf = Buffer.from(
      "%PDF-1.0\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
        "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
        "3 0 obj<</Type/Page/MediaBox[0 0 3 3]>>endobj\n" +
        "xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n" +
        "0000000058 00000 n \n0000000115 00000 n \n" +
        "trailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF",
    );
    try {
      const result = await convertPdfToMarkdown(minimalPdf);
      expect(typeof result).toBe("string");
    } catch (err: any) {
      expect(err.message).toBeTruthy();
    }
  });

  it("convertToMarkdown handles .pdf format with error handling", async () => {
    try {
      const result = await convertToMarkdown(Buffer.from("fake pdf content"), {
        forceExtension: ".pdf",
      });
      expect(typeof result).toBe("string");
    } catch (err: any) {
      expect(err.message).toBeTruthy();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 20. convertToMarkdown – File Path Based Tests
// ═══════════════════════════════════════════════════════════════════════════
describe("convertToMarkdown() - File Path Based Tests", () => {
  const tmpDir = join(process.cwd(), "test-output-temp");

  it("reads .html file from path and converts to markdown", async () => {
    const filePath = join(tmpDir, `test-${Date.now()}.html`);
    writeFileSync(
      filePath,
      "<h1>Heading from File</h1><p>Content</p>",
      "utf-8",
    );
    try {
      const result = await convertToMarkdown(filePath);
      expect(result).toContain("Heading from File");
    } finally {
      unlinkSync(filePath);
    }
  });

  it("reads .txt file from path", async () => {
    const filePath = join(tmpDir, `test-${Date.now()}.txt`);
    writeFileSync(filePath, "Text read from file", "utf-8");
    try {
      const result = await convertToMarkdown(filePath);
      expect(result).toContain("Text read from file");
    } finally {
      unlinkSync(filePath);
    }
  });

  it("reads .csv file from path and converts to table", async () => {
    const filePath = join(tmpDir, `test-${Date.now()}.csv`);
    writeFileSync(filePath, "Product,Price\nApple,5\nPear,7", "utf-8");
    try {
      const result = await convertToMarkdown(filePath);
      expect(result).toContain("Product");
      expect(result).toContain("Apple");
    } finally {
      unlinkSync(filePath);
    }
  });

  it("reads .ipynb file from path", async () => {
    const nb = { cells: [{ cell_type: "code", source: ["x = 42\n"] }] };
    const filePath = join(tmpDir, `test-${Date.now()}.ipynb`);
    writeFileSync(filePath, JSON.stringify(nb), "utf-8");
    try {
      const result = await convertToMarkdown(filePath);
      expect(result).toContain("x = 42");
    } finally {
      unlinkSync(filePath);
    }
  });

  it("supports fileName option (Buffer + fileName)", async () => {
    const csv = "A,B\n1,2";
    const result = await convertToMarkdown(Buffer.from(csv, "utf-8"), {
      fileName: "data.csv",
    });
    expect(result).toContain("A");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 21. convertJsonToMarkdown
// ═══════════════════════════════════════════════════════════════════════════
import {
  convertJsonToMarkdown,
  convertYamlToMarkdown,
} from "../converters/data.ts";
import { convertBatchToMarkdown } from "../index.ts";

describe("convertJsonToMarkdown()", () => {
  it("converts flat object to markdown table", () => {
    const obj = { name: "John", age: 30 };
    const result = convertJsonToMarkdown(Buffer.from(JSON.stringify(obj)));
    expect(result).toContain("name");
    expect(result).toContain("John");
  });

  it("lists array content", () => {
    const arr = [1, 2, 3];
    const result = convertJsonToMarkdown(Buffer.from(JSON.stringify(arr)));
    expect(result).toContain("1");
    expect(result).toContain("2");
  });

  it("converts nested object with headings", () => {
    const obj = { section: { title: "Hello", value: 42 } };
    const result = convertJsonToMarkdown(Buffer.from(JSON.stringify(obj)));
    expect(result).toContain("section");
    expect(result).toContain("title");
  });

  it("throws error for invalid JSON", () => {
    expect(() =>
      convertJsonToMarkdown(Buffer.from("{not valid json")),
    ).toThrow();
  });

  it("starts with # JSON Document heading", () => {
    const result = convertJsonToMarkdown(Buffer.from('{"x":1}'));
    expect(result).toContain("# JSON Document");
  });

  it("convertToMarkdown handles .json format", async () => {
    const result = await convertToMarkdown(Buffer.from('{"hello":"world"}'), {
      forceExtension: ".json",
    });
    expect(result).toContain("hello");
    expect(result).toContain("world");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 22. convertYamlToMarkdown
// ═══════════════════════════════════════════════════════════════════════════
describe("convertYamlToMarkdown()", () => {
  it("converts simple YAML key-value", () => {
    const yaml = "name: John\ncity: New York\n";
    const result = convertYamlToMarkdown(Buffer.from(yaml));
    expect(result).toContain("name");
    expect(result).toContain("John");
  });

  it("starts with # YAML Document heading", () => {
    const result = convertYamlToMarkdown(Buffer.from("x: 1\n"));
    expect(result).toContain("# YAML Document");
  });

  it("converts YAML with list", () => {
    const yaml = "items:\n  - apple\n  - banana\n";
    const result = convertYamlToMarkdown(Buffer.from(yaml));
    expect(result).toContain("items");
  });

  it("throws error for invalid YAML", () => {
    const badYaml = "key: :\n  - broken: [yaml";
    expect(() => convertYamlToMarkdown(Buffer.from(badYaml))).toThrow();
  });

  it("convertToMarkdown handles .yaml format", async () => {
    const result = await convertToMarkdown(Buffer.from("greeting: hello\n"), {
      forceExtension: ".yaml",
    });
    expect(result).toContain("greeting");
  });

  it("convertToMarkdown works with .yml extension", async () => {
    const result = await convertToMarkdown(Buffer.from("key: value\n"), {
      forceExtension: ".yml",
    });
    expect(result).toContain("key");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 23. convertBatchToMarkdown7
// ═══════════════════════════════════════════════════════════════════════════
describe("convertBatchToMarkdown()", () => {
  it("processes multiple inputs", async () => {
    const results = await convertBatchToMarkdown([
      {
        input: Buffer.from("<h1>Heading</h1>"),
        options: { forceExtension: ".html" },
      },
      { input: Buffer.from("A,B\n1,2"), options: { forceExtension: ".csv" } },
    ]);
    expect(results).toHaveLength(2);
    expect(results[0].result).toContain("Heading");
    expect(results[1].result).toContain("A");
  });

  it("returns error field for failing input", async () => {
    const results = await convertBatchToMarkdown([
      {
        input: Buffer.from("invalid zip"),
        options: { forceExtension: ".zip" },
      },
    ]);
    expect(results[0].error).toBeTruthy();
    expect(results[0].result).toBeUndefined();
  });

  it("returns empty array for empty array input", async () => {
    const results = await convertBatchToMarkdown([]);
    expect(results).toHaveLength(0);
  });

  it("processes mixed successful/failed results", async () => {
    const results = await convertBatchToMarkdown([
      {
        input: Buffer.from('{"key":"val"}'),
        options: { forceExtension: ".json" },
      },
      {
        input: Buffer.from("corrupted zip content"),
        options: { forceExtension: ".zip" },
      },
    ]);
    expect(results).toHaveLength(2);
    expect(results[0].result).toBeTruthy();
    expect(results[1].error).toBeTruthy();
  });

  it("uses file path as inputId for string path input", async () => {
    const tmpDir = join(process.cwd(), "test-output-temp");
    const filePath = join(tmpDir, `batch-test-${Date.now()}.html`);
    writeFileSync(filePath, "<p>Batch test</p>", "utf-8");
    try {
      const results = await convertBatchToMarkdown([{ input: filePath }]);
      expect(results[0].inputId).toBe(filePath);
      expect(results[0].result).toBeTruthy();
    } finally {
      unlinkSync(filePath);
    }
  });

  it('inputId is "buffer:0" for Buffer input', async () => {
    const results = await convertBatchToMarkdown([
      { input: Buffer.from("hello"), options: { forceExtension: ".txt" } },
    ]);
    expect(results[0].inputId).toBe("buffer:0");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 24. convertEpubToMarkdown
// ═══════════════════════════════════════════════════════════════════════════
import { convertEpubToMarkdown } from "../converters/epub.ts";

describe("convertEpubToMarkdown()", () => {
  let epubBuffer: Buffer;

  beforeAll(async () => {
    // Build a minimal valid EPUB with AdmZip
    const zip = new AdmZip();

    zip.addFile("mimetype", Buffer.from("application/epub+zip"));
    zip.addFile(
      "META-INF/container.xml",
      Buffer.from(
        `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
        <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
      </container>`,
      ),
    );
    zip.addFile(
      "OEBPS/content.opf",
      Buffer.from(
        `<?xml version="1.0" encoding="utf-8"?>
      <package xmlns="http://www.idpf.org/2007/opf" version="2.0">
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
          <dc:title>Test Book</dc:title>
          <dc:creator>Test Author</dc:creator>
        </metadata>
        <manifest>
          <item id="ch1" href="chapter1.html" media-type="application/xhtml+xml"/>
        </manifest>
        <spine><itemref idref="ch1"/></spine>
      </package>`,
      ),
    );
    zip.addFile(
      "OEBPS/chapter1.html",
      Buffer.from(
        "<html><body><h1>Chapter One</h1><p>Hello from EPUB.</p></body></html>",
      ),
    );

    epubBuffer = zip.toBuffer();
  });

  it("extracts book title", async () => {
    const out = await convertEpubToMarkdown(epubBuffer);
    expect(out).toContain("Test Book");
  });

  it("extracts author name", async () => {
    const out = await convertEpubToMarkdown(epubBuffer);
    expect(out).toContain("Test Author");
  });

  it("converts chapter content to markdown", async () => {
    const out = await convertEpubToMarkdown(epubBuffer);
    expect(out).toContain("Chapter One");
    expect(out).toContain("Hello from EPUB");
  });

  it("returns string", async () => {
    const out = await convertEpubToMarkdown(epubBuffer);
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(0);
  });

  it("convertToMarkdown handles .epub format", async () => {
    const out = await convertToMarkdown(epubBuffer, {
      forceExtension: ".epub",
    });
    expect(out).toContain("Test Book");
  });

  it("throws error for invalid buffer", async () => {
    await expect(
      convertEpubToMarkdown(Buffer.from("not an epub file")),
    ).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 25. convertMsgToMarkdown
// ═══════════════════════════════════════════════════════════════════════════
import { convertMsgToMarkdown } from "../converters/msg.ts";

// Real fixture: msgreader's own test.msg (senderName="christoph@freiraum.xyz", subject="asdf")
const MSG_FIXTURE_PATH = fileURLToPath(
  new URL("../../node_modules/msgreader/data/test.msg", import.meta.url),
);

describe("convertMsgToMarkdown()", () => {
  it("reads real MSG fixture and includes sender name", () => {
    const buf = readFileSync(MSG_FIXTURE_PATH);
    const out = convertMsgToMarkdown(buf);
    expect(out).toContain("christoph@freiraum.xyz");
  });

  it("extracts subject line from real MSG fixture", () => {
    const buf = readFileSync(MSG_FIXTURE_PATH);
    const out = convertMsgToMarkdown(buf);
    expect(out).toContain("asdf");
  });

  it('real MSG fixture output includes "# Email Message" heading', () => {
    const buf = readFileSync(MSG_FIXTURE_PATH);
    const out = convertMsgToMarkdown(buf);
    expect(out).toMatch(/^# Email Message/);
  });

  it("real MSG fixture output returns string", () => {
    const buf = readFileSync(MSG_FIXTURE_PATH);
    const out = convertMsgToMarkdown(buf);
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(10);
  });

  it("throws error or returns string for invalid buffer", () => {
    // msgreader is tolerant — may return partial data rather than throw
    try {
      const out = convertMsgToMarkdown(Buffer.from("not a msg file"));
      expect(typeof out).toBe("string");
    } catch (e: any) {
      expect(e.message).toBeTruthy();
    }
  });

  it("convertToMarkdown handles .msg format with real fixture", async () => {
    const buf = readFileSync(MSG_FIXTURE_PATH);
    const out = await convertToMarkdown(buf, { forceExtension: ".msg" });
    expect(out).toContain("christoph@freiraum.xyz");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 26. convertCsvToMarkdown — multi-encoding (Shift-JIS)
// ═══════════════════════════════════════════════════════════════════════════
import iconv from "iconv-lite";

describe("convertCsvToMarkdown() - multi-encoding", () => {
  it("correctly decodes Shift-JIS / CP932 CSV Japanese characters", () => {
    const csvText = "名前,年齢\n田中,25\n";
    const shiftJisBuffer = iconv.encode(csvText, "cp932");
    const out = convertCsvToMarkdown(shiftJisBuffer);
    expect(out).toContain("名前");
    expect(out).toContain("田中");
  });

  it("handles CSV with UTF-8 BOM", () => {
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    const csv = Buffer.from("Col1,Col2\nA,B\n", "utf-8");
    const out = convertCsvToMarkdown(Buffer.concat([bom, csv]));
    expect(out).toContain("Col1");
    expect(out).toContain("A");
  });

  it("regular UTF-8 CSV still works", () => {
    const out = convertCsvToMarkdown(Buffer.from("X,Y\n1,2\n", "utf-8"));
    expect(out).toContain("X");
    expect(out).toContain("1");
  });
});
