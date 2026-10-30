/**
 * Final review fixes for 3.6.0: runner concurrency vs tesseract workers, worker
 * restart after a timeout, prompt dispose while the engine starts, TIFF maxPages,
 * embedded GIF / buffer handling, standalone ocrImage signal + timeout and HTTP
 * body timeouts. tesseract.js and `fetch` are mocked.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convertToMarkdown, convertToMarkdownDetailed, ocrImage } from "../index.ts";
import { createConversionContext } from "../utils/conversionContext.ts";
import { EmbeddedImageSession, resolveEmbeddedImagePolicy } from "../utils/embeddedImages.ts";
import { fetchWithRetry } from "../utils/http.ts";
import { ocrConcurrency } from "../utils/ocrRunner.ts";

const tess = vi.hoisted(() => ({
  createWorker: vi.fn(),
  createScheduler: vi.fn(),
  recognize: vi.fn(),
  terminate: vi.fn(),
}));

vi.mock("tesseract.js", () => ({
  createWorker: tess.createWorker,
  createScheduler: tess.createScheduler,
}));

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "ocr");
const fixture = (name: string) => readFileSync(join(FIXTURES, name));
const samplePng = fixture("sample.png");
const TIF = fixture("multipage.tif");

function resetMocks() {
  for (const m of Object.values(tess)) m.mockReset();
  tess.recognize.mockImplementation(async () => ({ data: { text: " tess text \n" } }));
  tess.terminate.mockImplementation(async () => undefined);
  tess.createWorker.mockImplementation(async () => ({
    recognize: tess.recognize,
    terminate: tess.terminate,
    setParameters: async () => undefined,
  }));
}

beforeEach(resetMocks);
afterEach(() => vi.unstubAllGlobals());

describe("ocrConcurrency", () => {
  it("caps the tesseract provider at the worker limit and leaves other providers alone", () => {
    expect(ocrConcurrency({ concurrency: 8 })).toBe(4);
    expect(ocrConcurrency({ provider: "tesseract", concurrency: 2 })).toBe(2);
    expect(ocrConcurrency({})).toBe(1);
    expect(ocrConcurrency({ provider: "handler", concurrency: 8 })).toBe(8);
    expect(ocrConcurrency({ provider: "openai-vlm", concurrency: 6 })).toBe(6);
  });
});

describe("tesseract session", () => {
  it("never has more jobs in flight than workers (concurrency 8 -> 4)", async () => {
    let inFlight = 0;
    let peak = 0;
    tess.recognize.mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return { data: { text: "x" } };
    });
    tess.createScheduler.mockImplementation(() => {
      const workers: any[] = [];
      return {
        addWorker: (w: any) => workers.push(w),
        addJob: async (_a: string, buf: Buffer) => workers[0].recognize(buf),
        terminate: async () => undefined,
      };
    });
    // 12 distinct pictures (no dedupe hits) in one HTML document.
    const imgs: string[] = [];
    for (let i = 0; i < 12; i++) {
      const png = await sharp({
        create: { width: 100, height: 100, channels: 3, background: { r: i * 20, g: 0, b: 0 } },
      })
        .png()
        .toBuffer();
      imgs.push(`<img src="data:image/png;base64,${png.toString("base64")}">`);
    }
    await convertToMarkdown(Buffer.from(`<p>x</p>${imgs.join("")}`), {
      fileName: "a.html",
      ocr: { embeddedImages: true, concurrency: 8 },
    });
    expect(tess.recognize).toHaveBeenCalledTimes(12);
    expect(peak).toBeLessThanOrEqual(4);
    expect(tess.createWorker).toHaveBeenCalledTimes(4);
  });

  it("restarts the worker after a timed-out job so later pages do not queue behind it", async () => {
    let call = 0;
    const workerTerminate = vi.fn(async () => undefined);
    tess.createWorker.mockImplementation(async () => {
      const id = ++call;
      return {
        recognize: id === 1 ? () => new Promise(() => undefined) : async () => ({ data: { text: "second worker" } }),
        terminate: id === 1 ? workerTerminate : tess.terminate,
        setParameters: async () => undefined,
      };
    });
    const result = await convertToMarkdownDetailed(TIF, {
      fileName: "m.tif",
      ocr: { timeoutMs: 60, onError: "skip" },
    });
    expect(result.warnings).toContain("ocr_timeout: m.tif page 1");
    expect(result.markdown).toContain("second worker");
    expect(tess.createWorker).toHaveBeenCalledTimes(2);
    expect(workerTerminate).toHaveBeenCalledTimes(1);
    expect(tess.terminate).toHaveBeenCalledTimes(1);
  });

  it("abort does not wait for the engine start and still releases the worker", async () => {
    let finishStart!: () => void;
    const workerTerminate = vi.fn(async () => undefined);
    tess.createWorker.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishStart = () =>
            resolve({ recognize: tess.recognize, terminate: workerTerminate, setParameters: async () => undefined });
        }),
    );
    const controller = new AbortController();
    const promise = convertToMarkdown(samplePng, { fileName: "a.png", ocr: { signal: controller.signal } });
    setTimeout(() => controller.abort(), 20);
    const outcome = await Promise.race([
      promise.then(
        () => "resolved",
        (e) => e.name,
      ),
      new Promise((r) => setTimeout(() => r("hung"), 1000)),
    ]);
    expect(outcome).toBe("AbortError");
    finishStart();
    await new Promise((r) => setTimeout(r, 20));
    expect(workerTerminate).toHaveBeenCalledTimes(1);
    expect(tess.recognize).not.toHaveBeenCalled();
  });
});

describe("TIFF maxPages", () => {
  it("OCRs only the first N frames, warns and reports the rest as skipped", async () => {
    const calls: number[] = [];
    const result = await convertToMarkdownDetailed(TIF, {
      fileName: "m.tif",
      ocr: {
        provider: "handler",
        handler: async (_b, ctx) => {
          calls.push(ctx.page!);
          return `OCR ${ctx.page}`;
        },
        maxPages: 1,
      },
    });
    expect(calls).toEqual([1]);
    expect(result.markdown).toBe("ImageSize: 1400x320 Format: tiff Pages: 2\n\n## Extracted Text\n\nOCR 1");
    expect(result.warnings).toEqual(["ocr_page_limit: m.tif: 2 pages, 1 processed"]);
    expect(result.pages?.map((p) => [p.page, p.source])).toEqual([
      [1, "ocr"],
      [2, "skipped"],
    ]);
  });
});

describe("embedded images", () => {
  it("transcodes embedded GIFs to PNG for tesseract only", async () => {
    const gif = await sharp({ create: { width: 100, height: 100, channels: 3, background: "#ffffff" } })
      .gif()
      .toBuffer();
    const html = `<p>x</p><img src="data:image/gif;base64,${gif.toString("base64")}">`;
    const seen: Buffer[] = [];
    tess.recognize.mockImplementation(async (buf: Buffer) => {
      seen.push(buf);
      return { data: { text: "gif text" } };
    });
    const md = await convertToMarkdown(Buffer.from(html), {
      fileName: "a.html",
      ocr: { embeddedImages: true },
    });
    expect(md).toContain("> gif text");
    expect(seen).toHaveLength(1);
    expect(seen[0].subarray(1, 4).toString("latin1")).toBe("PNG");

    const handlerSeen: string[] = [];
    await convertToMarkdown(Buffer.from(html), {
      fileName: "a.html",
      ocr: {
        provider: "handler",
        embeddedImages: true,
        handler: async (b) => {
          handlerSeen.push(b.subarray(0, 3).toString("latin1"));
          return "h";
        },
      },
    });
    expect(handlerSeen).toEqual(["GIF"]);
  });

  it("drops the bytes of images that are not queued for OCR", async () => {
    const small = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#fff" } })
      .png()
      .toBuffer();
    const big = await sharp({ create: { width: 100, height: 100, channels: 3, background: "#fff" } })
      .png()
      .toBuffer();
    const options = { ocr: { provider: "handler" as const, handler: async () => "x", embeddedImages: true } };
    const conv = createConversionContext(options);
    const session = new EmbeddedImageSession(conv, resolveEmbeddedImagePolicy(options)!);
    const a = session.register({ buffer: small });
    const b = session.register({ buffer: big });
    const c = session.register({ buffer: big }); // duplicate
    expect(a.report.skipped).toBe("small");
    expect(c.report.skipped).toBe("duplicate");
    expect(a.input.buffer.length).toBe(0);
    expect(c.input.buffer.length).toBe(0);
    expect(b.queued).toBe(true);
    expect(b.input.buffer.length).toBe(big.length);
    await conv.dispose();
  });
});

describe("standalone ocrImage()", () => {
  it("honours opts.signal", async () => {
    const controller = new AbortController();
    const promise = ocrImage(samplePng, {
      provider: "handler",
      handler: (_b, ctx) =>
        new Promise((_, reject) => ctx.signal!.addEventListener("abort", () => reject(ctx.signal!.reason))),
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 10);
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });

  it("honours opts.timeoutMs even for handlers that ignore the signal", async () => {
    await expect(
      ocrImage(samplePng, {
        provider: "handler",
        handler: () => new Promise(() => undefined),
        timeoutMs: 30,
      }),
    ).rejects.toThrow("OCR timed out after 30ms");
  });

  it("still works without signal or timeout", async () => {
    expect(await ocrImage(samplePng, { provider: "handler", handler: async () => " hi " })).toBe("hi");
  });
});

describe("fetchWithRetry body handling", () => {
  it("applies the attempt timeout while the body is read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = new ReadableStream({
          start(controller) {
            init.signal!.addEventListener("abort", () => controller.error(init.signal!.reason));
          },
        });
        return new Response(body, { status: 200 });
      }),
    );
    await expect(fetchWithRetry("http://x", {}, { retries: 0, timeoutMs: 30 })).rejects.toThrow(
      "request timed out after 30ms",
    );
  });

  it("returns a readable response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ a: 1 }), { status: 201 })));
    const res = await fetchWithRetry("http://x", {});
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ a: 1 });
  });
});
