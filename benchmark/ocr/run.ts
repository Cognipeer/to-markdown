/**
 * OCR benchmark: converts every file of a directory in three modes and writes
 * one JSON report. Not part of `npm test`.
 *
 *   npx tsx benchmark/ocr/run.ts --dir <files> --out <report-dir> --tessdata <tessdata> [--lang tr+en] [--concurrency 2]
 *
 * Modes:
 *   off        no OCR (text layers only)
 *   legacy     ocr + pdfMode 'auto'      (3.5.0 behaviour: OCR the whole document only when it has no text)
 *   auto-page  ocr + pdfMode 'auto-page' (OCR only the pages that need it)
 *
 * Tesseract runs offline from --tessdata (needs <lang>.traineddata.gz files).
 */
import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { convertToMarkdownDetailed } from "../../src/index.ts";
import type { ConverterOptions } from "../../src/types/index.ts";

type Mode = "off" | "legacy" | "auto-page";
const MODES: Mode[] = ["off", "legacy", "auto-page"];

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = "true";
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) files.push(...walk(full));
    else if (st.isFile() && !name.startsWith(".")) files.push(full);
  }
  return files;
}

function optionsFor(mode: Mode, lang: string, tessdata: string, concurrency: number): ConverterOptions {
  if (mode === "off") return {};
  return {
    ocr: {
      provider: "tesseract",
      lang,
      pdfMode: mode === "legacy" ? "auto" : "auto-page",
      concurrency,
      tesseract: { offline: true, langPath: tessdata },
    },
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.dir || !args.out || !args.tessdata) {
    console.error(
      "usage: tsx benchmark/ocr/run.ts --dir <files> --out <report-dir> --tessdata <tessdata-dir> [--lang tr+en] [--concurrency 1]"
    );
    process.exit(2);
  }
  const dir = resolve(args.dir);
  const out = resolve(args.out);
  const tessdata = resolve(args.tessdata);
  const lang = args.lang ?? "eng";
  const concurrency = Math.max(1, Number(args.concurrency ?? 1) || 1);
  mkdirSync(join(out, "markdown"), { recursive: true });

  const results: Array<Record<string, unknown>> = [];
  for (const file of walk(dir)) {
    const rel = relative(dir, file);
    const entry: Record<string, unknown> = { file: rel, ext: extname(file).toLowerCase(), modes: {} };
    for (const mode of MODES) {
      const started = Date.now();
      try {
        const detailed = await convertToMarkdownDetailed(file, {
          fileName: basename(file),
          ...optionsFor(mode, lang, tessdata, concurrency),
        });
        const totalMs = Date.now() - started;
        const mdName = `${rel.replace(/[\\/]/g, "__")}.${mode}.md`;
        writeFileSync(join(out, "markdown", mdName), detailed.markdown);
        (entry.modes as Record<string, unknown>)[mode] = {
          ok: true,
          totalMs,
          chars: detailed.markdown.length,
          markdownFile: `markdown/${mdName}`,
          stats: detailed.stats,
          pages: detailed.pages,
          images: detailed.images,
          warnings: detailed.warnings,
        };
        console.log(`${rel} [${mode}] ${totalMs} ms, ${detailed.markdown.length} chars, ocr calls ${detailed.stats.ocrCalls}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        (entry.modes as Record<string, unknown>)[mode] = { ok: false, totalMs: Date.now() - started, error: message };
        console.log(`${rel} [${mode}] FAILED: ${message}`);
      }
    }
    results.push(entry);
  }

  const report = { generatedAt: new Date().toISOString(), dir, lang, concurrency, tessdata, results };
  writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
  console.log(`wrote ${join(out, "report.json")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
