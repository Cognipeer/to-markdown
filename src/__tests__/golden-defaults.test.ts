/**
 * GOLDEN GUARD for the OCR pipeline work (spec 0.6).
 *
 * Records sha256 + length of `convertToMarkdown()` output for every file in
 * benchmark/test_files/**, benchmark/markitdown-comparison/corpus/** and
 * src/__tests__/fixtures/** under the 3.5.0 code and asserts it on every run,
 * so default behaviour can never change silently. Also pins the legacy OCR
 * paths (`ocr: { provider: 'handler', ... }` with pdfMode 'auto' / 'always',
 * single images, embedded images in DOCX/PPTX) using a deterministic fake handler.
 *
 * Deliberate exception: .tif/.tiff/.webp/.bmp were decoded as UTF-8 garbage in
 * 3.5.0 and are images from 3.6.0 on, so they are excluded from this guard.
 *
 * Record (only ever against the unmodified 3.5.0 behaviour):
 *   TM_GOLDEN_UPDATE=1 npx vitest run src/__tests__/golden-defaults.test.ts
 * A mismatch means default output changed: fix the code, do NOT re-record.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { convertToMarkdown } from "../convert.ts";
import type { OCRHandlerContext } from "../types/index.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GOLDEN_FILE = join(dirname(fileURLToPath(import.meta.url)), "__golden__", "default-outputs.json");
const UPDATE = process.env.TM_GOLDEN_UPDATE === "1";

const SCAN_DIRS = [
  "benchmark/test_files",
  "benchmark/markitdown-comparison/corpus",
  "src/__tests__/fixtures",
];
/** Deliberate 3.6.0 output change: these became images (spec 0.1). */
const EXCLUDED_EXT = new Set([".tif", ".tiff", ".webp", ".bmp"]);
const IGNORED_NAMES = new Set([".DS_Store"]);
/**
 * Conversions that take longer than 20 s are skipped (key -> reason).
 * Currently empty: every conversion finished well below the limit.
 */
const SKIPPED_SLOW: Record<string, string> = {};

const OCR_FIXTURE_DIR = "src/__tests__/fixtures/ocr";
const OCR_PDFS = [
  `${OCR_FIXTURE_DIR}/mixed.pdf`,
  `${OCR_FIXTURE_DIR}/scan.pdf`,
  `${OCR_FIXTURE_DIR}/stamp.pdf`,
  `${OCR_FIXTURE_DIR}/garbled.pdf`,
  "benchmark/test_files/test.pdf",
];
const OCR_IMAGES = [
  `${OCR_FIXTURE_DIR}/sample.png`,
  `${OCR_FIXTURE_DIR}/rotated.jpg`,
  "benchmark/test_files/test.jpg",
];
const OCR_OFFICE = [`${OCR_FIXTURE_DIR}/images.docx`, `${OCR_FIXTURE_DIR}/slides.pptx`];

type Entry = { sha256: string; length: number } | { error: string };
type GoldenFile = { description: string; entries: Record<string, Entry> };

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const rel = (p: string) => relative(ROOT, p).split(sep).join("/");

function listDefaultFiles(): string[] {
  const files: string[] = [];
  for (const d of SCAN_DIRS) walk(join(ROOT, d), files);
  return files
    .map(rel)
    .filter((f) => !IGNORED_NAMES.has(f.split("/").pop() as string))
    .filter((f) => !EXCLUDED_EXT.has(extname(f).toLowerCase()))
    .sort();
}

/** Deterministic fake OCR handler: output depends only on the page number. */
const fakeHandler = async (_b: Buffer, ctx: OCRHandlerContext) => "OCR p" + (ctx.page ?? 0);

function hashOf(text: string): Entry {
  return { sha256: createHash("sha256").update(text, "utf8").digest("hex"), length: text.length };
}

async function run(
  key: string,
  file: string,
  options: Record<string, unknown>,
  timings: Record<string, number>,
): Promise<Entry | undefined> {
  if (SKIPPED_SLOW[key]) return undefined;
  const buffer = readFileSync(join(ROOT, file));
  const started = Date.now();
  let entry: Entry;
  try {
    const text = await convertToMarkdown(buffer, { fileName: file.split("/").pop(), ...options });
    entry = hashOf(text);
  } catch (e) {
    entry = { error: e instanceof Error ? e.message : String(e) };
  }
  timings[key] = Date.now() - started;
  return entry;
}

