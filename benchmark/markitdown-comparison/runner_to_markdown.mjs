// Long-lived @cognipeer/to-markdown runner (public API, default options:
// no `ocr`, so OCR is never triggered).
// Per file: 1 warm-up conversion (its output is saved) then N timed runs.
// Usage: node --max-old-space-size=4096 runner_to_markdown.mjs results/jobs.json results/to-markdown [runs]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const here = dirname(fileURLToPath(import.meta.url));
const { convertToMarkdown } = await import(join(here, '..', '..', 'dist', 'index.js'));
const pkg = JSON.parse(readFileSync(join(here, '..', '..', 'package.json'), 'utf8'));

const [jobsFile, outDir, runsArg] = process.argv.slice(2);
const runs = Number(runsArg ?? 5);
const jobs = JSON.parse(readFileSync(jobsFile, 'utf8'));
mkdirSync(outDir, { recursive: true });

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const p95 = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]; };
const r2 = (x) => Math.round(x * 100) / 100;

const files = {};
for (const job of jobs) {
  const rec = { ok: false };
  try {
    const text = await convertToMarkdown(job.path);
    writeFileSync(join(outDir, `${job.id}.md`), text, 'utf8');
    rec.out_chars = text.length;
    const times = [];
    for (let i = 0; i < runs; i++) {
      const t0 = performance.now();
      await convertToMarkdown(job.path);
      times.push(performance.now() - t0);
    }
    Object.assign(rec, { ok: true, runs_ms: times.map(r2), median_ms: r2(median(times)), p95_ms: r2(p95(times)) });
  } catch (e) {
    rec.error = `${e?.name ?? 'Error'}: ${String(e?.message ?? e).slice(0, 400)}`;
    writeFileSync(join(outDir, `${job.id}.md`), '', 'utf8');
  }
  files[job.id] = rec;
  console.log(`${job.id.padEnd(45)} ${rec.ok ? 'ok ' : 'ERR'} ${rec.median_ms ?? '-'}`);
}
const meta = { tool: 'to-markdown', version: pkg.version, node: process.version, runs, warmups: 1 };
writeFileSync(join(outDir, 'timings.json'), JSON.stringify({ meta, files }, null, 2) + '\n');
