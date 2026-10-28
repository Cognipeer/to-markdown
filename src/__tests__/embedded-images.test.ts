/**
 * Embedded image policy (`images`) and OCR of embedded images
 * (`ocr.embeddedImages`) for DOCX / PPTX / HTML / EPUB. Uses the `handler`
 * provider only (no network, no tesseract).
 */
import AdmZip from "adm-zip";
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { convertToMarkdown, convertToMarkdownDetailed } from "../convert.ts";
import { replaceImageTokens } from "../utils/embeddedImages.ts";
import type { ConverterOptions, OCRHandlerContext } from "../types/index.ts";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "ocr");
const DEFAULT_EPUB = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "benchmark", "test_files", "test.epub");
const load = (name: string) => readFileSync(join(FIXTURES, name));

const DOCX = load("images.docx");
const PPTX = load("slides.pptx");
const HTML = load("images.html");

/** Records every call and answers `OCR <n>` + a second line. */
function recordingHandler(delayFor?: (ctx: OCRHandlerContext) => number) {
  const calls: Array<{ ctx: OCRHandlerContext; size: number }> = [];
  const handler = async (buffer: Buffer, ctx: OCRHandlerContext) => {
    calls.push({ ctx, size: buffer.length });
    const delay = delayFor?.(ctx) ?? 0;
    if (delay) await new Promise((r) => setTimeout(r, delay));
    return `OCR ${ctx.index}\nsecond line`;
  };
  return { handler, calls };
}

const ocrOptions = (handler: any, extra: Record<string, unknown> = {}, embedded: unknown = true) => ({
  provider: "handler" as const,
  handler,
  embeddedImages: embedded as any,
  ...extra,
});

const convert = (buffer: Buffer, fileName: string, options: ConverterOptions = {}) =>
  convertToMarkdown(buffer, { fileName, ...options });
const detailed = (buffer: Buffer, fileName: string, options: ConverterOptions = {}) =>
  convertToMarkdownDetailed(buffer, { fileName, ...options });

/** DOCX whose third picture (invoice.png) is byte-identical to the second (policy.png). */
function duplicateDocx(): Buffer {
  const zip = new AdmZip(DOCX);
  zip.updateFile("word/media/invoice.png", zip.getEntry("word/media/policy.png")!.getData());
  return zip.toBuffer();
}

function buildEpub(chapterHtml: string): Buffer {
  const zip = new AdmZip();
  zip.addFile("mimetype", Buffer.from("application/epub+zip"));
  zip.addFile(
    "META-INF/container.xml",
    Buffer.from(
      `<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile media-type="application/oebps-package+xml" full-path="OEBPS/content.opf"/></rootfiles></container>`
    )
  );
  zip.addFile(
    "OEBPS/content.opf",
    Buffer.from(
      `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Pictures</dc:title><dc:creator>Author</dc:creator></metadata><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>`
    )
  );
  zip.addFile("OEBPS/c1.xhtml", Buffer.from(chapterHtml));
  return zip.toBuffer();
}

const PNG_DATA_URI = `data:image/png;base64,${load("sample.png").toString("base64")}`;
const EPUB = buildEpub(
  `<html><body><h1>Chapter</h1><p>Intro</p><p><img src="${PNG_DATA_URI}" alt="Inline art"/></p><p><img src="images/cover.jpg" alt="Cover"/></p><p>Outro</p></body></html>`
);

const dataUris = (md: string) => (md.match(/\]\(data:image\/[a-z+]+;base64,/g) ?? []).length;

