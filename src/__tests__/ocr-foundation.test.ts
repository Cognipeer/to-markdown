/**
 * TM-1 foundation: detailed conversion report, shared OCR runner, tesseract
 * session options, VLM provider fixes (media type, transcoding, retries,
 * timeout, signal). No network and no real OCR engine: tesseract.js and
 * `fetch` are mocked, the handler provider is deterministic.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  convertToMarkdown,
  convertToMarkdownDetailed,
  ocrImage,
  toTesseractLang,
} from "../index.ts";
import type { OCRHandlerContext, OCROptions } from "../types/index.ts";
import { runOcrTasks } from "../utils/ocrRunner.ts";
import { parseRetryAfter } from "../utils/http.ts";

const tess = vi.hoisted(() => ({
  createWorker: vi.fn(),
  createScheduler: vi.fn(),
  recognize: vi.fn(),
  terminate: vi.fn(),
  setParameters: vi.fn(),
  addWorker: vi.fn(),
  addJob: vi.fn(),
  schedTerminate: vi.fn(),
}));

vi.mock("tesseract.js", () => ({
  createWorker: tess.createWorker,
  createScheduler: tess.createScheduler,
}));

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "ocr");
const fixture = (name: string) => readFileSync(join(FIXTURES, name));
const mixedPdf = fixture("mixed.pdf"); // native, image-only, native
const samplePng = fixture("sample.png");

function resetTesseractMocks() {
  for (const m of Object.values(tess)) m.mockReset();
  tess.recognize.mockImplementation(async () => ({ data: { text: " tess text \n", confidence: 91 } }));
  tess.terminate.mockImplementation(async () => undefined);
  tess.setParameters.mockImplementation(async () => undefined);
  tess.createWorker.mockImplementation(async () => ({
    recognize: tess.recognize,
    terminate: tess.terminate,
    setParameters: tess.setParameters,
  }));
  tess.addJob.mockImplementation(async (_action: string, buf: Buffer) => tess.recognize(buf));
  tess.schedTerminate.mockImplementation(async () => undefined);
  tess.createScheduler.mockImplementation(() => ({
    addWorker: tess.addWorker,
    addJob: tess.addJob,
    terminate: tess.schedTerminate,
  }));
}

const textHandler = (prefix = "OCR p") => async (_b: Buffer, ctx: OCRHandlerContext) =>
  prefix + (ctx.page ?? 0);

describe("toTesseractLang", () => {
  it("maps ISO 639-1 codes and passes tesseract codes through", () => {
    expect(toTesseractLang("tr")).toBe("tur");
    expect(toTesseractLang("tr+en")).toBe("tur+eng");
    expect(toTesseractLang(["tr", "en"])).toBe("tur+eng");
    expect(toTesseractLang("eng")).toBe("eng");
    expect(toTesseractLang("tur+eng")).toBe("tur+eng");
    expect(toTesseractLang(["tur", "en"])).toBe("tur+eng");
    expect(toTesseractLang("chi_tra")).toBe("chi_tra");
    expect(toTesseractLang("zh")).toBe("chi_sim");
    expect(toTesseractLang("xx")).toBe("xx");
    expect(toTesseractLang(undefined)).toBeUndefined();
    expect(toTesseractLang([])).toBeUndefined();
  });
});

describe("runOcrTasks", () => {
  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("preserves task order and honours the concurrency limit", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const tasks = [30, 5, 20, 1, 10].map((ms, i) => ({
      page: i + 1,
      run: async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await delay(ms);
        inFlight--;
        return i;
      },
    }));
    const events: Array<{ completed: number; total: number; page?: number }> = [];
    const out = await runOcrTasks(tasks, {
      concurrency: 2,
      kind: "pdf-page",
      onProgress: (e) => events.push({ completed: e.completed, total: e.total, page: e.page }),
    });
    expect(out.map((o) => (o.status === "ok" ? o.value : -1))).toEqual([0, 1, 2, 3, 4]);
    expect(maxInFlight).toBe(2);
    expect(events.map((e) => e.completed)).toEqual([1, 2, 3, 4, 5]);
    expect(events.every((e) => e.total === 5)).toBe(true);
  });

  it("reports failures as outcomes and stops scheduling with stopOnError", async () => {
    const ran: number[] = [];
    const tasks = [0, 1, 2].map((i) => ({
      run: async () => {
        ran.push(i);
        if (i === 1) throw new Error("boom");
        return i;
      },
    }));
    const out = await runOcrTasks(tasks, { stopOnError: true });
    expect(out[0].status).toBe("ok");
    expect(out[1]).toMatchObject({ status: "error", timedOut: false });
    expect(out[2].status).toBe("skipped");
    expect(ran).toEqual([0, 1]);
  });

  it("times a task out and aborts its signal", async () => {
    let taskSignal: AbortSignal | undefined;
    const out = await runOcrTasks(
      [
        {
          run: (signal) => {
            taskSignal = signal;
            return new Promise<string>(() => undefined);
          },
        },
      ],
      { timeoutMs: 20 },
    );
    expect(out[0]).toMatchObject({ status: "error", timedOut: true });
    expect(taskSignal?.aborted).toBe(true);
  });

  it("rejects with AbortError on abort and stops scheduling", async () => {
    const controller = new AbortController();
    const started: number[] = [];
    const tasks = [0, 1, 2, 3].map((i) => ({
      run: async () => {
        started.push(i);
        await delay(30);
        return i;
      },
    }));
    const promise = runOcrTasks(tasks, { signal: controller.signal });
    setTimeout(() => controller.abort(), 10);
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    await delay(80);
    expect(started).toEqual([0]);
  });

  it("rejects immediately when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("custom reason"));
    await expect(
      runOcrTasks([{ run: async () => 1 }], { signal: controller.signal }),
    ).rejects.toThrow("custom reason");
  });
});

describe("convertToMarkdownDetailed", () => {
  it("returns the same markdown as convertToMarkdown plus page reports", async () => {
    const plain = await convertToMarkdown(mixedPdf, { fileName: "mixed.pdf" });
    const detailed = await convertToMarkdownDetailed(mixedPdf, { fileName: "mixed.pdf" });
    expect(detailed.markdown).toBe(plain);
    expect(detailed.extension).toBe(".pdf");
    expect(detailed.warnings).toEqual([]);
    expect(detailed.stats).toMatchObject({ pageCount: 3, ocrCalls: 0, ocrPages: 0, ocrImages: 0 });
    expect(detailed.pages?.map((p) => [p.page, p.source])).toEqual([
      [1, "text"],
      [2, "empty"],
      [3, "text"],
    ]);
    expect(detailed.pages?.[0].chars).toBeGreaterThan(100);
    expect(detailed.pages?.[1].chars).toBe(0);
    expect(detailed.images).toBeUndefined();
  });

  it("reports OCR pages, calls and stats in pdfMode always", async () => {
    const ocr: OCROptions = { provider: "handler", pdfMode: "always", handler: textHandler() };
    const detailed = await convertToMarkdownDetailed(mixedPdf, { fileName: "mixed.pdf", ocr });
    expect(detailed.markdown).toBe("OCR p1\n\nOCR p2\n\nOCR p3");
    expect(detailed.markdown).toBe(await convertToMarkdown(mixedPdf, { fileName: "mixed.pdf", ocr }));
    expect(detailed.stats).toMatchObject({ pageCount: 3, ocrCalls: 3, ocrPages: 3, ocrImages: 0 });
    expect(detailed.stats.ocrMs).toBeGreaterThanOrEqual(0);
    expect(detailed.stats.renderMs).toBeGreaterThanOrEqual(0);
    expect(detailed.pages).toHaveLength(3);
    for (const page of detailed.pages!) {
      expect(page).toMatchObject({ source: "ocr", reason: "always", chars: 5 });
      expect(typeof page.ms).toBe("number");
    }
  });

  it("falls back to the text layer and warns when OCR fails", async () => {
    const ocr: OCROptions = {
      provider: "handler",
      pdfMode: "always",
      handler: async (_b, ctx) => {
        if (ctx.page === 2) throw new Error("engine down");
        return "x";
      },
    };
    const detailed = await convertToMarkdownDetailed(mixedPdf, { fileName: "mixed.pdf", ocr });
    expect(detailed.markdown).toBe(await convertToMarkdown(mixedPdf, { fileName: "mixed.pdf" }));
    expect(detailed.warnings).toContain("ocr_page_failed: page 2: engine down");
    expect(detailed.pages?.map((p) => p.source)).toEqual(["text", "empty", "text"]);
  });

  it("throws 'PDF OCR failed' for a text-less PDF (legacy)", async () => {
    const scan = fixture("scan.pdf");
    await expect(
      convertToMarkdown(scan, {
        fileName: "scan.pdf",
        ocr: { provider: "handler", handler: async () => { throw new Error("nope"); } },
      }),
    ).rejects.toThrow("PDF OCR failed: nope");
  });

  it("reports an image with OCR text", async () => {
    const detailed = await convertToMarkdownDetailed(samplePng, {
      fileName: "sample.png",
      ocr: { provider: "handler", handler: async () => "hello world" },
    });
    expect(detailed.markdown).toContain("## Extracted Text\n\nhello world");
    expect(detailed.images).toEqual([
      { index: 0, kind: "image", path: "sample.png", width: 1400, height: 314, ocr: true, chars: 10 },
    ]);
    expect(detailed.stats).toMatchObject({ ocrCalls: 1, ocrImages: 1, ocrPages: 0 });
  });

  it("keeps the legacy OCR failure comment and records a warning", async () => {
    const detailed = await convertToMarkdownDetailed(samplePng, {
      fileName: "sample.png",
      ocr: { provider: "handler", handler: async () => { throw new Error("bad"); } },
    });
    expect(detailed.markdown).toContain("<!-- OCR failed: bad -->");
    expect(detailed.warnings).toEqual(["ocr_image_failed: sample.png: bad"]);
    expect(detailed.images?.[0]).toMatchObject({ ocr: false, error: "bad" });
  });

  it("honours onError skip and throw for images", async () => {
    const failing = async () => { throw new Error("bad"); };
    const skipped = await convertToMarkdown(samplePng, {
      fileName: "a.png",
      ocr: { provider: "handler", handler: failing, onError: "skip" },
    });
    expect(skipped).not.toContain("OCR failed");
    await expect(
      convertToMarkdown(samplePng, {
        fileName: "a.png",
        ocr: { provider: "handler", handler: failing, onError: "throw" },
      }),
    ).rejects.toThrow(/^bad$/);
  });

  it("reports a timeout as ocr_timeout", async () => {
    const detailed = await convertToMarkdownDetailed(samplePng, {
      fileName: "a.png",
      ocr: { provider: "handler", handler: () => new Promise<string>(() => undefined), timeoutMs: 20 },
    });
    expect(detailed.markdown).toContain("<!-- OCR failed: OCR timed out after 20ms -->");
    expect(detailed.warnings).toEqual(["ocr_timeout: a.png"]);
  });
});

describe("handler results and context", () => {
  it("accepts { text, markdown } results for images and PDFs", async () => {
    const image = await convertToMarkdown(samplePng, {
      fileName: "a.png",
      ocr: { provider: "handler", handler: async () => ({ text: " plain ", markdown: " rich markdown " }) },
    });
    expect(image).toContain("## Extracted Text\n\nrich markdown");

    const textOnly = await convertToMarkdown(samplePng, {
      fileName: "a.png",
      ocr: { provider: "handler", handler: async () => ({ text: " just text ", confidence: 0.9 }) },
    });
    expect(textOnly).toContain("## Extracted Text\n\njust text");

    const pdf = await convertToMarkdown(mixedPdf, {
      fileName: "m.pdf",
      ocr: {
        provider: "handler",
        pdfMode: "always",
        handler: async (_b, ctx) => ({ text: `t${ctx.page}`, markdown: `**m${ctx.page}**` }),
      },
    });
    expect(pdf).toBe("**m1**\n\n**m2**\n\n**m3**");
  });

  it("still accepts plain string handlers", async () => {
    const out = await ocrImage(Buffer.from("x"), { provider: "handler", handler: async () => "  hi  " });
    expect(out).toBe("hi");
  });

  it("passes kind, index, langHint and a signal to handlers", async () => {
    const seen: OCRHandlerContext[] = [];
    await convertToMarkdown(samplePng, {
      fileName: "a.png",
      ocr: { provider: "handler", lang: "tur+eng", handler: async (_b, ctx) => { seen.push(ctx); return "x"; } },
    });
    await convertToMarkdown(mixedPdf, {
      fileName: "m.pdf",
      ocr: { provider: "handler", pdfMode: "always", languages: ["tr", "en"], handler: async (_b, ctx) => { seen.push(ctx); return "x"; } },
    });
    expect(seen[0]).toMatchObject({ kind: "image", index: 0, langHint: ["tr", "en"], mimeType: "image/png" });
    expect(seen[0].signal).toBeInstanceOf(AbortSignal);
    expect(seen[1]).toMatchObject({ kind: "pdf-page", page: 1, pageCount: 3, langHint: ["tr", "en"] });
  });

  it("omits langHint when no language is configured", async () => {
    let ctx: OCRHandlerContext | undefined;
    await convertToMarkdown(samplePng, {
      fileName: "a.png",
      ocr: { provider: "handler", handler: async (_b, c) => { ctx = c; return "x"; } },
    });
    expect(ctx).not.toHaveProperty("langHint");
  });
});

describe("abort", () => {
  it("rejects with AbortError when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const handler = vi.fn(async () => "x");
    await expect(
      convertToMarkdown(samplePng, { fileName: "a.png", ocr: { provider: "handler", handler, signal: controller.signal } }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("is never swallowed by the image comment fallback or the PDF text fallback", async () => {
    const controller = new AbortController();
    const slow = (_b: Buffer, ctx: OCRHandlerContext) =>
      new Promise<string>((_, reject) => {
        setTimeout(() => controller.abort(), 10);
        ctx.signal?.addEventListener("abort", () => reject(new Error("handler saw abort")));
      });
    await expect(
      convertToMarkdown(samplePng, {
        fileName: "a.png",
        ocr: { provider: "handler", handler: slow, signal: controller.signal },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });

    const controller2 = new AbortController();
    const slow2 = (_b: Buffer, ctx: OCRHandlerContext) =>
      new Promise<string>((_, reject) => {
        setTimeout(() => controller2.abort(), 10);
        ctx.signal?.addEventListener("abort", () => reject(new Error("handler saw abort")));
      });
    await expect(
      convertToMarkdown(mixedPdf, {
        fileName: "m.pdf",
        ocr: { provider: "handler", pdfMode: "always", handler: slow2, signal: controller2.signal },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("tesseract session", () => {
  beforeEach(resetTesseractMocks);

  it("legacy: createWorker(lang) with the 3.5.0 arguments, terminated afterwards", async () => {
    const md = await convertToMarkdown(samplePng, { fileName: "a.png", ocr: true });
    expect(md).toContain("## Extracted Text\n\ntess text");
    expect(tess.createWorker).toHaveBeenCalledTimes(1);
    expect(tess.createWorker.mock.calls[0]).toEqual(["eng"]);
    expect(tess.terminate).toHaveBeenCalledTimes(1);
    expect(tess.setParameters).not.toHaveBeenCalled();
  });

  it("legacy: a custom lang is passed as-is", async () => {
    await convertToMarkdown(samplePng, { fileName: "a.png", ocr: { lang: "eng+tur" } });
    expect(tess.createWorker.mock.calls[0]).toEqual(["eng+tur"]);
  });

  it("maps ISO language codes to tesseract codes", async () => {
    await convertToMarkdown(samplePng, { fileName: "a.png", ocr: { lang: "tr+en" } });
    expect(tess.createWorker.mock.calls[0][0]).toBe("tur+eng");
    tess.createWorker.mockClear();
    await convertToMarkdown(samplePng, { fileName: "a.png", ocr: { languages: ["tr", "eng"] } });
    expect(tess.createWorker.mock.calls[0][0]).toBe("tur+eng");
  });

  it("uses one worker for all pages of a conversion", async () => {
    const md = await convertToMarkdown(mixedPdf, {
      fileName: "m.pdf",
      ocr: { pdfMode: "always" },
    });
    expect(md).toBe("tess text\n\ntess text\n\ntess text");
    expect(tess.createWorker).toHaveBeenCalledTimes(1);
    expect(tess.recognize).toHaveBeenCalledTimes(3);
    expect(tess.terminate).toHaveBeenCalledTimes(1);
  });

  it("terminates the worker when recognition fails", async () => {
    tess.recognize.mockRejectedValue(new Error("recognize failed"));
    const md = await convertToMarkdown(samplePng, { fileName: "a.png", ocr: true });
    expect(md).toContain("<!-- OCR failed: recognize failed -->");
    expect(tess.terminate).toHaveBeenCalledTimes(1);

    tess.terminate.mockClear();
    await expect(
      convertToMarkdown(fixture("scan.pdf"), { fileName: "scan.pdf", ocr: true }),
    ).rejects.toThrow("PDF OCR failed: recognize failed");
    expect(tess.terminate).toHaveBeenCalledTimes(1);
  });

  it("does not leak a worker on abort", async () => {
    const controller = new AbortController();
    tess.recognize.mockImplementation(() => new Promise(() => undefined));
    const promise = convertToMarkdown(samplePng, {
      fileName: "a.png",
      ocr: { signal: controller.signal },
    });
    setTimeout(() => controller.abort(), 20);
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(tess.terminate).toHaveBeenCalledTimes(1);
  });

  it("passes langPath, cachePath, gzip, psm and oem to the worker", async () => {
    await convertToMarkdown(samplePng, {
      fileName: "a.png",
      ocr: {
        lang: "tr",
        tesseract: { langPath: "/data/tess", cachePath: "/cache/tess", gzip: false, psm: 6, oem: 2 },
      },
    });
    expect(tess.createWorker).toHaveBeenCalledWith("tur", 2, {
      langPath: "/data/tess",
      cachePath: "/cache/tess",
      gzip: false,
    });
    expect(tess.setParameters).toHaveBeenCalledWith({ tessedit_pageseg_mode: "6" });
  });

  it("offline mode disables the cache and requires language files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tm-tess-"));
    try {
      writeFileSync(join(dir, "eng.traineddata.gz"), "x");
      await convertToMarkdown(samplePng, {
        fileName: "a.png",
        ocr: { tesseract: { offline: true, langPath: dir } },
      });
      expect(tess.createWorker).toHaveBeenCalledWith("eng", 1, { langPath: dir, cacheMethod: "none" });

      // Missing language file: fail fast, never create a worker, warn.
      tess.createWorker.mockClear();
      const detailed = await convertToMarkdownDetailed(samplePng, {
        fileName: "a.png",
        ocr: { lang: "tr+en", tesseract: { offline: true, langPath: dir } },
      });
      expect(tess.createWorker).not.toHaveBeenCalled();
      expect(detailed.warnings).toContain("tesseract_lang_missing: tur");
      expect(detailed.markdown).toContain("<!-- OCR failed: Tesseract language data for 'tur' not found");

      // gzip:false looks for the uncompressed file.
      writeFileSync(join(dir, "eng.traineddata"), "x");
      tess.createWorker.mockClear();
      await convertToMarkdown(samplePng, {
        fileName: "a.png",
        ocr: { tesseract: { offline: true, langPath: dir, gzip: false } },
      });
      expect(tess.createWorker).toHaveBeenCalledWith("eng", 1, {
        langPath: dir,
        gzip: false,
        cacheMethod: "none",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("offline mode without langPath is a clear error", async () => {
    const md = await convertToMarkdown(samplePng, {
      fileName: "a.png",
      ocr: { tesseract: { offline: true } },
    });
    expect(md).toContain("tesseract.offline requires tesseract.langPath");
    expect(tess.createWorker).not.toHaveBeenCalled();
  });

  it("uses a scheduler with min(concurrency, 4) workers", async () => {
    const md = await convertToMarkdown(mixedPdf, {
      fileName: "m.pdf",
      ocr: { pdfMode: "always", concurrency: 8 },
    });
    expect(md).toBe("tess text\n\ntess text\n\ntess text");
    expect(tess.createWorker).toHaveBeenCalledTimes(4);
    expect(tess.createScheduler).toHaveBeenCalledTimes(1);
    expect(tess.addWorker).toHaveBeenCalledTimes(4);
    expect(tess.addJob).toHaveBeenCalledTimes(3);
    expect(tess.terminate).not.toHaveBeenCalled();
    expect(tess.schedTerminate).toHaveBeenCalledTimes(1);
  });

  it("ocrImage() works standalone with its own worker", async () => {
    const text = await ocrImage(Buffer.from("png"), { lang: "en" });
    expect(text).toBe("tess text");
    expect(tess.createWorker.mock.calls[0]).toEqual(["eng"]);
    expect(tess.terminate).toHaveBeenCalledTimes(1);
  });
});

describe("VLM providers", () => {
  const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
    new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
  const openAiOk = () => jsonResponse({ choices: [{ message: { content: " vlm text " } }] });
  const anthropicOk = () => jsonResponse({ content: [{ text: " claude text " }] });
  const requestBody = (fetchMock: ReturnType<typeof vi.fn>, call = 0) =>
    JSON.parse(fetchMock.mock.calls[call][1].body as string);
  const openai: OCROptions = { provider: "openai-vlm", vlm: { model: "gpt", apiKey: "k" } };
  const anthropic: OCROptions = { provider: "anthropic-vlm", vlm: { model: "claude", apiKey: "k" } };

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("sends the real media type (openai) and keeps jpeg bytes untouched", async () => {
    const fetchMock = vi.fn(async () => openAiOk());
    vi.stubGlobal("fetch", fetchMock);
    const jpeg = fixture("rotated.jpg");
    const text = await ocrImage(jpeg, openai, { mimeType: "image/jpeg" });
    expect(text).toBe("vlm text");
    const url = requestBody(fetchMock).messages[0].content[1].image_url.url as string;
    expect(url.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(url.slice("data:image/jpeg;base64,".length)).toBe(jpeg.toString("base64"));
  });

  it("sends the real media type (anthropic) and webp as-is", async () => {
    const fetchMock = vi.fn(async () => anthropicOk());
    vi.stubGlobal("fetch", fetchMock);
    const webp = fixture("sample.webp");
    expect(await ocrImage(webp, anthropic, { mimeType: "image/webp" })).toBe("claude text");
    const source = requestBody(fetchMock).messages[0].content[0].source;
    expect(source).toMatchObject({ type: "base64", media_type: "image/webp" });
    expect(source.data).toBe(webp.toString("base64"));
  });

  it("sniffs the media type when the context has none", async () => {
    const fetchMock = vi.fn(async () => anthropicOk());
    vi.stubGlobal("fetch", fetchMock);
    await ocrImage(fixture("rotated.jpg"), anthropic);
    expect(requestBody(fetchMock).messages[0].content[0].source.media_type).toBe("image/jpeg");
    // unknown bytes keep the 3.5.0 default
    await ocrImage(Buffer.from("not an image"), anthropic);
    expect(requestBody(fetchMock, 1).messages[0].content[0].source.media_type).toBe("image/png");
  });

  it("transcodes TIFF and BMP to PNG", async () => {
    const fetchMock = vi.fn(async () => openAiOk());
    vi.stubGlobal("fetch", fetchMock);
    await ocrImage(fixture("multipage.tif"), openai, { mimeType: "image/tiff" });
    await ocrImage(fixture("sample.bmp"), openai, { mimeType: "image/bmp" });
    for (const call of [0, 1]) {
      const url = requestBody(fetchMock, call).messages[0].content[1].image_url.url as string;
      expect(url.startsWith("data:image/png;base64,")).toBe(true);
      const bytes = Buffer.from(url.split(",")[1], "base64");
      expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    }
  });

  it("retries on 429 honouring Retry-After and on 5xx with backoff", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("slow down", { status: 429, headers: { "retry-after": "3" } }))
      .mockResolvedValueOnce(new Response("oops", { status: 503 }))
      .mockResolvedValueOnce(openAiOk());
    vi.stubGlobal("fetch", fetchMock);

    const promise = ocrImage(samplePng, openai, { mimeType: "image/png" });
    await vi.advanceTimersByTimeAsync(2999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // second retry uses the 2 s backoff
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(await promise).toBe("vlm text");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries network errors and gives up with the original error message format", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => new Response("down", { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);
    const promise = ocrImage(samplePng, openai, { mimeType: "image/png" });
    const assertion = expect(promise).rejects.toThrow("openai-vlm request failed (502): down");
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3); // 1 + retries (2)
  });

  it("recovers from a transient network error", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(anthropicOk());
    vi.stubGlobal("fetch", fetchMock);
    const promise = ocrImage(samplePng, anthropic, { mimeType: "image/png" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(await promise).toBe("claude text");
  });

  it("does not retry client errors or when retries is 0", async () => {
    const fetchMock = vi.fn(async () => new Response("bad key", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(ocrImage(samplePng, openai, { mimeType: "image/png" })).rejects.toThrow(
      "openai-vlm request failed (401): bad key",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const failing = vi.fn(async () => new Response("down", { status: 500 }));
    vi.stubGlobal("fetch", failing);
    await expect(
      ocrImage(samplePng, { ...anthropic, vlm: { model: "c", apiKey: "k", retries: 0 } }, { mimeType: "image/png" }),
    ).rejects.toThrow("anthropic-vlm request failed (500): down");
    expect(failing).toHaveBeenCalledTimes(1);
  });

  it("stops retrying when Retry-After exceeds 30 s", async () => {
    const fetchMock = vi.fn(async () => new Response("later", { status: 429, headers: { "retry-after": "120" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(ocrImage(samplePng, openai, { mimeType: "image/png" })).rejects.toThrow(
      "openai-vlm request failed (429): later",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("times an attempt out with vlm.timeoutMs", async () => {
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init.signal!.addEventListener("abort", () => reject(init.signal!.reason));
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      ocrImage(samplePng, { ...openai, vlm: { model: "g", apiKey: "k", retries: 0, timeoutMs: 30 } }, { mimeType: "image/png" }),
    ).rejects.toThrow("request timed out after 30ms");
  });

  it("aborts a VLM request through the OCR signal without retrying", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init.signal!.addEventListener("abort", () => reject(init.signal!.reason));
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const promise = convertToMarkdown(samplePng, {
      fileName: "a.png",
      ocr: { ...openai, signal: controller.signal },
    });
    setTimeout(() => controller.abort(), 20);
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("parses Retry-After seconds and dates", () => {
    expect(parseRetryAfter("2")).toBe(2000);
    expect(parseRetryAfter("0")).toBe(0);
    expect(parseRetryAfter(undefined)).toBeUndefined();
    expect(parseRetryAfter("garbage")).toBeUndefined();
    const now = Date.parse("2026-10-28T10:00:00Z");
    expect(parseRetryAfter("Wed, 28 Oct 2026 10:00:05 GMT", now)).toBe(5000);
  });
});
