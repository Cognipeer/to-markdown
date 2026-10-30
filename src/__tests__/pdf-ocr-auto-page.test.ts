import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { convertToMarkdown, convertToMarkdownDetailed } from "../index.ts";
import { garbledRatio } from "../converters/pdf.ts";
import type {
  OCRDocumentHandlerContext,
  OCRHandler,
  OCRHandlerContext,
  OCROptions,
} from "../types/index.ts";

const fixture = (name: string): Buffer =>
  readFileSync(new URL(`./fixtures/ocr/${name}`, import.meta.url));
const MIXED = fixture("mixed.pdf");
const SCAN = fixture("scan.pdf");
const STAMP = fixture("stamp.pdf");
const GARBLED = fixture("garbled.pdf");
const NATIVE = readFileSync(new URL("../../benchmark/test_files/test.pdf", import.meta.url));

// Builds a PDF with a correct xref table from object bodies (object 1 must be the catalog).
const buildPdf = (objects: string[]): Buffer => {
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, "latin1");
};

// One page with a short text layer (10 chars) and no raster image.
const SHORT_TEXT_NO_IMAGE = buildPdf([
  "<</Type/Catalog/Pages 2 0 R>>",
  "<</Type/Pages/Kids[3 0 R]/Count 1>>",
  "<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 120]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>",
  "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
  "<</Length 44>>\nstream\nBT /F1 24 Tf 20 40 Td (Short text) Tj ET\nendstream",
]);

/** Records every call and answers `OCR p<page>`. */
function recorder(answer: (ctx: OCRHandlerContext) => string = (c) => `OCR p${c.page}`) {
  const calls: Array<{ buffer: Buffer; ctx: OCRHandlerContext }> = [];
  const handler: OCRHandler = async (buffer, ctx) => {
    calls.push({ buffer, ctx });
    return answer(ctx);
  };
  return { calls, handler };
}

const opts = (handler: OCRHandler, extra: Partial<OCROptions> = {}): OCROptions => ({
  provider: "handler",
  pdfMode: "auto-page",
  handler,
  ...extra,
});

