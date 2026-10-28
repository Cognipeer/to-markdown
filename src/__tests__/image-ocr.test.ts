import { readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { convertToMarkdown, convertToMarkdownDetailed } from "../index.ts";
import { convertImageToMarkdown } from "../converters/media.ts";
import type { OCRHandler, OCRHandlerContext, OCROptions } from "../types/index.ts";

const fixture = (name: string): Buffer =>
  readFileSync(new URL(`./fixtures/ocr/${name}`, import.meta.url));
const TIF = fixture("multipage.tif");
const ROTATED = fixture("rotated.jpg");
const WEBP = fixture("sample.webp");
const BMP = fixture("sample.bmp");
const PNG = fixture("sample.png");

/** Records every call; answers `OCR <page>` (or `OCR image` without a page). */
function recorder(answer: (ctx: OCRHandlerContext) => string = (c) => (c.page ? `OCR page ${c.page}` : "OCR image")) {
  const calls: Array<{ buffer: Buffer; ctx: OCRHandlerContext }> = [];
  const handler: OCRHandler = async (buffer, ctx) => {
    calls.push({ buffer, ctx });
    return answer(ctx);
  };
  return { calls, handler };
}

const ocr = (handler: OCRHandler, extra: Partial<OCROptions> = {}): OCROptions => ({
  provider: "handler",
  handler,
  ...extra,
});

describe("image formats: metadata", () => {
  it("TIFF (multi-page) gets ImageSize, Format and a Pages line", async () => {
    const md = await convertToMarkdown(TIF, { fileName: "multipage.tif" });
    expect(md).toBe("ImageSize: 1400x320 Format: tiff Pages: 2");
  });

  it("accepts .tiff, forceExtension and file-name based dispatch", async () => {
    const a = await convertToMarkdown(TIF, { forceExtension: ".tiff" });
    const b = await convertToMarkdown(TIF, { fileName: "scan.TIFF" });
    expect(a).toBe("ImageSize: 1400x320 Format: tiff Pages: 2");
    expect(b).toBe(a);
  });

  it("a single-page TIFF has no Pages line", async () => {
    const single = await sharp(PNG).tiff().toBuffer();
    const md = await convertToMarkdown(single, { fileName: "one.tif" });
    expect(md).toBe("ImageSize: 1400x314 Format: tiff");
  });

  it("WEBP and BMP are images (BMP is measured through the canvas fallback)", async () => {
    expect(await convertToMarkdown(WEBP, { fileName: "sample.webp" })).toBe(
      "ImageSize: 1400x314 Format: webp"
    );
    const bmp = await convertToMarkdown(BMP, { fileName: "sample.bmp" });
    expect(bmp).toMatch(/^ImageSize: \d+x\d+ Format: bmp$/);
  });

  it("legacy formats keep their exact output", async () => {
    expect(await convertToMarkdown(PNG, { fileName: "sample.png" })).toBe(
      "ImageSize: 1400x314 Format: png"
    );
    expect(await convertToMarkdown(ROTATED, { fileName: "rotated.jpg" })).toBe(
      "ImageSize: 314x1300 Format: jpg"
    );
  });

  it("invalid data with a new extension is reported like any other image", async () => {
    await expect(
      convertToMarkdown(Buffer.from("not an image"), { fileName: "broken.bmp" })
    ).rejects.toThrow(/Failed to convert image: unsupported or invalid image data/);
  });

  it("imageMetadata:false omits the header", async () => {
    expect(await convertToMarkdown(PNG, { fileName: "a.png", imageMetadata: false })).toBe("");
    const { calls, handler } = recorder();
    const md = await convertToMarkdown(PNG, {
      fileName: "a.png",
      imageMetadata: false,
      ocr: ocr(handler),
    });
    expect(md).toBe("## Extracted Text\n\nOCR image");
    expect(calls).toHaveLength(1);
  });
});

describe("TIFF OCR", () => {
  it("OCRs every page in order as PNG with kind 'tiff-page' and joins with a blank line", async () => {
    const { calls, handler } = recorder();
    const md = await convertToMarkdown(TIF, { fileName: "multipage.tif", ocr: ocr(handler) });
    expect(md).toBe(
      "ImageSize: 1400x320 Format: tiff Pages: 2\n\n## Extracted Text\n\nOCR page 1\n\nOCR page 2"
    );
    expect(calls.map((c) => c.ctx.page)).toEqual([1, 2]);
    for (const [i, c] of calls.entries()) {
      expect(c.ctx).toMatchObject({
        kind: "tiff-page",
        index: i,
        pageCount: 2,
        mimeType: "image/png",
        sourceExtension: ".tif",
        fileName: "multipage.tif",
        imageWidth: 1400,
        imageHeight: 320,
      });
      expect(c.buffer.subarray(1, 4).toString()).toBe("PNG");
    }
  });

  it("keeps page order with concurrency and uneven timings", async () => {
    const { handler } = recorder();
    const slowFirst: OCRHandler = async (b, ctx) => {
      if (ctx.page === 1) await new Promise((r) => setTimeout(r, 60));
      return handler(b, ctx);
    };
    const md = await convertToMarkdown(TIF, {
      fileName: "m.tif",
      ocr: ocr(slowFirst, { concurrency: 2 }),
    });
    expect(md.endsWith("OCR page 1\n\nOCR page 2")).toBe(true);
  });

  it("a single-page TIFF is OCRed once as an 'image' (PNG bytes, no page)", async () => {
    const single = await sharp(PNG).tiff().toBuffer();
    const { calls, handler } = recorder();
    const md = await convertToMarkdown(single, { fileName: "one.tiff", ocr: ocr(handler) });
    expect(md).toBe("ImageSize: 1400x314 Format: tiff\n\n## Extracted Text\n\nOCR image");
    expect(calls).toHaveLength(1);
    expect(calls[0].ctx.kind).toBe("image");
    expect(calls[0].ctx.page).toBeUndefined();
    expect(calls[0].ctx.mimeType).toBe("image/png");
  });

  it("reports page results and progress", async () => {
    const { handler } = recorder();
    const events: Array<{ kind: string; completed: number; total: number; page?: number }> = [];
    const detailed = await convertToMarkdownDetailed(TIF, {
      fileName: "multipage.tif",
      ocr: ocr(handler, { onProgress: (e) => events.push(e) }),
    });
    expect(detailed.extension).toBe(".tif");
    expect(detailed.pages?.map((p) => [p.page, p.source])).toEqual([
      [1, "ocr"],
      [2, "ocr"],
    ]);
    expect(detailed.images).toHaveLength(1);
    expect(detailed.images![0]).toMatchObject({ kind: "image", width: 1400, height: 320, ocr: true });
    expect(detailed.stats).toMatchObject({ ocrCalls: 2, ocrPages: 2, pageCount: 2 });
    expect(events.map((e) => [e.kind, e.completed, e.total])).toEqual([
      ["tiff-page", 1, 2],
      ["tiff-page", 2, 2],
    ]);
  });

  it("a failing page: comment (default) keeps the other pages, skip drops it, throw rejects", async () => {
    const flaky = recorder((c) => {
      if (c.page === 1) throw new Error("boom");
      return "OCR page 2";
    });
    const comment = await convertToMarkdownDetailed(TIF, {
      fileName: "m.tif",
      ocr: ocr(flaky.handler),
    });
    expect(comment.markdown).toContain("<!-- OCR failed (page 1): boom -->\n\nOCR page 2");
    expect(comment.pages?.map((p) => p.source)).toEqual(["error", "ocr"]);
    expect(comment.warnings.some((w) => w.startsWith("ocr_page_failed:"))).toBe(true);

    const skip = await convertToMarkdown(TIF, { fileName: "m.tif", ocr: ocr(flaky.handler, { onError: "skip" }) });
    expect(skip).toBe("ImageSize: 1400x320 Format: tiff Pages: 2\n\n## Extracted Text\n\nOCR page 2");

    await expect(
      convertToMarkdown(TIF, { fileName: "m.tif", ocr: ocr(flaky.handler, { onError: "throw" }) })
    ).rejects.toThrow("boom");
  });

  it("every page failing falls back to the single legacy comment", async () => {
    const { handler } = recorder(() => {
      throw new Error("down");
    });
    const md = await convertToMarkdown(TIF, { fileName: "m.tif", ocr: ocr(handler) });
    expect(md).toBe("ImageSize: 1400x320 Format: tiff Pages: 2\n\n<!-- OCR failed: down -->");
  });
});

describe("EXIF auto-rotate", () => {
  it("rotates before OCR and hands the handler the rotated buffer and size", async () => {
    const { calls, handler } = recorder();
    const md = await convertToMarkdown(ROTATED, { fileName: "rotated.jpg", ocr: ocr(handler) });
    // header stays the measured (stored) size, like before
    expect(md).toBe("ImageSize: 314x1300 Format: jpg\n\n## Extracted Text\n\nOCR image");
    expect(calls).toHaveLength(1);
    const { ctx, buffer } = calls[0];
    expect(ctx.imageWidth).toBe(1300);
    expect(ctx.imageHeight).toBe(314);
    expect(ctx.mimeType).toBe("image/jpeg");
    expect(buffer.equals(ROTATED)).toBe(false);
    const meta = await sharp(buffer).metadata();
    expect([meta.width, meta.height]).toEqual([1300, 314]);
    expect(meta.orientation ?? 1).toBe(1);
  });

  it("autoRotate:false passes the original bytes", async () => {
    const { calls, handler } = recorder();
    await convertToMarkdown(ROTATED, { fileName: "rotated.jpg", ocr: ocr(handler, { autoRotate: false }) });
    expect(calls[0].buffer.equals(ROTATED)).toBe(true);
    expect(calls[0].ctx).toMatchObject({ imageWidth: 314, imageHeight: 1300, mimeType: "image/jpeg" });
  });

  it("images without an orientation tag are passed through untouched", async () => {
    const { calls, handler } = recorder();
    await convertToMarkdown(PNG, { fileName: "a.png", ocr: ocr(handler) });
    expect(calls[0].buffer.equals(PNG)).toBe(true);
    expect(calls[0].ctx).toMatchObject({ imageWidth: 1400, imageHeight: 314, mimeType: "image/png", kind: "image" });
  });
});

describe("OCR of WEBP / BMP", () => {
  it("passes the original bytes with the right media type", async () => {
    const { calls, handler } = recorder();
    const webp = await convertToMarkdown(WEBP, { fileName: "s.webp", ocr: ocr(handler) });
    expect(webp).toBe("ImageSize: 1400x314 Format: webp\n\n## Extracted Text\n\nOCR image");
    const bmp = await convertToMarkdown(BMP, { fileName: "s.bmp", ocr: ocr(handler) });
    expect(bmp).toContain("Format: bmp\n\n## Extracted Text\n\nOCR image");
    expect(calls[0].buffer.equals(WEBP)).toBe(true);
    expect(calls[0].ctx.mimeType).toBe("image/webp");
    expect(calls[1].buffer.equals(BMP)).toBe(true);
    expect(calls[1].ctx.mimeType).toBe("image/bmp");
    expect(calls[1].ctx.imageWidth).toBeGreaterThan(0);
  });

  it("appear in the detailed report images[]", async () => {
    const { handler } = recorder();
    for (const [name, buf] of [
      ["s.webp", WEBP],
      ["s.bmp", BMP],
      ["s.tif", TIF],
    ] as const) {
      const d = await convertToMarkdownDetailed(buf, { fileName: name, ocr: ocr(handler) });
      expect(d.images).toHaveLength(1);
      expect(d.images![0]).toMatchObject({ index: 0, kind: "image", path: name, ocr: true, chars: expect.any(Number) });
      expect(d.images![0].width).toBeGreaterThan(0);
      expect(d.images![0].height).toBeGreaterThan(0);
    }
    const noOcr = await convertToMarkdownDetailed(WEBP, { fileName: "s.webp" });
    expect(noOcr.images).toEqual([
      { index: 0, kind: "image", path: "s.webp", width: 1400, height: 314, ocr: false },
    ]);
  });
});

describe("onError for images", () => {
  const failing = () =>
    recorder(() => {
      throw new Error("engine down");
    });

  it("default 'comment' keeps the legacy comment", async () => {
    const { handler } = failing();
    const md = await convertToMarkdown(PNG, { fileName: "a.png", ocr: ocr(handler) });
    expect(md).toBe("ImageSize: 1400x314 Format: png\n\n<!-- OCR failed: engine down -->");
  });

  it("'skip' omits the comment and still reports the error", async () => {
    const { handler } = failing();
    const d = await convertToMarkdownDetailed(WEBP, { fileName: "a.webp", ocr: ocr(handler, { onError: "skip" }) });
    expect(d.markdown).toBe("ImageSize: 1400x314 Format: webp");
    expect(d.images![0].error).toBe("engine down");
    expect(d.warnings).toEqual(["ocr_image_failed: a.webp: engine down"]);
  });

  it("'throw' rejects with the original error", async () => {
    const { handler } = failing();
    await expect(
      convertToMarkdown(PNG, { fileName: "a.png", ocr: ocr(handler, { onError: "throw" }) })
    ).rejects.toThrow("engine down");
  });

  it("a timeout becomes an ocr_timeout warning", async () => {
    const slow: OCRHandler = () => new Promise((r) => setTimeout(() => r("late"), 500));
    const d = await convertToMarkdownDetailed(PNG, {
      fileName: "a.png",
      ocr: ocr(slow, { timeoutMs: 30 }),
    });
    expect(d.warnings).toEqual(["ocr_timeout: a.png"]);
    expect(d.markdown).toContain("<!-- OCR failed:");
  });

  it("cancellation is never swallowed", async () => {
    const controller = new AbortController();
    const handler: OCRHandler = async () => {
      controller.abort();
      return "x";
    };
    await expect(
      convertToMarkdown(PNG, {
        fileName: "a.png",
        ocr: ocr(handler, { signal: controller.signal, onError: "skip" }),
      })
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("legacy image OCR output is unchanged", () => {
  it("png / jpg with ocr:true-style handler use the original buffer shape and format", async () => {
    const handler: OCRHandler = async () => "  hello world  ";
    expect(await convertToMarkdown(PNG, { fileName: "sample.png", ocr: ocr(handler) })).toBe(
      "ImageSize: 1400x314 Format: png\n\n## Extracted Text\n\nhello world"
    );
    expect(await convertToMarkdown(ROTATED, { fileName: "rotated.jpg", ocr: ocr(handler) })).toBe(
      "ImageSize: 314x1300 Format: jpg\n\n## Extracted Text\n\nhello world"
    );
  });

  it("convertImageToMarkdown keeps its positional signature", async () => {
    const handler: OCRHandler = async () => "direct";
    expect(await convertImageToMarkdown(WEBP, ".webp", ocr(handler), "s.webp")).toBe(
      "ImageSize: 1400x314 Format: webp\n\n## Extracted Text\n\ndirect"
    );
  });
});