describe("default output is unchanged", () => {
  it("images: 'inline' and plain ocr options keep 3.5.0 output for DOCX / PPTX / HTML", async () => {
    const { handler, calls } = recordingHandler();
    for (const [buffer, name] of [
      [DOCX, "images.docx"],
      [PPTX, "slides.pptx"],
      [HTML, "images.html"],
    ] as const) {
      const base = await convert(buffer, name);
      expect(await convert(buffer, name, { images: "inline" })).toBe(base);
      expect(await convert(buffer, name, { ocr: { provider: "handler", handler } })).toBe(base);
      expect(await convert(buffer, name, { ocr: { provider: "handler", handler, embeddedImages: false } })).toBe(base);
    }
    expect(calls).toHaveLength(0);
  });

  it("keeps data URIs for DOCX / HTML and no pictures for PPTX by default", async () => {
    expect(dataUris(await convert(DOCX, "images.docx"))).toBe(4);
    expect(dataUris(await convert(HTML, "images.html"))).toBe(2);
    const pptx = await convert(PPTX, "slides.pptx");
    expect(pptx).not.toContain("![");
    expect(pptx).toContain("<!-- ppt/slides/slide1.xml -->");
  });

  it("reports no images when the feature is off", async () => {
    const result = await detailed(DOCX, "images.docx", { ocr: { provider: "handler", handler: async () => "x" } });
    expect(result.images).toBeUndefined();
  });
});

