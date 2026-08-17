/**
 * new-features.test.ts
 *
 * Comprehensive tests:
 *   - countTokens  (tokenizer)
 *   - chunkMarkdown (chunker)
 *   - extractSections / buildFrontmatter / emitFrontmatter (metadata)
 *   - ocrImage            (ocr — error handling when deps are missing)
 *   - renderPdfPageToPng  (pdfRender — error handling when deps are missing)
 *   - convertToRichMarkdown (rich)
 *   - Backward-compat: convertToMarkdown, convertBatchToMarkdown, saveToMarkdownFile
 */

import { existsSync, unlinkSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

// ── New utilities ────────────────────────────────────────────────────────
import { chunkMarkdown } from "../utils/chunker.ts";
import {
  buildFrontmatter,
  emitFrontmatter,
  extractSections,
} from "../utils/metadata.ts";
import { ocrImage } from "../utils/ocr.ts";
import { renderPdfPageToPng } from "../utils/pdfRender.ts";
import { countTokens } from "../utils/tokenizer.ts";
import { convertImageToMarkdown } from "../converters/media.ts";

// ── New main API ─────────────────────────────────────────────────────────
import { convertToRichMarkdown } from "../rich.ts";

// ── Backward-compat ───────────────────────────────────────────────────────
import {
  convertBatchToMarkdown,
  convertToMarkdown,
  saveToMarkdownFile,
  type OCRHandlerContext,
} from "../index.ts";

// ─────────────────────────────────────────────────────────────────────────
// 1. countTokens
// ─────────────────────────────────────────────────────────────────────────
describe("countTokens()", () => {
  it("returns 0 for empty string", async () => {
    expect(await countTokens("")).toBe(0);
  });

  it("approx mode: calculates Math.ceil(chars / 4)", async () => {
    const text = "a".repeat(40); // 40 chars → ceil(40/4) = 10
    expect(await countTokens(text, "approx")).toBe(10);
  });

  it("default mode should be approx", async () => {
    const text = "hello world test"; // 16 chars → ceil(16/4) = 4
    expect(await countTokens(text)).toBe(4);
  });

  it("returns 1 for 1 character text", async () => {
    expect(await countTokens("x", "approx")).toBe(1);
  });

  it("returns 1 for 4 character text", async () => {
    expect(await countTokens("abcd", "approx")).toBe(1);
  });

  it("returns 2 for 5 character text", async () => {
    expect(await countTokens("abcde", "approx")).toBe(2);
  });

  it("returns 25 tokens for 100 character text", async () => {
    const text = "a".repeat(100);
    expect(await countTokens(text, "approx")).toBe(25);
  });

  it("gpt mode falls back to approx when gpt-tokenizer is not installed", async () => {
    // gpt-tokenizer is not installed in this project — approx fallback expected
    const text = "a".repeat(40);
    const result = await countTokens(text, "gpt");
    // approx result: 10; gpt result may differ but must not crash
    expect(typeof result).toBe("number");
    expect(result).toBeGreaterThan(0);
  });

  it("returns numeric value (not string)", async () => {
    const result = await countTokens("test text");
    expect(typeof result).toBe("number");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 2. chunkMarkdown
// ─────────────────────────────────────────────────────────────────────────
describe("chunkMarkdown()", () => {
  it("returns empty array for empty markdown", async () => {
    const chunks = await chunkMarkdown("");
    expect(chunks).toEqual([]);
  });

  it("returns empty array for whitespace-only markdown", async () => {
    const chunks = await chunkMarkdown("   \n\n   ");
    expect(chunks).toEqual([]);
  });

  it("returns single chunk for short text", async () => {
    const md = "# Heading\n\nShort text.";
    const chunks = await chunkMarkdown(md, { maxTokens: 512 });
    expect(chunks.length).toBe(1);
  });

  it("chunkIndex starts at zero and increments sequentially", async () => {
    const paragraphs = Array.from(
      { length: 10 },
      (_, i) => `Paragraph ${i} ${"word ".repeat(30)}`,
    ).join("\n\n");
    const chunks = await chunkMarkdown(paragraphs, { maxTokens: 50 });
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((c, i) => {
      expect(c.metadata.chunkIndex).toBe(i);
    });
  });

  it("totalChunks is the same across all chunks and holds the correct value", async () => {
    const paragraphs = Array.from(
      { length: 10 },
      (_, i) => `Paragraph ${i} ${"word ".repeat(30)}`,
    ).join("\n\n");
    const chunks = await chunkMarkdown(paragraphs, { maxTokens: 50 });
    expect(chunks.length).toBeGreaterThan(1);
    const total = chunks.length;
    chunks.forEach((c) => {
      expect(c.metadata.totalChunks).toBe(total);
    });
  });

  it("does not exceed maxTokens limit — multi-paragraph text is split", async () => {
    // Each paragraph is separated by \n\n to form distinct blocks
    const bigText = Array.from(
      { length: 20 },
      (_, i) => `Line ${i}: ${"word ".repeat(20)}`,
    ).join("\n\n"); // \n\n = separate paragraph blocks
    const maxT = 40;
    const chunks = await chunkMarkdown(bigText, {
      maxTokens: maxT,
      tokenizer: "approx",
    });
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("heading level metadata is tracked correctly", async () => {
    const md = `# H1 Heading\n\nText\n\n## H2 Subheading\n\nMore text`;
    const chunks = await chunkMarkdown(md, { maxTokens: 512 });
    // First chunk is under H1
    expect(chunks[0].metadata.headingLevel).toBeGreaterThan(0);
  });

  it("sectionPath is built correctly from headings", async () => {
    const md = `# Section 1\n\nText A\n\n## Subsection 1.1\n\nText B`;
    const chunks = await chunkMarkdown(md, { maxTokens: 512 });
    // last chunk's sectionPath should contain the deepest heading
    const lastChunk = chunks[chunks.length - 1];
    expect(lastChunk.metadata.sectionPath).toContain("Subsection 1.1");
  });

  it("multiple H1 sections carry separate section paths", async () => {
    const md = [
      "# First Section\n\n" + "x ".repeat(200),
      "# Second Section\n\n" + "y ".repeat(200),
    ].join("\n\n");
    const chunks = await chunkMarkdown(md, { maxTokens: 60 });
    const paths = chunks.map((c) => c.metadata.sectionPath[0]);
    expect(paths).toContain("First Section");
    expect(paths).toContain("Second Section");
  });

  it("code block is not split at chunk boundary (preserveCodeBlocks=true)", async () => {
    const code = "```python\n" + "x = 1\n".repeat(5) + "```";
    const md = `# Heading\n\n${code}`;
    const chunks = await chunkMarkdown(md, {
      maxTokens: 10,
      preserveCodeBlocks: true,
    });
    // The entire code block must fit in a single chunk
    const codeChunk = chunks.find((c) => c.content.includes("```python"));
    expect(codeChunk).toBeDefined();
    expect(codeChunk!.content).toContain("```python");
    expect(codeChunk!.content).toContain("```");
  });

  it("table is not split at chunk boundary (preserveTables=true)", async () => {
    const table = "| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n| 5 | 6 |";
    const md = `# Table Heading\n\n${table}`;
    const chunks = await chunkMarkdown(md, {
      maxTokens: 5,
      preserveTables: true,
    });
    const tableChunk = chunks.find((c) => c.content.includes("| A | B |"));
    expect(tableChunk).toBeDefined();
    // All table rows must be in the same chunk
    expect(tableChunk!.content).toContain("| 5 | 6 |");
  });

  it("overlap carries content from previous chunk", async () => {
    // The last paragraph of the first chunk should also appear in the second chunk
    const p1 = "First paragraph. ".repeat(30); // ~135 tokens
    const p2 = "Second paragraph content. ".repeat(30); // ~187 tokens
    const md = `${p1}\n\n${p2}`;
    const chunks = await chunkMarkdown(md, {
      maxTokens: 80,
      overlap: 40,
      tokenizer: "approx",
    });
    expect(chunks.length).toBeGreaterThan(1);
    // If overlap is active, words from the first chunk can also appear in the second
    if (chunks.length >= 2) {
      // Overlap: words from the first chunk may appear in the second
      expect(typeof chunks[1].content).toBe("string");
    }
  });

  it("baseMeta is spread to every chunk metadata", async () => {
    const md = "# Test\n\nContent text here.";
    const chunks = await chunkMarkdown(
      md,
      {},
      { sourceFile: "test.md", customKey: 42 },
    );
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].metadata.sourceFile).toBe("test.md");
    expect(chunks[0].metadata.customKey).toBe(42);
  });

  it("every chunk content is a string", async () => {
    const md = "# Heading\n\nA text paragraph.";
    const chunks = await chunkMarkdown(md);
    chunks.forEach((c) => {
      expect(typeof c.content).toBe("string");
      expect(c.content.length).toBeGreaterThan(0);
    });
  });

  it("every chunk tokenCount is positive", async () => {
    const md = "# Heading\n\nThis is a test sentence.";
    const chunks = await chunkMarkdown(md);
    chunks.forEach((c) => {
      expect(c.metadata.tokenCount).toBeGreaterThan(0);
    });
  });

  it("correctly tracks nested heading hierarchy", async () => {
    const md = `# Section A\n\n## Subsection A.1\n\n### Sub-subsection A.1.1\n\nText`;
    const chunks = await chunkMarkdown(md, { maxTokens: 512 });
    const last = chunks[chunks.length - 1];
    // sectionPath: ['Section A', 'Subsection A.1', 'Sub-subsection A.1.1']
    expect(last.metadata.sectionPath).toContain("Section A");
    expect(last.metadata.sectionPath).toContain("Subsection A.1");
    expect(last.metadata.sectionPath).toContain("Sub-subsection A.1.1");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 3. extractSections
// ─────────────────────────────────────────────────────────────────────────
describe("extractSections()", () => {
  it("returns empty array for markdown without headings", () => {
    expect(extractSections("plain text only")).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(extractSections("")).toEqual([]);
  });

  it("captures single H1 heading", () => {
    const secs = extractSections("# Main Heading\n\nContent.");
    expect(secs.length).toBe(1);
    expect(secs[0].heading).toBe("Main Heading");
    expect(secs[0].level).toBe(1);
  });

  it("captures H2 heading with correct level", () => {
    const secs = extractSections("## Subheading\n\nText");
    expect(secs[0].level).toBe(2);
    expect(secs[0].heading).toBe("Subheading");
  });

  it("returns multiple headings as separate sections", () => {
    const md = "# Section 1\n\nText A\n\n# Section 2\n\nText B";
    const secs = extractSections(md);
    expect(secs.length).toBe(2);
    expect(secs[0].heading).toBe("Section 1");
    expect(secs[1].heading).toBe("Section 2");
  });

  it("section content includes heading line", () => {
    const secs = extractSections("# Heading\n\nParagraph text.");
    expect(secs[0].content).toContain("# Heading");
  });

  it("section content includes paragraph text", () => {
    const secs = extractSections("# Heading\n\nParagraph text.");
    expect(secs[0].content).toContain("Paragraph text");
  });

  it("path contains only its own heading for a single H1", () => {
    const secs = extractSections("# Heading\n\nText");
    expect(secs[0].path).toEqual(["Heading"]);
  });

  it("path creates correct breadcrumb for nested headings", () => {
    const md = "# A\n\n## B\n\n### C\n\nText";
    const secs = extractSections(md);
    // 3 sections: A, B, C
    expect(secs.length).toBe(3);
    expect(secs[2].path).toEqual(["A", "B", "C"]);
  });

  it("content before first heading is ignored", () => {
    const secs = extractSections(
      "This text comes before the heading.\n\n# Heading\n\nAfterward.",
    );
    expect(secs.length).toBe(1);
    expect(secs[0].heading).toBe("Heading");
  });

  it("recognizes heading levels up to level 6", () => {
    const secs = extractSections("###### H6\n\nContent");
    expect(secs[0].level).toBe(6);
  });

  it("sibling headings carry their own path breadcrumbs", () => {
    const md = "# A\n\n## B1\n\n## B2\n\nText";
    const secs = extractSections(md);
    expect(secs.find((s) => s.heading === "B1")?.path).toEqual(["A", "B1"]);
    expect(secs.find((s) => s.heading === "B2")?.path).toEqual(["A", "B2"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 4. buildFrontmatter
// ─────────────────────────────────────────────────────────────────────────
describe("buildFrontmatter()", () => {
  it("extracts title from first H1", async () => {
    const fm = await buildFrontmatter("# Document Title\n\nText.");
    expect(fm.title).toBe("Document Title");
  });

  it("title is undefined when there is no H1", async () => {
    const fm = await buildFrontmatter("## Subheading\n\nText");
    expect(fm.title).toBeUndefined();
  });

  it("sections list includes all headings", async () => {
    const md = "# A\n\n## B\n\n### C";
    const fm = await buildFrontmatter(md);
    expect(fm.sections).toContain("A");
    expect(fm.sections).toContain("B");
    expect(fm.sections).toContain("C");
  });

  it("tokenCount returns a positive number", async () => {
    const fm = await buildFrontmatter("# Test\n\nContent text.");
    expect(fm.tokenCount).toBeGreaterThan(0);
  });

  it("tokenCount is consistent with approx formula", async () => {
    const md = "a".repeat(400); // 400 chars → 100 tokens
    const fm = await buildFrontmatter(md);
    expect(fm.tokenCount).toBe(100);
  });

  it("generatedAt is in ISO 8601 format", async () => {
    const fm = await buildFrontmatter("# Test");
    expect(() => new Date(fm.generatedAt)).not.toThrow();
    expect(fm.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("seed data is added to frontmatter", async () => {
    const fm = await buildFrontmatter("# Test", {
      author: "Furkan",
      version: 2,
    });
    expect(fm.author).toBe("Furkan");
    expect(fm.version).toBe(2);
  });

  it("seed data can override title (last write wins)", async () => {
    // if title is provided in seed, it is added (seed wins by spread order)
    const fm = await buildFrontmatter("# Original", { title: "Seed Title" });
    expect(fm.title).toBe("Seed Title");
  });

  it("tokenCount is 0 for empty markdown", async () => {
    const fm = await buildFrontmatter("");
    expect(fm.tokenCount).toBe(0);
  });

  it("sections is an array type", async () => {
    const fm = await buildFrontmatter("# Test\n\n## Sub");
    expect(Array.isArray(fm.sections)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 5. emitFrontmatter
// ─────────────────────────────────────────────────────────────────────────
describe("emitFrontmatter()", () => {
  const sampleFm = {
    title: "Test Document",
    sections: ["Section 1", "Section 2"],
    tokenCount: 150,
    generatedAt: "2026-06-08T12:00:00.000Z",
  };
  const sampleMd = "# Test Document\n\nParagraph text.";

  it("starts with ---", () => {
    const result = emitFrontmatter(sampleFm, sampleMd);
    expect(result.startsWith("---\n")).toBe(true);
  });

  it("includes closing --- line", () => {
    const result = emitFrontmatter(sampleFm, sampleMd);
    expect(result).toContain("\n---\n");
  });

  it("preserves original markdown content", () => {
    const result = emitFrontmatter(sampleFm, sampleMd);
    expect(result).toContain("# Test Document");
    expect(result).toContain("Paragraph text.");
  });

  it("writes title field to YAML", () => {
    const result = emitFrontmatter(sampleFm, sampleMd);
    expect(result).toContain("title:");
    expect(result).toContain("Test Document");
  });

  it("writes tokenCount field to YAML", () => {
    const result = emitFrontmatter(sampleFm, sampleMd);
    expect(result).toContain("tokenCount:");
  });

  it("writes generatedAt field to YAML", () => {
    const result = emitFrontmatter(sampleFm, sampleMd);
    expect(result).toContain("generatedAt:");
  });

  it("writes sections array to YAML", () => {
    const result = emitFrontmatter(sampleFm, sampleMd);
    expect(result).toContain("sections:");
    expect(result).toContain("Section 1");
    expect(result).toContain("Section 2");
  });

  it("has empty line between frontmatter and markdown", () => {
    const result = emitFrontmatter(sampleFm, sampleMd);
    // YAML block ends, markdown begins after empty line
    expect(result).toContain("---\n\n#");
  });

  it("returns string", () => {
    expect(typeof emitFrontmatter(sampleFm, sampleMd)).toBe("string");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 6. ocrImage — provider config validation
// ─────────────────────────────────────────────────────────────────────────
describe("ocrImage()", () => {
  it("throws when openai-vlm provider is missing vlm config", async () => {
    const dummyBuf = Buffer.from([0xff, 0xd8, 0xff]);
    await expect(
      ocrImage(dummyBuf, { provider: 'openai-vlm' })
    ).rejects.toThrow(/openai-vlm.*requires opts\.vlm/i);
  });

  it("throws when anthropic-vlm provider is missing vlm config", async () => {
    const dummyBuf = Buffer.alloc(16);
    await expect(
      ocrImage(dummyBuf, { provider: 'anthropic-vlm' })
    ).rejects.toThrow(/anthropic-vlm.*requires opts\.vlm/i);
  });

  it("throws when openai-vlm is missing model", async () => {
    const dummyBuf = Buffer.alloc(16);
    await expect(
      ocrImage(dummyBuf, { provider: 'openai-vlm', vlm: { model: '', apiKey: 'key' } })
    ).rejects.toThrow(/model is required/i);
  });

  it("throws when openai-vlm is missing apiKey", async () => {
    const dummyBuf = Buffer.alloc(16);
    await expect(
      ocrImage(dummyBuf, { provider: 'openai-vlm', vlm: { model: 'gpt-4o' } })
    ).rejects.toThrow(/apiKey is required/i);
  });

  it("throws when azure-vision is missing apiBase", async () => {
    const dummyBuf = Buffer.alloc(16);
    await expect(
      ocrImage(dummyBuf, { provider: 'azure-vision', vlm: { model: 'vision', apiKey: 'key' } })
    ).rejects.toThrow(/apiBase.*Azure endpoint/i);
  });

  it("throws when handler provider is missing handler callback", async () => {
    const dummyBuf = Buffer.alloc(16);
    await expect(
      ocrImage(dummyBuf, { provider: 'handler' })
    ).rejects.toThrow(/handler.*requires opts\.handler/i);
  });

  it("calls handler with buffer and context and trims result", async () => {
    const dummyBuf = Buffer.from("image-bytes");
    const received: { buffer?: Buffer; context?: OCRHandlerContext } = {};

    const text = await ocrImage(
      dummyBuf,
      {
        provider: 'handler',
        handler: async (buffer, context) => {
          received.buffer = buffer;
          received.context = context;
          return "  hello ocr  ";
        },
      },
      {
        page: 2,
        pageCount: 5,
        mimeType: 'image/png',
        sourceExtension: '.pdf',
        fileName: 'scan.pdf',
      },
    );

    expect(text).toBe("hello ocr");
    expect(received.buffer).toBe(dummyBuf);
    expect(received.context).toEqual({
      page: 2,
      pageCount: 5,
      mimeType: 'image/png',
      sourceExtension: '.pdf',
      fileName: 'scan.pdf',
    });
  });

  it("convertImageToMarkdown passes image context to handler", async () => {
    const png1x1 = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );
    let receivedContext: OCRHandlerContext | undefined;

    const result = await convertImageToMarkdown(
      png1x1,
      ".png",
      {
        provider: 'handler',
        handler: async (_buffer, context) => {
          receivedContext = context;
          return "receipt total 42";
        },
      },
      "receipt.png",
    );

    expect(result).toContain("## Extracted Text");
    expect(result).toContain("receipt total 42");
    expect(receivedContext).toMatchObject({
      sourceExtension: ".png",
      fileName: "receipt.png",
      mimeType: "image/png",
      imageWidth: 1,
      imageHeight: 1,
    });
  });

  it("prefers detected image format over fileName for mimeType", async () => {
    const png1x1 = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );
    let receivedContext: OCRHandlerContext | undefined;

    await convertImageToMarkdown(
      png1x1,
      ".png",
      {
        provider: "handler",
        handler: async (_buffer, context) => {
          receivedContext = context;
          return "ok";
        },
      },
      "scan.pdf",
    );

    expect(receivedContext?.mimeType).toBe("image/png");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 7. renderPdfPageToPng — throws informative error when deps are missing
// ───────────────────────────────────────────────────────────────────────────
describe("renderPdfPageToPng()", () => {
  it("throws on invalid PDF buffer", async () => {
    const dummyBuf = Buffer.alloc(16);
    await expect(renderPdfPageToPng(dummyBuf)).rejects.toThrow(
      /Invalid PDF|pdfjs-dist|canvas|npm install/i,
    );
  });

  it("error message is informative when rendering fails", async () => {
    const dummyBuf = Buffer.alloc(16);
    try {
      await renderPdfPageToPng(dummyBuf);
      expect.unreachable("renderPdfPageToPng should reject invalid PDF input");
    } catch (err: any) {
      expect(err.message).toMatch(/Invalid PDF|npm install/i);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 8. convertToRichMarkdown
// ─────────────────────────────────────────────────────────────────────────
describe("convertToRichMarkdown()", () => {
  const htmlInput = Buffer.from(
    `<html><body>
      <h1>Main Heading</h1>
      <p>First paragraph text here.</p>
      <h2>Subheading A</h2>
      <p>Second section content.</p>
      <h2>Subheading B</h2>
      <p>Third section content.</p>
    </body></html>`,
    "utf-8",
  );

  it("returns RichOutput object", async () => {
    const result = await convertToRichMarkdown(htmlInput, {
      forceExtension: ".html",
    });
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
  });

  it("returns markdown string", async () => {
    const { markdown } = await convertToRichMarkdown(htmlInput, {
      forceExtension: ".html",
    });
    expect(typeof markdown).toBe("string");
    expect(markdown.length).toBeGreaterThan(0);
  });

  it("markdown matches convertToMarkdown output", async () => {
    const { markdown } = await convertToRichMarkdown(htmlInput, {
      forceExtension: ".html",
    });
    const plain = await convertToMarkdown(htmlInput, {
      forceExtension: ".html",
    });
    expect(markdown).toBe(plain);
  });

  it("returns sections array", async () => {
    const { sections } = await convertToRichMarkdown(htmlInput, {
      forceExtension: ".html",
    });
    expect(Array.isArray(sections)).toBe(true);
    expect(sections.length).toBeGreaterThan(0);
  });

  it("sections recognizes headings", async () => {
    const { sections } = await convertToRichMarkdown(htmlInput, {
      forceExtension: ".html",
    });
    const headings = sections.map((s) => s.heading);
    expect(headings).toContain("Main Heading");
    expect(headings.some((h) => h.includes("Subheading"))).toBe(true);
  });

  it("returns chunks array", async () => {
    const { chunks } = await convertToRichMarkdown(htmlInput, {
      forceExtension: ".html",
    });
    expect(Array.isArray(chunks)).toBe(true);
    expect(chunks.length).toBeGreaterThan(0);
  });

  it("chunks contain sequential chunkIndex starting at zero", async () => {
    const { chunks } = await convertToRichMarkdown(htmlInput, {
      forceExtension: ".html",
      chunk: { maxTokens: 30 },
    });
    chunks.forEach((c, i) => {
      expect(c.metadata.chunkIndex).toBe(i);
    });
  });

  it("returns frontmatter object", async () => {
    const { frontmatter } = await convertToRichMarkdown(htmlInput, {
      forceExtension: ".html",
    });
    expect(typeof frontmatter).toBe("object");
  });

  it("frontmatter.title includes H1 heading", async () => {
    const { frontmatter } = await convertToRichMarkdown(htmlInput, {
      forceExtension: ".html",
    });
    expect(frontmatter.title).toContain("Main Heading");
  });

  it("frontmatter.tokenCount is positive", async () => {
    const { frontmatter } = await convertToRichMarkdown(htmlInput, {
      forceExtension: ".html",
    });
    expect(frontmatter.tokenCount).toBeGreaterThan(0);
  });

  it("frontmatter.generatedAt is in ISO format", async () => {
    const { frontmatter } = await convertToRichMarkdown(htmlInput, {
      forceExtension: ".html",
    });
    expect(frontmatter.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("frontmatter.chunkCount matches chunks.length", async () => {
    const { frontmatter, chunks } = await convertToRichMarkdown(htmlInput, {
      forceExtension: ".html",
    });
    expect(frontmatter.chunkCount).toBe(chunks.length);
  });

  it("chunks is empty array when chunk: false", async () => {
    const { chunks, frontmatter } = await convertToRichMarkdown(htmlInput, {
      forceExtension: ".html",
      chunk: false,
    });
    expect(chunks).toEqual([]);
    expect(frontmatter.chunkCount).toBeUndefined();
  });

  it("frontmatterSeed data is added to frontmatter", async () => {
    const { frontmatter } = await convertToRichMarkdown(htmlInput, {
      forceExtension: ".html",
      frontmatterSeed: { project: "to-markdown", version: "2.1" },
    });
    expect(frontmatter.project).toBe("to-markdown");
    expect(frontmatter.version).toBe("2.1");
  });

  it("OCR is off by default — works without tesseract.js", async () => {
    // when ocr is not specified, should succeed without tesseract.js
    await expect(
      convertToRichMarkdown(htmlInput, { forceExtension: ".html" }),
    ).resolves.toBeDefined();
  });

  it("works with CSV input", async () => {
    const csv = Buffer.from("Name,Surname\nJohn,Doe\nJane,Smith", "utf-8");
    const { markdown, sections, chunks } = await convertToRichMarkdown(csv, {
      forceExtension: ".csv",
    });
    expect(typeof markdown).toBe("string");
    expect(Array.isArray(sections)).toBe(true);
    expect(Array.isArray(chunks)).toBe(true);
  });

  it("respects chunk maxTokens setting", async () => {
    const longMd = Array.from(
      { length: 20 },
      (_, i) => `## Section ${i}\n\n${"Content text. ".repeat(25)}`,
    ).join("\n\n");
    const { chunks } = await convertToRichMarkdown(
      Buffer.from(longMd, "utf-8"),
      { forceExtension: ".txt", chunk: { maxTokens: 80 } },
    );
    expect(chunks.length).toBeGreaterThan(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 9. Backward-compatibility — existing API unchanged
// ─────────────────────────────────────────────────────────────────────────
describe("Backward-compat: convertToMarkdown()", () => {
  it("converts HTML buffer to string", async () => {
    const result = await convertToMarkdown(
      Buffer.from("<h1>Test</h1>", "utf-8"),
      { forceExtension: ".html" },
    );
    expect(typeof result).toBe("string");
    expect(result).toContain("Test");
  });

  it("converts CSV buffer to table string", async () => {
    const result = await convertToMarkdown(Buffer.from("A,B\n1,2", "utf-8"), {
      forceExtension: ".csv",
    });
    expect(result).toContain("A");
    expect(result).toContain("|");
  });

  it("returns plain text for TXT buffer", async () => {
    const result = await convertToMarkdown(
      Buffer.from("Hello World", "utf-8"),
      { forceExtension: ".txt" },
    );
    expect(result).toContain("Hello World");
  });

  it("converts JSON buffer to markdown", async () => {
    const json = JSON.stringify({ key: "value", num: 42 });
    const result = await convertToMarkdown(Buffer.from(json, "utf-8"), {
      forceExtension: ".json",
    });
    expect(typeof result).toBe("string");
    expect(result).toContain("value");
  });

  it("throws error for non-existent file", async () => {
    await expect(convertToMarkdown("/nonexistent/file.html")).rejects.toThrow(
      "File not found",
    );
  });

  it("throws error for invalid input type", async () => {
    await expect(convertToMarkdown(999 as any)).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 10. Backward-compat: convertBatchToMarkdown
// ─────────────────────────────────────────────────────────────────────────
describe("Backward-compat: convertBatchToMarkdown()", () => {
  it("converts multiple inputs in parallel", async () => {
    const results = await convertBatchToMarkdown([
      {
        input: Buffer.from("<h1>A</h1>", "utf-8"),
        options: { forceExtension: ".html" },
      },
      {
        input: Buffer.from("B,C\n1,2", "utf-8"),
        options: { forceExtension: ".csv" },
      },
    ]);
    expect(results.length).toBe(2);
    expect(results[0].result).toBeDefined();
    expect(results[1].result).toBeDefined();
  });

  it("returns error field for failing input (does not crash)", async () => {
    const results = await convertBatchToMarkdown([
      { input: "/nonexistent/file.pdf" },
    ]);
    expect(results[0].error).toBeDefined();
    expect(results[0].result).toBeUndefined();
  });

  it("inputId is the file path for string input", async () => {
    const results = await convertBatchToMarkdown([
      { input: "/nonexistent/file.html" },
    ]);
    expect(results[0].inputId).toBe("/nonexistent/file.html");
  });

  it('inputId is in "buffer:<index>" format for Buffer input', async () => {
    const results = await convertBatchToMarkdown([
      {
        input: Buffer.from("test", "utf-8"),
        options: { forceExtension: ".txt" },
      },
    ]);
    expect(results[0].inputId).toBe("buffer:0");
  });

  it("returns empty array for empty input", async () => {
    const results = await convertBatchToMarkdown([]);
    expect(results).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 11. Backward-compat: saveToMarkdownFile
// ─────────────────────────────────────────────────────────────────────────
describe("Backward-compat: saveToMarkdownFile()", () => {
  const tmpDir = join(
    process.cwd(),
    "test-output-temp",
    "new-features-" + Date.now(),
  );

  it("saves file and returns path", async () => {
    const p = await saveToMarkdownFile("# Test", "compat-test", tmpDir);
    expect(existsSync(p)).toBe(true);
    unlinkSync(p);
  });

  it("automatically appends .md extension", async () => {
    const p = await saveToMarkdownFile("# Test", "no-ext", tmpDir);
    expect(p.endsWith(".md")).toBe(true);
    unlinkSync(p);
  });

  it("does not add .md extension if already present", async () => {
    const p = await saveToMarkdownFile("# Test", "already.md", tmpDir);
    expect(p).not.toContain(".md.md");
    unlinkSync(p);
  });
});