async function computeDefaults(timings: Record<string, number>) {
  const entries: Record<string, Entry> = {};
  for (const file of listDefaultFiles()) {
    const key = `default:${file}`;
    const e = await run(key, file, {}, timings);
    if (e) entries[key] = e;
  }
  return entries;
}

async function computeLegacyOcr(timings: Record<string, number>) {
  const entries: Record<string, Entry> = {};
  const ocrWith = (pdfMode?: string) => ({
    provider: "handler" as const,
    handler: fakeHandler,
    ...(pdfMode ? { pdfMode } : {}),
  });
  for (const file of OCR_PDFS) {
    for (const mode of ["auto", "always"]) {
      const key = `ocr-handler:${mode}:${file}`;
      const e = await run(key, file, { ocr: ocrWith(mode) }, timings);
      if (e) entries[key] = e;
    }
  }
  for (const file of [...OCR_IMAGES, ...OCR_OFFICE]) {
    const key = `ocr-handler:${file}`;
    const e = await run(key, file, { ocr: ocrWith() }, timings);
    if (e) entries[key] = e;
  }
  return entries;
}

function readGolden(): GoldenFile {
  if (!existsSync(GOLDEN_FILE)) return { description: "", entries: {} };
  return JSON.parse(readFileSync(GOLDEN_FILE, "utf8")) as GoldenFile;
}

function writeGolden(prefix: string, entries: Record<string, Entry>) {
  const golden = readGolden();
  golden.description =
    "sha256+length of convertToMarkdown() output recorded against @cognipeer/to-markdown 3.5.0. " +
    "Never re-record to silence a failure; see golden-defaults.test.ts.";
  for (const k of Object.keys(golden.entries)) if (k.startsWith(prefix)) delete golden.entries[k];
  Object.assign(golden.entries, entries);
  const sorted: Record<string, Entry> = {};
  for (const k of Object.keys(golden.entries).sort()) sorted[k] = golden.entries[k];
  golden.entries = sorted;
  mkdirSync(dirname(GOLDEN_FILE), { recursive: true });
  writeFileSync(GOLDEN_FILE, JSON.stringify(golden, null, 2) + "\n");
}

function check(prefix: string, actual: Record<string, Entry>, timings: Record<string, number>) {
  if (UPDATE) {
    writeGolden(prefix, actual);
    const slow = Object.entries(timings).filter(([, ms]) => ms > 20_000);
    if (slow.length) console.warn("Conversions slower than 20 s (add to SKIPPED_SLOW):", slow);
    return;
  }
  const golden = readGolden().entries;
  const mismatches: string[] = [];
  const unrecorded: string[] = [];
  for (const [key, entry] of Object.entries(actual)) {
    const want = golden[key];
    if (!want) {
      unrecorded.push(key);
      continue;
    }
    if (JSON.stringify(want) !== JSON.stringify(entry)) {
      mismatches.push(`${key}\n    golden: ${JSON.stringify(want)}\n    actual: ${JSON.stringify(entry)}`);
    }
  }
  for (const key of Object.keys(golden)) {
    if (key.startsWith(prefix) && !(key in actual) && !SKIPPED_SLOW[key]) {
      mismatches.push(`${key}\n    golden entry present but the file/conversion disappeared`);
    }
  }
  if (unrecorded.length) {
    console.warn(`Golden guard: ${unrecorded.length} entries have no recorded golden (new files?):\n  ${unrecorded.join("\n  ")}`);
  }
  expect(mismatches, `Default output changed for:\n${mismatches.join("\n")}`).toEqual([]);
}

describe("golden guard: default outputs (3.5.0)", () => {
  it("has a recorded golden file", () => {
    if (UPDATE) return;
    expect(existsSync(GOLDEN_FILE), "run TM_GOLDEN_UPDATE=1 once against unmodified code").toBe(true);
    expect(Object.keys(readGolden().entries).length).toBeGreaterThan(50);
  });

  it("convertToMarkdown(buffer, { fileName }) is byte-identical for every benchmark / corpus / fixture file", async () => {
    const timings: Record<string, number> = {};
    const actual = await computeDefaults(timings);
    check("default:", actual, timings);
  }, 600_000);

  it("legacy OCR paths (handler provider, pdfMode auto/always, images, embedded images) are byte-identical", async () => {
    const timings: Record<string, number> = {};
    const actual = await computeLegacyOcr(timings);
    check("ocr-handler:", actual, timings);
  }, 600_000);
});