describe("DOCX embedded images", () => {
  it("placeholder: numbers pictures in document order and keeps alt text", async () => {
    const md = await convert(DOCX, "images.docx", { images: "placeholder" });
    expect(md).toBe(
      [
        "![](image-1.png) Cognipeer Test Report",
        "Introduction paragraph before the first picture.",
        "![Scanned security policy page](image-2.png)",
        "Text between the two pictures.",
        "![Invoice summary screenshot](image-3.png)",
        "![](image-4.png) End of document",
      ].join("\n\n")
    );
    expect(md).not.toContain("base64");
  });

  it("omit: drops the pictures without leaving empty artefacts", async () => {
    const md = await convert(DOCX, "images.docx", { images: "omit" });
    expect(md).toBe(
      [
        "Cognipeer Test Report",
        "Introduction paragraph before the first picture.",
        "Text between the two pictures.",
        "End of document",
      ].join("\n\n")
    );
  });

  it("inline + OCR keeps the data URI and puts the OCR text in a blockquote after the image", async () => {
    const { handler } = recordingHandler();
    const md = await convert(DOCX, "images.docx", { images: "inline", ocr: ocrOptions(handler) });
    expect(dataUris(md)).toBe(4);
    const lines = md.split("\n");
    const policy = lines.findIndex((l) => l.startsWith("![Scanned security policy page](data:image/png;base64,"));
    expect(policy).toBeGreaterThan(-1);
    expect(lines.slice(policy + 1, policy + 5)).toEqual(["", "> OCR 1", "> second line", ""]);
    expect(lines[policy + 5]).toBe("Text between the two pictures.");
    const invoice = lines.findIndex((l) => l.startsWith("![Invoice summary screenshot]("));
    expect(lines.slice(invoice + 1, invoice + 4)).toEqual(["", "> OCR 2", "> second line"]);
  });

  it("placeholder + OCR keeps the placeholder and adds the blockquote", async () => {
    const { handler } = recordingHandler();
    const md = await convert(DOCX, "images.docx", { images: "placeholder", ocr: ocrOptions(handler) });
    expect(md).toContain("![Scanned security policy page](image-2.png)\n\n> OCR 1\n> second line\n\nText between");
    expect(md).not.toContain("base64");
  });

  it("omit + OCR leaves only the blockquote", async () => {
    const { handler } = recordingHandler();
    const md = await convert(DOCX, "images.docx", { images: "omit", ocr: ocrOptions(handler) });
    expect(md).toBe(
      [
        "Cognipeer Test Report",
        "Introduction paragraph before the first picture.",
        "> OCR 1\n> second line",
        "Text between the two pictures.",
        "> OCR 2\n> second line",
        "End of document",
      ].join("\n\n")
    );
  });

  it("OCR alone (images unset) keeps today's data URIs", async () => {
    const { handler, calls } = recordingHandler();
    const md = await convert(DOCX, "images.docx", { ocr: ocrOptions(handler) });
    expect(dataUris(md)).toBe(4);
    expect(md).toContain("> OCR 1");
    expect(calls).toHaveLength(2);
  });

  it("hands the handler kind, index, sourcePath and mimeType", async () => {
    const { handler, calls } = recordingHandler();
    await convert(DOCX, "images.docx", { ocr: ocrOptions(handler) });
    expect(calls.map((c) => c.ctx.kind)).toEqual(["embedded-image", "embedded-image"]);
    expect(calls.map((c) => c.ctx.index)).toEqual([1, 2]);
    expect(calls.map((c) => c.ctx.sourcePath)).toEqual(["word/media/policy.png", "word/media/invoice.png"]);
    expect(calls.map((c) => c.ctx.mimeType)).toEqual(["image/png", "image/png"]);
    expect(calls[0].ctx.fileName).toBe("images.docx");
    expect(calls[0].ctx.imageWidth).toBe(1200);
    expect(calls[0].size).toBeGreaterThan(30000);
  });

  it("skips small images (the 16x16 logo) and reports them", async () => {
    const { handler, calls } = recordingHandler();
    const result = await detailed(DOCX, "images.docx", { ocr: ocrOptions(handler) });
    expect(calls.map((c) => c.ctx.sourcePath)).not.toContain("word/media/logo.png");
    expect(result.images?.map((i) => i.skipped)).toEqual(["small", undefined, undefined, "small"]);
    expect(result.images?.[0]).toMatchObject({ index: 0, kind: "embedded-image", width: 16, height: 16, ocr: false });
  });

  it("minWidth/minHeight are configurable", async () => {
    const { handler, calls } = recordingHandler();
    const result = await detailed(DOCX, "images.docx", {
      ocr: ocrOptions(handler, {}, { minWidth: 8, minHeight: 8 }),
    });
    // the logo is now OCRed once; its second occurrence is a duplicate
    expect(calls).toHaveLength(3);
    expect(result.images?.map((i) => i.skipped)).toEqual([undefined, undefined, undefined, "duplicate"]);
  });

  it("dedupes identical pictures by sha1 (duplicates keep only the placeholder)", async () => {
    const { handler, calls } = recordingHandler();
    const result = await detailed(duplicateDocx(), "dup.docx", {
      images: "placeholder",
      ocr: ocrOptions(handler),
    });
    expect(calls).toHaveLength(1);
    expect(result.images?.map((i) => i.skipped)).toEqual(["small", undefined, "duplicate", "small"]);
    expect(result.markdown).toContain("![Invoice summary screenshot](image-3.png)");
    expect(result.markdown.match(/> OCR/g)).toHaveLength(1);
    expect(result.markdown.indexOf("> OCR 1")).toBeLessThan(result.markdown.indexOf("image-3.png"));
  });

  it("dedupe: false OCRs every copy", async () => {
    const { handler, calls } = recordingHandler();
    await convert(duplicateDocx(), "dup.docx", { ocr: ocrOptions(handler, {}, { dedupe: false }) });
    expect(calls).toHaveLength(2);
  });

  it("maxImages caps OCR and warns", async () => {
    const { handler, calls } = recordingHandler();
    const result = await detailed(DOCX, "images.docx", { ocr: ocrOptions(handler, {}, { maxImages: 1 }) });
    expect(calls).toHaveLength(1);
    expect(result.images?.map((i) => i.skipped)).toEqual(["small", undefined, "limit", "small"]);
    expect(result.warnings.some((w) => w.startsWith("ocr_image_limit: 2 images, 1 processed"))).toBe(true);
    expect(result.markdown).toContain("> OCR 1");
    expect(result.markdown).not.toContain("> OCR 2");
  });

  it("fills the image reports and OCR stats", async () => {
    const { handler } = recordingHandler();
    const result = await detailed(DOCX, "images.docx", { ocr: ocrOptions(handler) });
    expect(result.images).toHaveLength(4);
    expect(result.images?.[1]).toMatchObject({
      index: 1,
      kind: "embedded-image",
      path: "word/media/policy.png",
      ocr: true,
      chars: "OCR1secondline".length,
    });
    expect(result.stats).toMatchObject({ ocrCalls: 2, ocrImages: 2 });
    expect(result.warnings).toEqual([]);
  });

  it("keeps document order of the OCR text with concurrency", async () => {
    const { handler } = recordingHandler((ctx) => (ctx.index === 1 ? 60 : 0));
    const md = await convert(DOCX, "images.docx", { ocr: ocrOptions(handler, { concurrency: 3 }) });
    expect(md.indexOf("> OCR 1")).toBeLessThan(md.indexOf("> OCR 2"));
    expect(md.indexOf("> OCR 1")).toBeGreaterThan(md.indexOf("Introduction paragraph"));
    expect(md.indexOf("> OCR 2")).toBeGreaterThan(md.indexOf("Text between"));
  });
});

