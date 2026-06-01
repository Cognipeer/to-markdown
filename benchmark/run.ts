import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it } from 'vitest';
import { convertToMarkdown } from '../src/index.ts';

const DIR = join(process.cwd(), 'benchmark/test_files');

interface Vector {
  file: string;
  options?: Record<string, string>;
  mustInclude: string[];
  mustNotInclude: string[];
}

const vectors: Vector[] = [
  {
    file: 'test.docx',
    mustInclude: ['Abstract', 'Introduction', 'AutoGen'],
    mustNotInclude: [],
  },
  {
    file: 'test.xlsx',
    mustInclude: ['09060124', '6ff4173b', 'affc7dad'],
    mustNotInclude: [],
  },
  {
    file: 'test.xls',
    mustInclude: ['09060124', '6ff4173b'],
    mustNotInclude: [],
  },
  {
    file: 'test.pptx',
    mustInclude: ['2cdda5c8', 'AutoGen', '04191ea8'],
    mustNotInclude: [],
  },
  {
    file: 'test.pdf',
    mustInclude: ['AutoGen', 'multi-agent'],
    mustNotInclude: [],
  },
  {
    file: 'test_blog.html',
    mustInclude: ['Large language models', 'GPT-4'],
    mustNotInclude: [],
  },
  {
    file: 'test_wikipedia.html',
    mustInclude: ['Microsoft', 'operating system', 'Bill Gates'],
    mustNotInclude: ['move to sidebar', '154 languages'],
  },
  {
    file: 'test_serp.html',
    mustInclude: ['Microsoft', 'Wikipedia'],
    mustNotInclude: [],
  },
  {
    file: 'test_mskanji.csv',
    mustInclude: ['名前', '佐藤太郎', '東京'],
    mustNotInclude: [],
  },
  {
    file: 'test_rss.xml',
    mustInclude: ['AutoGen', 'Copilot'],
    mustNotInclude: ['<rss', '<feed'],
  },
  {
    file: 'test_notebook.ipynb',
    mustInclude: ['markitdown', '```'],
    mustNotInclude: ['nbformat'],
  },
  {
    file: 'test_files.zip',
    mustInclude: ['AutoGen', 'Abstract'],
    mustNotInclude: [],
  },
  {
    file: 'test.epub',
    mustInclude: [],     // We don't support EPUB
    mustNotInclude: [],
    // Expected to FAIL
  },
  {
    file: 'test.jpg',
    mustInclude: ['jpg', 'jpeg', 'png', 'width', 'height', 'format', 'size'].slice(0, 2),
    mustNotInclude: [],
  },
  {
    file: 'test.mp3',
    mustInclude: [],     // basic metadata only
    mustNotInclude: [],
  },
];

// ── ANSI colours ──────────────────────────────────────────────────────────
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const BOLD   = '\x1b[1m';
const RESET  = '\x1b[0m';

// ── Run ───────────────────────────────────────────────────────────────────
interface Result {
  file: string;
  pass: boolean;
  skipped: boolean;
  output: string;
  missing: string[];
  forbidden: string[];
  error?: string;
  ms: number;
}

const results: Result[] = [];

for (const v of vectors) {
  const buf = readFileSync(join(DIR, v.file));
  const ext = '.' + v.file.split('.').pop()!;
  const t0 = Date.now();
  let output = '';
  let error: string | undefined;

  try {
    output = await convertToMarkdown(buf, { forceExtension: ext, fileName: v.file });
  } catch (e: any) {
    error = e.message;
  }

  const ms = Date.now() - t0;
  const lower = output.toLowerCase();

  const missing   = v.mustInclude.filter(s => !lower.includes(s.toLowerCase()));
  const forbidden = v.mustNotInclude.filter(s => lower.includes(s.toLowerCase()));

  const skipped = v.mustInclude.length === 0 && v.mustNotInclude.length === 0;
  const pass    = !error && missing.length === 0 && forbidden.length === 0;

  results.push({ file: v.file, pass, skipped, output, missing, forbidden, error, ms });
}

// ── Print table ───────────────────────────────────────────────────────────
const COL = [28, 8, 8, 40];
const hr  = '─'.repeat(COL.reduce((a, b) => a + b + 3, 0));

function pad(s: string, n: number) { return s.slice(0, n).padEnd(n); }

console.log(`\n${BOLD}${CYAN}  MarkItDown Test Vectors — @cognipeer/to-markdown${RESET}`);
console.log(`  ${hr}`);
console.log(`  ${BOLD}${pad('File', COL[0])} │ ${pad('Result', COL[1])} │ ${pad('Time', COL[2])} │ Notes${RESET}`);
console.log(`  ${hr}`);

let passed = 0, failed = 0, skipped = 0;

for (const r of results) {
  let badge: string;
  let notes = '';

  if (r.skipped && r.error) {
    badge = `${RED}FAIL  ${RESET}`;
    notes = r.error.slice(0, 60);
    failed++;
  } else if (r.skipped) {
    badge = `${YELLOW}SKIP  ${RESET}`;
    notes = 'no assertions (unsupported format)';
    skipped++;
  } else if (r.pass) {
    badge = `${GREEN}PASS  ${RESET}`;
    passed++;
  } else {
    badge = `${RED}FAIL  ${RESET}`;
    if (r.error) notes = r.error.slice(0, 60);
    else if (r.missing.length)   notes = `missing: ${r.missing.join(', ')}`;
    else if (r.forbidden.length) notes = `found forbidden: ${r.forbidden.join(', ')}`;
    failed++;
  }

  const time = `${r.ms}ms`;
  console.log(`  ${pad(r.file, COL[0])} │ ${badge}${pad('', 0)} │ ${pad(time, COL[2])} │ ${notes}`);
}

console.log(`  ${hr}`);
const total = results.length;
const score = Math.round((passed / (total - skipped)) * 100);
console.log(`\n  ${BOLD}Passed: ${GREEN}${passed}${RESET}  Failed: ${RED}${failed}${RESET}  Skipped: ${YELLOW}${skipped}${RESET}  →  Score: ${BOLD}${score}% (${passed}/${total - skipped})${RESET}\n`);

// ── Failed detail ─────────────────────────────────────────────────────────
const failures = results.filter(r => !r.pass && !r.skipped);
if (failures.length > 0) {
  console.log(`${BOLD}  Failed details:${RESET}`);
  for (const r of failures) {
    console.log(`\n  ${RED}✗ ${r.file}${RESET}`);
    if (r.error) console.log(`    Error: ${r.error}`);
    if (r.missing.length)   console.log(`    Missing  : ${r.missing.join(', ')}`);
    if (r.forbidden.length) console.log(`    Forbidden: ${r.forbidden.join(', ')}`);
    if (r.output) console.log(`    Output preview: ${r.output.slice(0, 200).replace(/\n/g, ' ')}`);
  }
  console.log();
}
