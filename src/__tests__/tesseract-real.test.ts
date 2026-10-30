/**
 * Real Tesseract engine test. Skipped unless both env vars are set:
 *
 *   TM_TEST_TESSERACT=1 TM_TESSDATA_DIR=/path/to/tessdata npx vitest run src/__tests__/tesseract-real.test.ts
 *
 * TM_TESSDATA_DIR must hold `tur.traineddata.gz` and `eng.traineddata.gz`
 * (from the `@tesseract.js-data/tur` and `@tesseract.js-data/eng` npm packages,
 * folder `4.0.0_best_int`). The test runs offline: nothing is downloaded.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { convertToMarkdown, convertToMarkdownDetailed } from "../index.ts";
import type { OCROptions } from "../types/index.ts";

const enabled = process.env.TM_TEST_TESSERACT === "1" && !!process.env.TM_TESSDATA_DIR;
const fixture = (name: string): Buffer =>
  readFileSync(new URL(`./fixtures/ocr/${name}`, import.meta.url));

/** Lower-case and drop diacritics so a small OCR slip on a Turkish letter does not fail the test. */
const fold = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i")
    .toLowerCase();

const ocrOptions = (extra: Partial<OCROptions> = {}): OCROptions => ({
  provider: "tesseract",
  lang: "tr+en",
  tesseract: { offline: true, langPath: process.env.TM_TESSDATA_DIR },
  ...extra,
});

describe.skipIf(!enabled)("real tesseract (tr+en, offline)", () => {
  it("reads Turkish and English words from sample.png", async () => {
    const t0 = Date.now();
    const md = fold(await convertToMarkdown(fixture("sample.png"), { fileName: "sample.png", ocr: ocrOptions() }));
    console.log(`[tesseract-real] sample.png ${Date.now() - t0} ms`);
    for (const word of ["guvenlik", "politikasi", "quarterly", "revenue"]) {
      expect(md).toContain(word);
    }
  }, 180_000);

  it("reads scan.pdf page by page with pdfMode auto-page", async () => {
    const t0 = Date.now();
    const result = await convertToMarkdownDetailed(fixture("scan.pdf"), {
      fileName: "scan.pdf",
      ocr: ocrOptions({ pdfMode: "auto-page" }),
    });
    console.log(`[tesseract-real] scan.pdf auto-page ${Date.now() - t0} ms (ocrMs ${result.stats.ocrMs})`);
    const md = fold(result.markdown);
    for (const word of ["yonetim", "tutanagi", "compliance", "review", "fatura", "invoice"]) {
      expect(md).toContain(word);
    }
    expect(result.pages?.map((p) => p.source)).toEqual(["ocr", "ocr"]);
    expect(result.stats.ocrPages).toBe(2);
  }, 300_000);
});