describe("embedded image OCR errors", () => {
  const failing = async () => {
    throw new Error("engine down");
  };

  it("default skips the failed image but warns and reports it", async () => {
    const result = await detailed(DOCX, "images.docx", { ocr: ocrOptions(failing) });
    expect(result.markdown).not.toContain("OCR failed");
    expect(result.warnings).toContain("ocr_image_failed: word/media/policy.png: engine down");
    expect(result.images?.[1].error).toBe("engine down");
  });

  it("onError: 'comment' leaves a comment after the image", async () => {
    const md = await convert(DOCX, "images.docx", { ocr: ocrOptions(failing, { onError: "comment" }) });
    expect(md).toContain("<!-- OCR failed (image 2): engine down -->");
  });

  it("onError: 'throw' rejects the conversion", async () => {
    await expect(
      convert(DOCX, "images.docx", { ocr: ocrOptions(failing, { onError: "throw" }) })
    ).rejects.toThrow("engine down");
  });

  it("an aborted signal is never swallowed by onError", async () => {
    const controller = new AbortController();
    const handler = async () => {
      controller.abort();
      await new Promise((r) => setTimeout(r, 20));
      return "late";
    };
    await expect(
      convert(DOCX, "images.docx", { ocr: ocrOptions(handler, { signal: controller.signal, onError: "skip" }) })
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("a timeout becomes an ocr_timeout warning", async () => {
    const slow = async () => {
      await new Promise((r) => setTimeout(r, 200));
      return "late";
    };
    const result = await detailed(DOCX, "images.docx", { ocr: ocrOptions(slow, { timeoutMs: 20 }) });
    expect(result.warnings.some((w) => w.startsWith("ocr_timeout: word/media/policy.png"))).toBe(true);
  });
});

describe("PPTX embedded images", () => {
  it("placeholder lists the pictures with their description as alt text", async () => {
    const md = await convert(PPTX, "slides.pptx", { images: "placeholder" });
    expect(md).toBe(
      [
        "<!-- ppt/slides/slide1.xml --> Product Roadmap 2026 Native slide text on slide one. Ürün yol haritası özeti",
        "![Roadmap chart screenshot](image1.png)",
        "<!-- ppt/slides/slide2.xml --> Customer Success Native slide text on slide two. Müşteri başarı metrikleri",
        "![Customer metrics table scan](image2.png)",
      ].join("\n\n")
    );
  });

  it("omit without OCR is identical to the default output", async () => {
    expect(await convert(PPTX, "slides.pptx", { images: "omit" })).toBe(await convert(PPTX, "slides.pptx"));
  });

  it("OCR puts the blockquote right after the picture and passes the slide", async () => {
    const { handler, calls } = recordingHandler();
    const md = await convert(PPTX, "slides.pptx", { ocr: ocrOptions(handler) });
    expect(md).toContain("![Roadmap chart screenshot](image1.png)\n\n> OCR 0\n> second line\n\n<!-- ppt/slides/slide2.xml -->");
    expect(md.trimEnd().endsWith("> OCR 1\n> second line")).toBe(true);
    expect(calls.map((c) => [c.ctx.slide, c.ctx.sourcePath, c.ctx.kind, c.ctx.mimeType])).toEqual([
      [1, "ppt/media/image1.png", "embedded-image", "image/png"],
      [2, "ppt/media/image2.png", "embedded-image", "image/png"],
    ]);
  });

  it("omit + OCR keeps only the OCR text", async () => {
    const { handler } = recordingHandler();
    const md = await convert(PPTX, "slides.pptx", { images: "omit", ocr: ocrOptions(handler) });
    expect(md).not.toContain("![");
    expect(md).toContain("slide one. Ürün yol haritası özeti\n\n> OCR 0\n> second line");
  });

  it("dedupes a picture used on several slides", async () => {
    const zip = new AdmZip(PPTX);
    zip.updateFile("ppt/media/image2.png", zip.getEntry("ppt/media/image1.png")!.getData());
    const { handler, calls } = recordingHandler();
    const result = await detailed(zip.toBuffer(), "dup.pptx", { ocr: ocrOptions(handler) });
    expect(calls).toHaveLength(1);
    expect(result.images?.map((i) => i.skipped)).toEqual([undefined, "duplicate"]);
    expect(result.markdown).toContain("![Customer metrics table scan](image2.png)");
  });

  it("does not write temp_pptx_* files into process.cwd()", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tm-pptx-cwd-"));
    const original = process.cwd();
    try {
      let changed = false;
      try {
        process.chdir(dir);
        changed = true;
      } catch {
        /* chdir unsupported in this worker */
      }
      // A read-only cwd makes any attempt to write there fail the conversion.
      if (changed) chmodSync(dir, 0o555);
      const md = await convert(PPTX, "slides.pptx");
      const md2 = await convert(PPTX, "slides.pptx", { images: "placeholder" });
      expect(md).toContain("Product Roadmap 2026");
      expect(md2).toContain("image1.png");
      if (changed) {
        expect(readdirSync(dir)).toEqual([]);
      }
      // wherever the cwd is, no temp file may be left behind
      expect(readdirSync(process.cwd()).filter((f) => f.startsWith("temp_pptx_"))).toEqual([]);
    } finally {
      process.chdir(original);
      chmodSync(dir, 0o755);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not leave temp files in the repo root either", async () => {
    await convert(PPTX, "slides.pptx");
    expect(readdirSync(process.cwd()).filter((f) => f.startsWith("temp_pptx_"))).toEqual([]);
  });
});

describe("HTML embedded images", () => {
  afterEach(() => vi.restoreAllMocks());

  it("placeholder replaces data URIs and keeps remote sources", async () => {
    const md = await convert(HTML, "images.html", { images: "placeholder" });
    expect(md).toContain("![Embedded scan one](image-1.png)");
    expect(md).toContain("![Embedded scan two](image-2.png)");
    expect(md).toContain("![Remote logo](https://example.com/assets/remote-logo.png)");
    expect(md).not.toContain("base64");
  });

  it("omit removes every <img>", async () => {
    const md = await convert(HTML, "images.html", { images: "omit" });
    expect(md).toBe(
      "# Embedded images\n\nFirst paragraph before the images.\n\nText between the images.\n\nClosing paragraph."
    );
  });

  it("OCR decodes data URIs, never fetches URLs", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { handler, calls } = recordingHandler();
    const result = await detailed(HTML, "images.html", { ocr: ocrOptions(handler) });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.ctx.mimeType)).toEqual(["image/png", "image/png"]);
    expect(calls.map((c) => c.ctx.kind)).toEqual(["embedded-image", "embedded-image"]);
    expect(result.markdown).toContain("![Embedded scan one](data:image/png;base64,");
    expect(result.markdown).toContain("> OCR 0\n> second line\n\nText between the images.");
    expect(result.markdown).toContain("![Remote logo](https://example.com/assets/remote-logo.png)\n\nClosing paragraph.");
    expect(result.images).toHaveLength(2);
  });

  it("does not OCR images in navigation or scripts", async () => {
    const html = `<html><body><nav><img src="${PNG_DATA_URI}" alt="nav"></nav><p>Body</p><p><img src="${PNG_DATA_URI}" alt="content" title="Title"></p></body></html>`;
    const { handler, calls } = recordingHandler();
    const md = await convert(Buffer.from(html), "page.html", { ocr: ocrOptions(handler) });
    expect(calls).toHaveLength(1);
    expect(md).toContain(`![content](${PNG_DATA_URI} "Title")\n\n> OCR 0`);
  });

  it("handles percent-encoded (non-base64) SVG data URIs without crashing", async () => {
    const html = `<p>x</p><p><img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10'%3E%3C/svg%3E" alt="vector"></p>`;
    const md = await convert(Buffer.from(html), "svg.html", { images: "placeholder" });
    expect(md).toContain("![vector](image-1.svg)");
  });

  it("htmlToMarkdown / convertHtmlToMarkdown stay synchronous", async () => {
    const { convertHtmlToMarkdown, htmlToMarkdown } = await import("../converters/html.ts");
    expect(typeof convertHtmlToMarkdown("<p>a</p>")).toBe("string");
    expect(typeof htmlToMarkdown("<p>a</p>")).toBe("string");
  });
});

