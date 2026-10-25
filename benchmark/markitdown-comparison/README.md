# Benchmark: @cognipeer/to-markdown vs Microsoft MarkItDown

## What this is, and a disclosure

This folder compares [`@cognipeer/to-markdown`](https://github.com/Cognipeer/to-markdown) with
[Microsoft MarkItDown](https://github.com/microsoft/markitdown) on the document formats both
libraries support, using a small corpus with known ground truth. Everything needed to reproduce
the numbers is here: `./run.sh`.

**Disclosure: this benchmark was written by the to-markdown maintainers.** We tried to be fair
(identical inputs and scoring for both tools, default options, no per-tool tuning, element types a
format cannot carry are never scored, losses are reported), but the corpus design, the metrics and
the choice of formats are our choices. The corpus is synthetic and small. Read the results as
"what we measured on this corpus", not as a verdict. Issues and pull requests that make the
benchmark fairer are welcome, including ones that make MarkItDown look better.

## Versions and machine

| | |
| --- | --- |
| @cognipeer/to-markdown | 3.5.0 (commit `b3b1dad`), default options, no `ocr` option, so OCR never runs |
| MarkItDown | 0.1.9 (latest on PyPI on 2026-10-25), `pip install 'markitdown[pdf,docx,pptx,xlsx,xls]'`, no LLM client, no plugins |
| MarkItDown dependencies | pdfminer.six 20260107, mammoth 1.13.0, python-pptx 1.0.2, openpyxl 3.1.5, pandas 3.1.0, markdownify 1.2.3, beautifulsoup4 4.15.0 |
| Runtime | Node v24.10.0, Python 3.13.9 |
| Machine | Apple M4 Max (14 cores), 36 GB RAM, macOS (Darwin 27.2.0, arm64), single machine, single run |
| PDF generation | Google Chrome 155.0.8059.85, headless, `--print-to-pdf` |

The MarkItDown README on `main` describes features that are not in the 0.1.9 release (for example
the `markitdown-ocr` plugin and Azure Content Understanding). We benchmarked the released package,
not `main`. The full machine and version record of the committed run is in `results/env.json`.

## Method

### Formats compared

Only formats both libraries support: **PDF, DOCX, PPTX, XLSX, HTML, CSV**. Other shared formats
(EPUB, Jupyter notebooks, ZIP, RSS/XML, images, audio, Outlook `.msg`) are out of scope, as are
features only one tool has (OCR, LLM image descriptions, URL and YouTube input, `.doc`).

### Corpus and ground truth

`ground_truth/` holds 10 hand-authored Markdown documents. They cover headings (h1 to h3),
paragraphs, bullet and numbered lists, tables with numbers and **empty cells**, links,
bold and italic, Turkish text (ç ğ ı ö ş ü İ), accented Latin (French, Spanish, German, Polish),
Japanese and Chinese text, and one 16-page, roughly 5,000-word report (`05_long_report`).

`generate_corpus.py` renders them deterministically into `corpus/` (27 scored files):

| Source documents | Rendered as | Files |
| --- | --- | --- |
| `01` to `05` (prose, tables, long report) | DOCX (python-docx, real Heading 1 to 3, List Bullet and List Number styles, real tables, real hyperlinks), HTML, text-based PDF (HTML printed by headless Chrome, no header or footer) | 15 |
| `06`, `07` (slide-style) | PPTX (python-pptx: title slide, then one slide per h2 with bullets and/or a table) | 2 |
| `08` to `10` (table-style) | XLSX (one sheet per table, numeric cells stay numeric) and CSV (one file per table) | 3 + 7 |

`corpus/manifest.json` maps each file to its ground truth and to the elements that format can
carry, so scoring never penalises an impossible element:

* XLSX and CSV carry only text, order and tables (no headings, lists or links).
* PPTX has slide titles but no heading levels, and the generated decks have no numbered lists.
* DOCX and HTML carry everything. PDF structure is only visual, but the information is present
  in the page, so PDF is scored on everything. Link URLs live in PDF link annotations, not in text.
* An element is scored for a file only if the ground truth of that file contains it.

The corpus is committed (under 1 MB) so the exact bytes are reproducible. DOCX, PPTX, XLSX, HTML
and CSV regenerate byte-identically; PDFs embed a creation date written by Chrome, so a
regenerated PDF differs in bytes (not in content).

The pre-existing `benchmark/test_files` (they come from the MarkItDown test suite and contain
scraped third-party pages, so we do not treat their licence as clear) are **not copied** and are
**not fidelity-scored**. They are run in place for speed and success/failure only, restricted to
the same core formats.

### Metrics (`score.py`, deterministic)

Both ground truth and tool output go through the same normalisation: strip HTML comments and tags,
strip Markdown syntax (heading, list and quote markers, table pipes and separator rows, emphasis,
code ticks, backslash escapes such as `\_`, link and image wrappers keep only their visible text),
Unicode **NFKC**, lowercase, then tokenise (each CJK character is one token, decimals are compared
by value so `9.50` equals `9.5`).

| Metric | Definition |
| --- | --- |
| Text F1 | Bag-of-words F1 of output against ground truth |
| Reading order | `difflib.SequenceMatcher` ratio on the two word sequences (also drops when words are missing or extra) |
| Heading recall | Fraction of ground-truth headings that appear as a Markdown heading line (any level) with the same text |
| Heading level | Fraction of ground-truth headings found as a heading with exactly the same level (so it cannot exceed heading recall) |
| List recall | Fraction of ground-truth list items whose text appears contiguously in the output (marker not required) |
| List markup | Like list recall, but the item must sit on a line that starts with a list marker. DOCX, HTML, PDF only |
| Table cell F1 | F1 of the multiset of non-empty cells parsed from Markdown pipe tables. A tool that writes `NaN` for an empty cell is penalised for it |
| Link recall | Fraction of ground-truth URLs present in the output |
| Structure score | Unweighted mean of heading recall, heading level, list recall, table F1 and link recall, over the metrics that apply to a file, then averaged over files. Used only for the headline table, so read the individual metrics too |

Per-format numbers are the macro average over files. A failed conversion counts as empty output,
so it scores 0. `score.py` was self-checked: ground truth scored against itself gives 100 on every
metric, empty output gives 0, shuffled paragraphs lower only the order score, and removing table
pipes lowers only the table score.

### Timing

One long-lived process per tool (a Node process calling the public `convertToMarkdown(path)`, a
Python process calling `MarkItDown().convert(path).text_content`). Per file: 1 warm-up conversion
(its output is the one scored), then 5 timed conversions with a monotonic clock around the whole
call including reading the file. We report the median and the p95 (nearest rank, so with 5 runs
the p95 is the slowest run). Tools run strictly one after the other. These are warm, in-process
times: interpreter start-up, imports and first-call costs are deliberately excluded, so they say
nothing about one-off CLI invocations.

## Results

All numbers below are copied from `results/summary.md` (committed run, 2026-10-25). Every cell is
`to-markdown / MarkItDown`. Scores are percentages, higher is better. Times are milliseconds,
lower is better. Raw data is in `results/summary.json`, including every per-file score and every
timing run (`results/*/timings.json`).

Headline (structure score and text F1 averaged over files; see Metrics):

| Format | Files | Text F1 | Structure score | Median ms/file |
| --- | --- | --- | --- | --- |
| DOCX | 5 | 100.0 / 100.0 | 100.0 / 100.0 | 20.8 / 93.6 |
| PDF | 5 | 98.8 / 100.0 | 30.8 / 29.0 | 8.98 / 94.8 |
| PPTX | 2 | 100.0 / 100.0 | 25.0 / 75.0 | 1.40 / 9.61 |
| XLSX | 3 | 100.0 / 97.8 | 100.0 / 96.7 | 1.57 / 5.57 |
| HTML | 5 | 100.0 / 100.0 | 100.0 / 100.0 | 1.12 / 3.22 |
| CSV | 7 | 100.0 / 100.0 | 100.0 / 100.0 | 0.04 / 1.66 |

### Fidelity by format

| Format | Text F1 | Reading order | Heading recall | Heading level | List recall | List markup | Table cell F1 | Link recall |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| DOCX | 100.0 / 100.0 | 100.0 / 100.0 | 100.0 / 100.0 | 100.0 / 100.0 | 100.0 / 100.0 | 100.0 / 100.0 | 100.0 / 100.0 | 100.0 / 100.0 |
| PDF | 98.8 / 100.0 | 98.8 / 97.9 | 0.0 / 0.0 | 0.0 / 0.0 | 96.4 / 100.0 | 36.6 / 43.3 | 66.7 / 50.0 | 0.0 / 0.0 |
| PPTX | 100.0 / 100.0 | 100.0 / 100.0 | 0.0 / 100.0 | n/a / n/a | 100.0 / 100.0 | n/a / n/a | 0.0 / 100.0 | 0.0 / 0.0 |
| XLSX | 100.0 / 97.8 | 100.0 / 97.8 | n/a / n/a | n/a / n/a | n/a / n/a | n/a / n/a | 100.0 / 96.7 | n/a / n/a |
| HTML | 100.0 / 100.0 | 100.0 / 100.0 | 100.0 / 100.0 | 100.0 / 100.0 | 100.0 / 100.0 | 100.0 / 100.0 | 100.0 / 100.0 | 100.0 / 100.0 |
| CSV | 100.0 / 100.0 | 100.0 / 100.0 | n/a / n/a | n/a / n/a | n/a / n/a | n/a / n/a | 100.0 / 100.0 | n/a / n/a |

### Speed

| Format | Median of per-file medians (ms) | Sum of per-file medians (ms) | Failures |
| --- | --- | --- | --- |
| DOCX | 20.8 / 93.6 | 108.3 / 439.1 | 0 / 0 |
| PDF | 8.98 / 94.8 | 90.5 / 1005.4 | 0 / 0 |
| PPTX | 1.40 / 9.61 | 2.80 / 19.2 | 0 / 0 |
| XLSX | 1.57 / 5.57 | 4.88 / 18.5 | 0 / 0 |
| HTML | 1.12 / 3.22 | 11.4 / 21.8 | 0 / 0 |
| CSV | 0.04 / 1.66 | 0.32 / 12.3 | 0 / 0 |

On the existing `benchmark/test_files`, both tools converted every file without error (times in
ms, median / p95):

| File | to-markdown ms (median / p95) | MarkItDown ms (median / p95) | Status |
| --- | --- | --- | --- |
| test.docx | 10.9 / 13.2 | 18.3 / 19.2 | both ok |
| test.xlsx | 1.99 / 2.15 | 8.40 / 8.72 | both ok |
| test.xls | 0.25 / 0.35 | 6.06 / 6.22 | both ok |
| test.pptx | 3.04 / 3.24 | 8.77 / 29.6 | both ok |
| test.pdf | 11.0 / 13.1 | 73.5 / 92.6 | both ok |
| test_blog.html | 3.56 / 4.17 | 7.91 / 8.44 | both ok |
| test_wikipedia.html | 55.0 / 56.7 | 124.3 / 124.5 | both ok |
| test_serp.html | 26.1 / 35.8 | 28.3 / 71.3 | both ok |
| test_mskanji.csv | 0.04 / 0.07 | 1.86 / 2.06 | both ok |

### Failures

Neither tool raised an error on any of the 27 scored files or the 9 robustness files.

## Where each tool is stronger

**MarkItDown is stronger**

* **PPTX.** MarkItDown writes slide titles as `#` headings, and tables as Markdown tables
  (heading recall 100, table F1 100). to-markdown 3.5.0 returns the slide text as flat lines:
  no headings, no list markers and no table structure (heading recall 0, table F1 0), although
  all words are present (text F1 100). This is the largest gap in the benchmark and it favours
  MarkItDown.
* **PDF text fidelity.** MarkItDown scored 100.0 text F1 against 98.8 on our PDFs. The difference
  comes from ligatures: the font Chrome picked renders `fi`/`fl` as ligature glyphs, and to-markdown emits
  them as split words (`fl at`, `fi gures`). MarkItDown keeps the ligature code point, which our
  NFKC normalisation folds back. With plain NFC (see the sensitivity table in `results/summary.md`)
  the gap narrows to 98.4 against 99.0, because MarkItDown then pays for the ligature and
  CJK compatibility code points. Either way, a plain-string search on either tool's output would
  miss those words.
* **PDF list markup**, slightly (43.3 against 36.6).

**to-markdown is stronger**

* **XLSX.** MarkItDown (through pandas) writes `NaN` for every empty cell, and integer columns that
  contain an empty cell come out as floats (`1200.0`, `40.0`). to-markdown keeps empty cells empty
  and numbers as stored. Table F1 100.0 against 96.7.
* **Speed.** to-markdown was faster on every format in the warm, in-process measurement: roughly
  3x to 7x on DOCX, XLSX, HTML and PPTX, about 10x on PDF (13x on the long report), about 24x on
  the small XLS file and about 40x on tiny CSV files. The one near-tie is `test_serp.html`
  (26.1 ms against 28.3 ms median; MarkItDown's p95 was 71.3 ms). We did not profile why the gap
  is so large on tiny files; per-call overhead in MarkItDown is a likely contributor, which would
  matter only when converting many small files.
* **PDF tables**, on this corpus: 66.7 against 50.0 table F1. MarkItDown scrambled the column order
  of the table in `04_multilingual.pdf`. to-markdown, however, merged the surrounding Japanese and
  Chinese paragraphs into that table, so neither result is clean.

**About equal (and at the ceiling)**

* **DOCX, HTML and CSV** scored 100 on every metric for both tools. The corpus is clean and
  synthetic, so it cannot separate them on fidelity; real-world documents (merged cells,
  nested lists, tracked changes, messy HTML) will. Only speed differs here.
* **PDF headings and links.** Neither tool emits headings for the PDFs (heading recall 0 for both),
  and neither recovers link URLs from PDF annotations. Both lose bullet markers on some PDFs.

## Limitations

* **Synthetic corpus, small n.** 10 source documents, 27 scored files (DOCX 5, PDF 5, HTML 5,
  CSV 7, XLSX 3, PPTX 2). The PPTX and XLSX numbers rest on 2 and 3 files. We did not compute
  confidence intervals; treat differences of a few points as noise.
* **Generated, not authored in real applications.** DOCX comes from python-docx, PPTX from
  python-pptx, XLSX from openpyxl, PDF from Chrome. Files produced by Word, PowerPoint, Excel,
  LibreOffice or LaTeX may behave differently.
* **Chrome-specific PDF.** Ligatures and the way Chrome maps CJK glyphs to Unicode influence the
  PDF scores.
* **Not compared:** OCR and scanned documents, LLM image captioning, any plugin, Azure services,
  audio, images, archives, `.doc`, EPUB, URL input, very large files, memory use, concurrency.
* **Default options only.** Neither tool was tuned.
* **Single machine, single run, warm timings.** Numbers vary by a few percent from run to run
  (the committed run and an earlier run of the same code agreed within that range).
* **Heading level and structure score** are our own definitions. The structure score is a
  convenience for the headline table, not a standard metric.
* **Versions move.** MarkItDown 0.1.9 and to-markdown 3.5.0 only.

## Reproduce

```bash
cd benchmark/markitdown-comparison
./run.sh                    # uses the committed corpus; under a minute
REGENERATE=1 ./run.sh       # rebuild the corpus first (needs Google Chrome on macOS)
RUNS=10 ./run.sh            # more timed runs per file
```

`run.sh` builds `@cognipeer/to-markdown` from this checkout if `dist/` is missing
(`npm ci && npm run build`), creates `.venv` with the pinned `requirements.txt`
(`requirements.lock.txt` is the full `pip freeze`), runs the Node runner and then the Python runner
one after the other, and finally runs `score.py`. It needs Node 18 or later and Python 3.10 or
later. Set `CHROME_BIN` if Chrome is not at the default macOS path (only needed to regenerate PDFs).

### Files

| File | Purpose |
| --- | --- |
| `run.sh` | End-to-end reproduction |
| `ground_truth/` | Hand-authored ground-truth Markdown (`ground_truth_derived/` holds the one-table slices used for CSV) |
| `build_long_doc.py` | Provenance for `ground_truth/05_long_report.md` (seeded text builder); not needed to reproduce |
| `generate_corpus.py` | Deterministic corpus generator and manifest writer |
| `corpus/` | Generated inputs and `manifest.json` |
| `make_jobs.py`, `collect_env.py` | Build the file list and record machine/versions |
| `runner_to_markdown.mjs`, `runner_markitdown.py` | One long-lived runner per tool |
| `score.py` | Normalisation, metrics and report generation |
| `results/summary.json`, `results/summary.md`, `results/env.json`, `results/*/timings.json` | Committed results of the reported run. Raw converter outputs (`results/*/*.md`) are regenerated and git-ignored |