const detailed = (pdf: Buffer, ocr: OCROptions) =>
  convertToMarkdownDetailed(pdf, { forceExtension: ".pdf", ocr });

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("pdfMode 'auto-page' - candidate selection", () => {
  it("OCRs only the image-only page of a mixed PDF and keeps page order", async () => {
    const { calls, handler } = recorder();
    const result = await detailed(MIXED, opts(handler));

    expect(calls.map((c) => c.ctx.page)).toEqual([2]);
    expect(calls[0].ctx).toMatchObject({
      page: 2,
      pageCount: 3,
      mimeType: "image/png",
      sourceExtension: ".pdf",
      kind: "pdf-page",
    });
    const md = result.markdown;
    const p1 = md.indexOf("Native Page 1");
    const p2 = md.indexOf("OCR p2");
    const p3 = md.indexOf("Native Page 3");
    expect(p1).toBeGreaterThanOrEqual(0);
    expect(p2).toBeGreaterThan(p1);
    expect(p3).toBeGreaterThan(p2);
    expect(md).toContain("\n\nOCR p2\n\n");

    expect(result.pages?.map((p) => [p.page, p.source, p.reason])).toEqual([
      [1, "text", undefined],
      [2, "ocr", "no-text"],
      [3, "text", undefined],
    ]);
    expect(result.pages?.[1].chars).toBe(5);
    expect(result.stats).toMatchObject({ pageCount: 3, ocrCalls: 1, ocrPages: 1 });
    expect(result.warnings).toEqual([]);
  });

  it("reports every page of a scan as no-text", async () => {
    const { calls, handler } = recorder();
    const result = await detailed(SCAN, opts(handler));
    expect(calls.map((c) => c.ctx.page)).toEqual([1, 2]);
    expect(result.markdown).toBe("OCR p1\n\nOCR p2");
    expect(result.pages?.map((p) => p.reason)).toEqual(["no-text", "no-text"]);
  });

  it("treats a scan with a short stamp text layer as low-text", async () => {
    const { calls, handler } = recorder();
    const result = await detailed(STAMP, opts(handler));
    expect(calls).toHaveLength(1);
    expect(result.markdown).toBe("OCR p1");
    expect(result.pages?.[0]).toMatchObject({ page: 1, source: "ocr", reason: "low-text" });
  });

  it("flags a garbled text layer and keeps the clean native page", async () => {
    const { calls, handler } = recorder();
    const result = await detailed(GARBLED, opts(handler));
    expect(calls.map((c) => c.ctx.page)).toEqual([1]);
    expect(result.pages?.[0]).toMatchObject({ page: 1, source: "ocr", reason: "garbled" });
    expect(result.pages?.[1]).toMatchObject({ page: 2, source: "text" });
    expect(result.markdown.startsWith("OCR p1\n\nGarbled fixture - native page 2")).toBe(true);
  });

  it("does not flag the garbled page when the garbled check is disabled", async () => {
    const { calls, handler } = recorder();
    const result = await detailed(GARBLED, opts(handler, { pageTrigger: { maxGarbledRatio: 0, requireImage: false } }));
    // The text layer is about 40 chars: not low-text either with minChars 32.
    expect(calls).toHaveLength(0);
    expect(result.pages?.[0].source).toBe("text");
  });

  it("honours minChars and requireImage for pages with a short text layer", async () => {
    const none = recorder();
    // 9 characters, no raster image: not a candidate by default.
    await detailed(SHORT_TEXT_NO_IMAGE, opts(none.handler));
    expect(none.calls).toHaveLength(0);

    const forced = recorder();
    const r = await detailed(SHORT_TEXT_NO_IMAGE, opts(forced.handler, { pageTrigger: { requireImage: false } }));
    expect(forced.calls).toHaveLength(1);
    expect(r.pages?.[0]).toMatchObject({ source: "ocr", reason: "low-text" });

    const lower = recorder();
    await detailed(SHORT_TEXT_NO_IMAGE, opts(lower.handler, { pageTrigger: { requireImage: false, minChars: 5 } }));
    expect(lower.calls).toHaveLength(0);
  });

  it("is a no-op for a PDF whose pages all have text: output equals the no-OCR output", async () => {
    const { calls, handler } = recorder();
    const withOcr = await convertToMarkdown(NATIVE, { forceExtension: ".pdf", ocr: opts(handler) });
    const without = await convertToMarkdown(NATIVE, { forceExtension: ".pdf" });
    expect(calls).toHaveLength(0);
    expect(withOcr).toBe(without);
  });

  it("garbledRatio counts replacement, control and private-use characters", () => {
    expect(garbledRatio("")).toBe(0);
    expect(garbledRatio("plain text")).toBe(0);
    expect(garbledRatio("ab�")).toBe(0.5);
    expect(garbledRatio("a\u0001 b\u0002")).toBe(0.5);
    expect(garbledRatio("\uE000\uE001")).toBe(1);
  });
});