describe("EPUB embedded images", () => {
  it("default output is unchanged", async () => {
    const base = await convert(EPUB, "book.epub");
    expect(await convert(EPUB, "book.epub", { images: "inline" })).toBe(base);
    expect(base).toContain("![Inline art](data:image/png;base64,");
    expect(base).toContain("![Cover](images/cover.jpg)");
    const sample = readFileSync(DEFAULT_EPUB);
    expect(await convert(sample, "test.epub", { images: "inline" })).toBe(await convert(sample, "test.epub"));
  });

  it("placeholder replaces data URIs and keeps relative sources", async () => {
    const md = await convert(EPUB, "book.epub", { images: "placeholder" });
    expect(md).toContain("![Inline art](image-1.png)");
    expect(md).toContain("![Cover](images/cover.jpg)");
    expect(md).not.toContain("base64");
  });

  it("omit removes the images", async () => {
    const md = await convert(EPUB, "book.epub", { images: "omit" });
    expect(md).not.toContain("![");
    expect(md).toContain("Intro");
    expect(md).toContain("Outro");
  });

  it("does not OCR EPUB images and says so", async () => {
    const { handler, calls } = recordingHandler();
    const result = await detailed(EPUB, "book.epub", { images: "placeholder", ocr: ocrOptions(handler) });
    expect(calls).toHaveLength(0);
    expect(result.warnings).toContain("embedded_image_ocr_unsupported: EPUB images are not OCRed");
    expect(result.markdown).not.toContain("> OCR");
    const plain = await detailed(EPUB, "book.epub", { ocr: ocrOptions(handler) });
    expect(plain.warnings).toContain("embedded_image_ocr_unsupported: EPUB images are not OCRed");
    expect(plain.markdown).toBe(await convert(EPUB, "book.epub"));
  });
});

describe("replaceImageTokens", () => {
  const token = (id: number, alt = "", title = "") => `![${alt}](tmimg://${id}${title})`;

  it("keeps the title and several tokens on one line", () => {
    const md = `${token(0, "a")} and ${token(1, "b", ' "T"')}`;
    const out = replaceImageTokens(md, (id, alt, title) => ({ image: `![${alt}](x${id}${title})` }));
    expect(out).toBe('![a](x0) and ![b](x1 "T")');
  });

  it("removes a leading image without a stray space", () => {
    expect(replaceImageTokens(`${token(0)} Heading`, () => ({ image: "" }))).toBe("Heading");
    expect(replaceImageTokens(`line\n${token(0)} text`, () => ({ image: "" }))).toBe("line\ntext");
  });

  it("leaves lookalikes alone", () => {
    const md = "text ](tmimg://x) and ![broken](tmimg://";
    expect(replaceImageTokens(md, () => ({ image: "!" }))).toBe(md);
  });
});

describe("repository hygiene", () => {
  it("fixtures exist", () => {
    for (const name of ["images.docx", "slides.pptx", "images.html"]) {
      expect(existsSync(join(FIXTURES, name))).toBe(true);
    }
  });
});