describe("pdfMode 'auto-page' - limits and execution", () => {
  it("maxPages caps the candidates, marks the rest skipped and warns", async () => {
    const { calls, handler } = recorder();
    const result = await detailed(SCAN, opts(handler, { maxPages: 1 }));
    expect(calls.map((c) => c.ctx.page)).toEqual([1]);
    expect(result.markdown).toBe("OCR p1");
    expect(result.pages?.map((p) => [p.page, p.source, p.reason])).toEqual([
      [1, "ocr", "no-text"],
      [2, "skipped", "no-text"],
    ]);
    expect(result.warnings).toEqual(["ocr_page_limit: 2 candidate pages, 1 processed"]);
  });

  it("documentHandler gets one call with the candidate list", async () => {
    const calls: Array<{ pdf: Buffer; ctx: OCRDocumentHandlerContext }> = [];
    const pageHandler = recorder();
    const result = await detailed(MIXED, {
      provider: "handler",
      pdfMode: "auto-page",
      lang: "tr+en",
      handler: pageHandler.handler,
      documentHandler: async (pdf, ctx) => {
        calls.push({ pdf, ctx });
        return [
          { page: 2, text: "plain doc text", markdown: "# Doc markdown" },
          { page: 3, text: "not requested" },
        ];
      },
    }, );
    expect(pageHandler.calls).toHaveLength(0);
    expect(calls).toHaveLength(1);
    expect(calls[0].pdf.equals(MIXED)).toBe(true);
    expect(calls[0].ctx).toMatchObject({ pages: [2], pageCount: 3, langHint: ["tr", "en"] });
    expect(result.markdown).toContain("\n\n# Doc markdown\n\n");
    expect(result.markdown).toContain("Native Page 3");
    expect(result.markdown).not.toContain("not requested");
    expect(result.stats).toMatchObject({ ocrCalls: 1, ocrPages: 1 });
    expect(result.pages?.[1]).toMatchObject({ page: 2, source: "ocr", reason: "no-text" });
  });

  it("documentHandler receives all candidate pages, fileName and reports progress per page", async () => {
    const seen: OCRDocumentHandlerContext[] = [];
    const events: Array<[number, number, number | undefined]> = [];
    const result = await convertToMarkdownDetailed(SCAN, {
      forceExtension: ".pdf",
      fileName: "scan.pdf",
      ocr: {
        provider: "handler",
        pdfMode: "auto-page",
        onProgress: (e) => events.push([e.completed, e.total, e.page]),
        documentHandler: async (_pdf, ctx) => {
          seen.push(ctx);
          return ctx.pages.map((page) => ({ page, text: `doc ${page}` }));
        },
      },
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ pages: [1, 2], pageCount: 2, fileName: "scan.pdf" });
    expect(result.markdown).toBe("doc 1\n\ndoc 2");
    expect(events).toEqual([
      [1, 2, 1],
      [2, 2, 2],
    ]);
  });

  it("keeps page order with concurrency > 1 and runs tasks in parallel", async () => {
    let active = 0;
    let peak = 0;
    const result = await detailed(
      SCAN,
      opts(
        async (_b, ctx) => {
          active++;
          peak = Math.max(peak, active);
          // Page 1 finishes after page 2.
          await wait(ctx.page === 1 ? 120 : 10);
          active--;
          return `OCR p${ctx.page}`;
        },
        { concurrency: 2 },
      ),
    );
    expect(peak).toBe(2);
    expect(result.markdown).toBe("OCR p1\n\nOCR p2");
  });

  it("emits progress events for rendered pages", async () => {
    const events: Array<[number, number, number | undefined, string]> = [];
    const { handler } = recorder();
    await detailed(SCAN, opts(handler, { onProgress: (e) => events.push([e.completed, e.total, e.page, e.kind]) }));
    expect(events).toEqual([
      [1, 2, 1, "pdf-page"],
      [2, 2, 2, "pdf-page"],
    ]);
  });

  it("a per-call timeout becomes a warning and the native text is kept", async () => {
    const result = await detailed(
      MIXED,
      opts(async () => {
        await wait(2000);
        return "too late";
      }, { timeoutMs: 40 }),
    );
    expect(result.warnings).toEqual(["ocr_timeout: page 2"]);
    expect(result.markdown).not.toContain("too late");
    expect(result.markdown).toContain("Native Page 1");
    expect(result.markdown).toContain("Native Page 3");
    expect(result.pages?.[1]).toMatchObject({ page: 2, source: "error", reason: "no-text" });
  });

  it("rejects with an AbortError when the signal aborts, regardless of onError", async () => {
    const controller = new AbortController();
    const promise = convertToMarkdown(SCAN, {
      forceExtension: ".pdf",
      ocr: opts(
        async (_b, ctx) => {
          if (ctx.page === 1) setTimeout(() => controller.abort(), 20);
          await wait(500);
          return "late";
        },
        { signal: controller.signal, onError: "skip" },
      ),
    });
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects immediately for an already aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    const { calls, handler } = recorder();
    await expect(
      convertToMarkdown(SCAN, { forceExtension: ".pdf", ocr: opts(handler, { signal: controller.signal }) }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toHaveLength(0);
  });
});

describe("pdfMode 'auto-page' - errors", () => {
  const failPage2 = (): OCRHandler => async (_b, ctx) => {
    if (ctx.page === 2) throw new Error("engine exploded");
    return `OCR p${ctx.page}`;
  };

  it("skip (default) keeps the native text, records the error and warns", async () => {
    const result = await detailed(MIXED, opts(failPage2()));
    expect(result.markdown).toContain("Native Page 1");
    expect(result.markdown).not.toContain("OCR failed");
    expect(result.warnings).toEqual(["ocr_page_failed: page 2: engine exploded"]);
    expect(result.pages?.[1]).toMatchObject({ page: 2, source: "error", error: "engine exploded" });
  });

  it("comment puts an HTML comment in place of the empty page", async () => {
    const md = await convertToMarkdown(MIXED, {
      forceExtension: ".pdf",
      ocr: opts(failPage2(), { onError: "comment" }),
    });
    const p1 = md.indexOf("Native Page 1");
    const c = md.indexOf("<!-- OCR failed (page 2): engine exploded -->");
    const p3 = md.indexOf("Native Page 3");
    expect(p1).toBeGreaterThanOrEqual(0);
    expect(c).toBeGreaterThan(p1);
    expect(p3).toBeGreaterThan(c);
  });

  it("throw rethrows the first failure", async () => {
    await expect(
      convertToMarkdown(MIXED, { forceExtension: ".pdf", ocr: opts(failPage2(), { onError: "throw" }) }),
    ).rejects.toThrow("engine exploded");
  });

  it("a failing page keeps its other pages' OCR results", async () => {
    const result = await detailed(SCAN, opts(failPage2()));
    expect(result.markdown).toBe("OCR p1");
    expect(result.warnings).toEqual(["ocr_page_failed: page 2: engine exploded"]);
  });

  it("throws 'PDF OCR failed' when nothing succeeded and there is no native text", async () => {
    await expect(
      convertToMarkdown(SCAN, {
        forceExtension: ".pdf",
        ocr: opts(async () => {
          throw new Error("no engine");
        }),
      }),
    ).rejects.toThrow("PDF OCR failed: no engine");
  });

  it("returns an empty document (no error) when OCR finds no text", async () => {
    const md = await convertToMarkdown(SCAN, { forceExtension: ".pdf", ocr: opts(async () => "") });
    expect(md).toBe("");
  });

  it("documentHandler failure applies to every candidate page", async () => {
    const result = await detailed(MIXED, {
      provider: "handler",
      pdfMode: "auto-page",
      documentHandler: async () => {
        throw new Error("doc handler down");
      },
    });
    expect(result.warnings).toEqual(["ocr_page_failed: page 2: doc handler down"]);
    expect(result.markdown).toContain("Native Page 3");
    await expect(
      convertToMarkdown(SCAN, {
        forceExtension: ".pdf",
        ocr: {
          provider: "handler",
          pdfMode: "auto-page",
          documentHandler: async () => {
            throw new Error("doc handler down");
          },
        },
      }),
    ).rejects.toThrow("PDF OCR failed: doc handler down");
  });
});

describe("render options", () => {
  const isPng = (b: Buffer) => b.toString("latin1", 1, 4) === "PNG";
  const isJpeg = (b: Buffer) => b[0] === 0xff && b[1] === 0xd8;

  it("renders at scale 2 PNG by default", async () => {
    const { calls, handler } = recorder();
    await detailed(SCAN, opts(handler));
    expect(calls[0].ctx).toMatchObject({ mimeType: "image/png", imageWidth: 1190, imageHeight: 1684 });
    expect(isPng(calls[0].buffer)).toBe(true);
  });

  it("render.scale changes the size", async () => {
    const { calls, handler } = recorder();
    await detailed(SCAN, opts(handler, { render: { scale: 1 } }));
    expect(calls[0].ctx).toMatchObject({ imageWidth: 595, imageHeight: 842 });
  });

  it("maxPixels reduces the scale so width*height fits", async () => {
    const { calls, handler } = recorder();
    await detailed(SCAN, opts(handler, { render: { maxPixels: 100_000 } }));
    const { imageWidth, imageHeight } = calls[0].ctx;
    expect(imageWidth! * imageHeight!).toBeLessThanOrEqual(100_000);
    expect(imageWidth! * imageHeight!).toBeGreaterThan(60_000);
    // Aspect ratio is kept (A4).
    expect(imageHeight! / imageWidth!).toBeCloseTo(842 / 595, 1);
  });

  it("jpeg output has the image/jpeg type and JPEG bytes", async () => {
    const { calls, handler } = recorder();
    await detailed(SCAN, opts(handler, { render: { format: "jpeg", jpegQuality: 60, scale: 1 } }));
    expect(calls[0].ctx.mimeType).toBe("image/jpeg");
    expect(isJpeg(calls[0].buffer)).toBe(true);
    expect(calls[0].ctx).toMatchObject({ imageWidth: 595, imageHeight: 842 });
  });

  it("grayscale produces a single-channel PNG", async () => {
    const { calls, handler } = recorder();
    await detailed(SCAN, opts(handler, { render: { grayscale: true, scale: 1 } }));
    const png = calls[0].buffer;
    expect(isPng(png)).toBe(true);
    // IHDR colour type 0 = grayscale
    expect(png[25]).toBe(0);
  });

  it("legacy 'always' mode honours the render options too", async () => {
    const { calls, handler } = recorder();
    const md = await convertToMarkdown(SCAN, {
      forceExtension: ".pdf",
      ocr: { provider: "handler", pdfMode: "always", handler, render: { format: "jpeg", maxPixels: 50_000 } },
    });
    expect(md).toBe("OCR p1\n\nOCR p2");
    expect(calls[0].ctx.mimeType).toBe("image/jpeg");
    expect(calls[0].ctx.imageWidth! * calls[0].ctx.imageHeight!).toBeLessThanOrEqual(50_000);
  });
});

describe("legacy modes", () => {
  it("'auto' does not OCR a PDF that has a text layer", async () => {
    const { calls, handler } = recorder();
    const md = await convertToMarkdown(MIXED, {
      forceExtension: ".pdf",
      ocr: { provider: "handler", handler },
    });
    expect(calls).toHaveLength(0);
    expect(md).toContain("Native Page 1");
    expect(md).not.toContain("OCR p2");
  });

  it("'auto' OCRs the whole document when the text layer is empty", async () => {
    const { calls, handler } = recorder();
    const md = await convertToMarkdown(SCAN, { forceExtension: ".pdf", ocr: { provider: "handler", handler } });
    expect(md).toBe("OCR p1\n\nOCR p2");
    expect(calls.map((c) => c.ctx.page)).toEqual([1, 2]);
    // Default context is unchanged (no image size).
    expect(calls[0].ctx.imageWidth).toBeUndefined();
  });

  it("'always' replaces the text layer with the OCR of every page", async () => {
    const { calls, handler } = recorder();
    const md = await convertToMarkdown(MIXED, {
      forceExtension: ".pdf",
      ocr: { provider: "handler", pdfMode: "always", handler },
    });
    expect(md).toBe("OCR p1\n\nOCR p2\n\nOCR p3");
    expect(calls).toHaveLength(3);
  });

  it("maxPages limits the legacy OCR to the first pages and keeps the text layer of the rest", async () => {
    const { calls, handler } = recorder();
    const result = await detailed(MIXED, { provider: "handler", pdfMode: "always", handler, maxPages: 2 });
    expect(calls.map((c) => c.ctx.page)).toEqual([1, 2]);
    expect(result.markdown.startsWith("OCR p1\n\nOCR p2\n\nOperations Handbook - Native Page 3")).toBe(true);
    expect(result.warnings).toEqual(["ocr_page_limit: 3 pages, 2 processed"]);
  });

  it("documentHandler replaces the per-page renders in 'always' mode", async () => {
    const pageHandler = recorder();
    const calls: OCRDocumentHandlerContext[] = [];
    const md = await convertToMarkdown(SCAN, {
      forceExtension: ".pdf",
      ocr: {
        provider: "handler",
        pdfMode: "always",
        handler: pageHandler.handler,
        documentHandler: async (_pdf, ctx) => {
          calls.push(ctx);
          return [
            { page: 2, text: "second" },
            { page: 1, text: "first" },
          ];
        },
      },
    });
    expect(pageHandler.calls).toHaveLength(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ pages: [1, 2], pageCount: 2 });
    expect(md).toBe("first\n\nsecond");
  });

  it("timeoutMs and signal apply to the legacy path", async () => {
    await expect(
      convertToMarkdown(SCAN, {
        forceExtension: ".pdf",
        ocr: {
          provider: "handler",
          timeoutMs: 30,
          handler: async () => {
            await wait(1000);
            return "late";
          },
        },
      }),
    ).rejects.toThrow("PDF OCR failed: OCR timed out after 30ms");

    const controller = new AbortController();
    controller.abort();
    await expect(
      convertToMarkdown(SCAN, {
        forceExtension: ".pdf",
        ocr: { provider: "handler", signal: controller.signal, handler: async () => "x" },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("'never' disables OCR", async () => {
    const { calls, handler } = recorder();
    const md = await convertToMarkdown(SCAN, {
      forceExtension: ".pdf",
      ocr: { provider: "handler", pdfMode: "never", handler },
    });
    expect(calls).toHaveLength(0);
    expect(md).toBe("");
  });
});
