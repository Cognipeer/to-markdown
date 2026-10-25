# Benchmark: @cognipeer/to-markdown vs Microsoft MarkItDown

## What this is, and a disclosure

This folder compares [`@cognipeer/to-markdown`](https://github.com/Cognipeer/to-markdown) with
[Microsoft MarkItDown](https://github.com/microsoft/markitdown) on the document formats both
libraries support, using a small corpus with known ground truth. Everything needed to reproduce
the numbers is here: `./run.sh`.

**Disclosure: this benchmark was written by the to-markdown maintainers.** We tried to be fair
(identical inputs and scoring for both tools, default options, no per-tool tuning, element types a
format cannot carry are not scored, losses are reported), but the corpus design, the metrics and
the choice of formats are our choices. The corpus is synthetic and small. Read the results as
"what we measured on this corpus", not as a verdict. Issues and pull requests that make the
benchmark fairer are welcome, including ones that make MarkItDown look better.

## Versions and machine

| | |
| --- | --- |
| @cognipeer/to-markdown | 3.5.0, built from upstream `main` at `b3b1dad` (the library source last changed in `9782014`), default options, no `ocr` option, so OCR never runs |
| MarkItDown | 0.1.9 (latest on PyPI on 2026-10-25), `pip install 'markitdown[pdf,docx,pptx,xlsx,xls]'`, no LLM client, no plugins |
| MarkItDown dependencies | pdfminer.six 20260107, mammoth 1.13.0, python-pptx 1.0.2, openpyxl 3.1.5, pandas 3.1.0, markdownify 1.2.3, beautifulsoup4 4.15.0. Every transitive dependency is pinned in `requirements.lock.txt`, which `run.sh` applies as a pip constraints file, and `collect_env.py` refuses to run if the installed versions differ from it |
| Runtime | Node v24.10.0, Python 3.13.9 |
| Machine | Apple M4 Max (14 cores), 36 GB RAM, macOS (Darwin 27.2.0, arm64), single machine, one timing run of 20 timed conversions per file |
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
  in the page, so PDF fidelity is reported for every element. Link URLs live in PDF link annotations,
  not in text. Neither tool emits PDF headings or recovers PDF link URLs, so both score 0 on those
  per-metric columns. Those 0/0 elements are **left out of the PDF structure score** (which uses
  list recall and table F1 only), otherwise they would dominate it. They stay in the fidelity table.
* An element is scored for a file only if the ground truth of that file contains it.

The corpus is committed (under 1 MB) so the exact bytes are reproducible. DOCX, PPTX, XLSX, HTML
and CSV regenerate byte-identically; PDFs embed a creation date written by Chrome, so a
regenerated PDF differs in bytes (not in content).

The pre-existing `benchmark/test_files` (they come from the MarkItDown test suite and contain
scraped third-party pages, so we do not treat their licence as clear) are **not copied** and are
**not fidelity-scored**. They are run in place for speed and success/failure only, restricted to
the same core formats.

### Metrics (`score.py`, deterministic)

Both ground truth and tool output go through the same normalisation: strip HTML comments and tags
(so marker comments such as MarkItDown's `<!-- Slide number: 1 -->` or to-markdown's
`<!-- ppt/slides/slide1.xml -->` cost neither tool anything in the text metrics),
strip Markdown syntax (heading, list and quote markers, table pipes and separator rows, emphasis,
code ticks, backslash escapes such as `\_`, link and image wrappers keep only their visible text),
Unicode **NFKC**, lowercase, then tokenise (each CJK character is one token, decimals are compared
by value so `9.50` equals `9.5` and `1200.0` equals `1200`: float formatting of integers is
therefore not penalised). The normalisation, the tokeniser, decimal folding, heading level accuracy
and the structure score are our own definitions.

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
| Structure score | Unweighted mean of heading recall, heading level, list recall, table F1 and link recall, over the metrics that apply to a file, then averaged over files. For PDF only list recall and table F1 are used (see above). Used only for the headline table, so read the individual metrics too |

Per-format numbers are the macro average over files. A failed conversion counts as empty output,
so it scores 0. The scorer is self-checked by `python score.py --selftest` (217 checks over all 27
ground-truth files, no results needed): ground truth scored against itself gives 100 on every
metric, empty output gives 0, shuffled paragraphs lower only the order score, removing table pipes
zeroes only the table score, `NaN` in empty cells lowers the table score, and decimal folding and
NFKC behave as described.

### Timing

One long-lived process per tool (a Node process calling the public `convertToMarkdown(path)`, a
Python process calling `MarkItDown().convert(path).text_content`). Per file: 1 warm-up conversion
(its output is the one scored), then **20 timed conversions** with a monotonic clock around the whole
call including reading the file. We store every run to 3 decimals and report the median with the
quartiles (Q1-Q3), min and max per file. Tools run strictly one after the other. These are warm,
in-process times: interpreter start-up, imports and first-call costs are deliberately excluded, so
they say nothing about one-off CLI invocations.

**What the timing does and does not measure.** Times are the cost of each tool's default public API
call from its own runtime. MarkItDown's `convert()` call includes content-type detection (Magika) and
format dispatch on top of the format conversion. To separate those, `run.sh` also times MarkItDown's
format converter classes called directly on an open file with the extension given (secondary table
below, corpus files only). The public-API call is what users normally invoke, so it stays the headline;
the converter-only column shows how much of the gap is per-call overhead rather than conversion.

**Noise.** Timings on a laptop are noisy, and sub-millisecond runs are close to timer and GC noise.
The table in the Results section lists the run-to-run spread, `(max - min) / median` per file. The
median file's spread is about 20 to 50% for DOCX and PDF, and 80 to 200% for to-markdown on the
sub-10 ms formats; the worst single files reach 3x to 4x the median (up to 436%). Medians are much steadier than min or max
(the per-file table gives Q1-Q3). An earlier 5-run measurement of the same code gave MarkItDown on DOCX
at 93.6 ms (median of medians) against 75.6 ms in the 20-run run reported here, so a difference of
about 20% between two runs of the same code is normal. Treat speed ratios as order of magnitude,
and ignore differences under about 2x.

## Results

All numbers below are copied from `results/summary.md` (committed run, 2026-10-25, 20 timed runs
per file). Every cell is `to-markdown / MarkItDown`. Scores are percentages, higher is better. Times
are milliseconds, lower is better. Raw data is in `results/summary.json`, including every per-file
score and every timing run (`results/*/timings.json`).

Headline (text F1 and structure score averaged over files; see Metrics). The PDF structure score
uses only list recall and table F1 and rests on very few files (see the next section); do not read
it as a quality score:

| Format | Files | Text F1 | Structure score | Median ms/file |
| --- | --- | --- | --- | --- |
| DOCX | 5 | 100.0 / 100.0 | 100.0 / 100.0 | 18.1 / 75.6 |
| PDF | 5 | 98.8 / 100.0 | 83.0 / 80.0 | 7.85 / 94.1 |
| PPTX | 2 | 100.0 / 100.0 | 25.0 / 75.0 | 1.12 / 10.7 |
| XLSX | 3 | 100.0 / 97.8 | 100.0 / 96.7 | 1.24 / 5.97 |
| HTML | 5 | 100.0 / 100.0 | 100.0 / 100.0 | 0.81 / 3.29 |
| CSV | 7 | 100.0 / 100.0 | 100.0 / 100.0 | 0.027 / 1.48 |

### Fidelity by format

| Format | Text F1 | Reading order | Heading recall | Heading level | List recall | List markup | Table cell F1 | Link recall |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| DOCX | 100.0 / 100.0 | 100.0 / 100.0 | 100.0 / 100.0 | 100.0 / 100.0 | 100.0 / 100.0 | 100.0 / 100.0 | 100.0 / 100.0 | 100.0 / 100.0 |
| PDF | 98.8 / 100.0 | 98.8 / 97.9 | 0.0 / 0.0 | 0.0 / 0.0 | 96.4 / 100.0 | 36.6 / 43.3 | 66.7 / 50.0 | 0.0 / 0.0 |
| PPTX | 100.0 / 100.0 | 100.0 / 100.0 | 0.0 / 100.0 | n/a / n/a | 100.0 / 100.0 | n/a / n/a | 0.0 / 100.0 | 0.0 / 0.0 |
| XLSX | 100.0 / 97.8 | 100.0 / 97.8 | n/a / n/a | n/a / n/a | n/a / n/a | n/a / n/a | 100.0 / 96.7 | n/a / n/a |
| HTML | 100.0 / 100.0 | 100.0 / 100.0 | 100.0 / 100.0 | 100.0 / 100.0 | 100.0 / 100.0 | 100.0 / 100.0 | 100.0 / 100.0 | 100.0 / 100.0 |
| CSV | 100.0 / 100.0 | 100.0 / 100.0 | n/a / n/a | n/a / n/a | n/a / n/a | n/a / n/a | 100.0 / 100.0 | n/a / n/a |

PDF headings, heading levels and links are 0 for both tools: neither emits headings for the
Chrome-printed PDFs and neither recovers link URLs from annotations.

### Speed

Median of per-file medians, sum of per-file medians, and the run-to-run spread (see Timing):

| Format | Median of per-file medians (ms) | Sum of per-file medians (ms) | Run-to-run spread, median file (max-min)/median | Worst file | Failures |
| --- | --- | --- | --- | --- | --- |
| DOCX | 18.1 / 75.6 | 98.3 / 402.4 | 22% / 53% | 54% / 69% | 0 / 0 |
| PDF | 7.85 / 94.1 | 83.5 / 1024.9 | 38% / 22% | 108% / 58% | 0 / 0 |
| PPTX | 1.12 / 10.7 | 2.24 / 21.3 | 200% / 40% | 253% / 45% | 0 / 0 |
| XLSX | 1.24 / 5.97 | 4.02 / 19.9 | 152% / 40% | 235% / 317% | 0 / 0 |
| HTML | 0.81 / 3.29 | 9.53 / 21.5 | 98% / 23% | 436% / 291% | 0 / 0 |
| CSV | 0.027 / 1.48 | 0.21 / 10.3 | 82% / 25% | 192% / 34% | 0 / 0 |

Secondary: MarkItDown's converter classes called directly (no content-type detection or dispatch),
corpus files only, median of per-file medians in ms:

| Format | MarkItDown public API, median of medians (ms) | MarkItDown converter only (ms) | to-markdown (ms) |
| --- | --- | --- | --- |
| DOCX | 75.6 | 79.0 | 18.1 |
| PDF | 94.1 | 95.6 | 7.85 |
| PPTX | 10.7 | 8.11 | 1.12 |
| XLSX | 5.97 | 3.85 | 1.24 |
| HTML | 3.29 | 1.03 | 0.81 |
| CSV | 1.48 | 0.031 | 0.027 |

For DOCX, PDF and PPTX the converters themselves differ by a large factor (about 4x, 12x and 7x here).
For HTML (1.3x) and CSV (about a tie, tens of microseconds each) almost all of MarkItDown's public-API
time is per-call overhead, not conversion. For XLSX it is roughly a third.

On the existing `benchmark/test_files`, both tools converted every file without error (ms, median
[Q1-Q3]):

| File | to-markdown ms (median [Q1-Q3]) | MarkItDown ms (median [Q1-Q3]) | Status |
| --- | --- | --- | --- |
| test.docx | 10.6 [10.2-11.3] | 19.5 [18.5-20.6] | both ok |
| test.xlsx | 1.76 [1.63-1.98] | 8.55 [8.17-9.16] | both ok |
| test.xls | 0.17 [0.14-0.25] | 6.55 [6.39-6.78] | both ok |
| test.pptx | 2.66 [2.51-2.94] | 9.85 [9.76-10.5] | both ok |
| test.pdf | 10.4 [10.2-10.8] | 73.9 [73.4-79.6] | both ok |
| test_blog.html | 3.06 [2.94-3.50] | 8.46 [8.24-8.90] | both ok |
| test_wikipedia.html | 53.2 [52.0-53.8] | 124.1 [123.2-126.1] | both ok |
| test_serp.html | 26.3 [25.4-27.6] | 30.4 [29.7-31.6] | both ok |
| test_mskanji.csv | 0.032 [0.026-0.041] | 2.01 [1.79-2.37] | both ok |

### Failures

Neither tool raised an error on any of the 27 scored files or the 9 robustness files.

## Where each tool is stronger

Read these with the file counts in mind. Findings that rest on one file are listed separately, as
no meaningful difference.

**MarkItDown is stronger**

* **PPTX structure (n = 2 files, both agree).** MarkItDown writes slide titles as `#` headings and
  tables as Markdown tables (heading recall 100, table F1 100). to-markdown 3.5.0 writes one
  paragraph per slide, prefixed with an HTML comment marker such as `<!-- ppt/slides/slide1.xml -->`,
  with all paragraphs of the slide joined on one line: no headings, bullets or tables (heading recall
  0, table F1 0), although every word is present (text F1 100). Both tools emit marker comments,
  and scoring strips HTML comments for both, so neither text F1 is lowered by them. This is the
  largest gap in the benchmark and it favours MarkItDown.
* **PDF text F1, slightly (n = 5 files; 98.8 against 100.0).** MarkItDown is ahead on 4 of the 5 PDFs
  (to-markdown 97.5 to 99.4 on those, 100.0 on the fifth). The cause is ligatures: the font Chrome
  picked renders `fi`/`fl` as ligature glyphs, and to-markdown emits them as split words (`fl at`,
  `fi gures`). MarkItDown keeps the ligature code point, which our NFKC normalisation folds back.
  With plain NFC (sensitivity table in `results/summary.md`) the gap narrows to 98.4 against 99.0,
  because MarkItDown then pays for the ligature and CJK compatibility code points. Either way, a
  plain-string search on either tool's output would miss those words.

**to-markdown is stronger**

* **XLSX empty cells (n = 3 files, all three agree).** MarkItDown (through pandas) writes the
  literal `NaN` for every empty cell (6, 2 and 2 cells in the three workbooks); to-markdown keeps
  empty cells empty. Table F1 is 100.0 against 96.7, and this gap comes from the `NaN` cells only:
  with `NaN` removed from MarkItDown's output its table F1 is 100.0 on all three files. MarkItDown
  also writes integer columns that contain an empty cell as floats (`1200.0`, `40.0`). That is a
  real output quirk, but the scorer folds trailing decimal zeros, so it costs nothing in these
  numbers.
* **Speed, per format, directional.** In the warm, in-process measurement to-markdown was faster
  on every format, on the median of per-file medians: about 4x on DOCX (5 files), about 12x on PDF
  (5 files; 14x on the long report), about 10x on PPTX (2 files), about 5x on XLSX (3 files) and about 4x
  on HTML (5 files). On the existing `test_serp.html` the gap nearly vanishes (26.3 ms against
  30.4 ms).
  **How much of this is conversion and how much is per-call overhead:** MarkItDown's public call includes
  content-type detection and dispatch. Called through its converter classes directly the ratios
  become about 4x (DOCX), 12x (PDF), 7x (PPTX), 3x (XLSX) and 1.3x (HTML), and CSV is a tie
  (about 0.03 ms each). So the large multipliers on tiny files (HTML, CSV, `test.xls`, `test_mskanji.csv`) mostly
  measure per-call overhead rather than converter speed. For CSV the honest statement is tens of
  microseconds for to-markdown against about 1.5 ms for the MarkItDown public call, which matters only
  when converting very many small files. Timings are noisy (see Timing), so we do not quote a
  single headline multiplier.

**No meaningful difference on this corpus (each is driven by one file)**

* **PDF table F1, 66.7 against 50.0 (n = 1 file).** Only `04_multilingual.pdf` differs. Both tools
  score 100 on `02` and `05` and 0 on `03`. On `04`, MarkItDown scrambles the column order of the
  table (table F1 0), and to-markdown merges the surrounding Japanese and Chinese paragraphs into the
  table (66.7). Neither result is clean, so we do not count this as a win.
* **PDF list recall, 96.4 against 100.0 (n = 1 file).** Only `01_handbook_en.pdf` differs (81.8 against 100.0).
* **PDF list markup, 36.6 against 43.3 (n = 1 file).** Only `04_multilingual.pdf` differs (16.7
  against 50.0). On the other four PDFs both tools lose the bullet markers identically.
* **PDF reading order, 98.8 against 97.9.** Mixed per file: to-markdown is lower on `01`, `02` and
  `05` (where the split ligature words cost it) and higher on `03` and `04`.

**About equal (and at the ceiling)**

* **DOCX, HTML and CSV** scored 100 on every metric for both tools. The corpus is clean and
  synthetic, so it cannot separate them on fidelity; real-world documents (merged cells,
  nested lists, tracked changes, messy HTML) will. Only speed differs here.
* **PDF headings and links.** Neither tool emits headings for the PDFs (heading recall 0 for both),
  and neither recovers link URLs from PDF annotations.

## Limitations

* **Synthetic corpus, small n.** 10 source documents, 27 scored files (DOCX 5, PDF 5, HTML 5,
  CSV 7, XLSX 3, PPTX 2). The PPTX and XLSX numbers rest on 2 and 3 files, and several PDF
  differences rest on one file (see above). We did not compute confidence intervals; treat
  differences of a few points as noise.
* **Written by the to-markdown maintainers.** Corpus design, metrics, normalisation and the choice
  of formats are ours, even though both tools get identical inputs and scoring.
* **Generated, not authored in real applications.** DOCX comes from python-docx, PPTX from
  python-pptx, XLSX from openpyxl, PDF from Chrome. Files produced by Word, PowerPoint, Excel,
  LibreOffice or LaTeX may behave differently.
* **Chrome-specific PDF.** Ligatures and the way Chrome maps CJK glyphs to Unicode influence the
  PDF scores.
* **Not compared:** OCR and scanned documents, LLM image captioning, any plugin, Azure services,
  audio, images, archives, `.doc`, EPUB, URL input, very large files, memory use, concurrency,
  and cold-start or CLI cost.
* **Default options only.** Neither tool was tuned.
* **Single machine, one timing run, warm timings, public API.** 20 timed runs per file, on one laptop.
  Run-to-run spread is large for fast files (see Timing), and MarkItDown's public-API time includes
  content-type detection. The converter-only column is a secondary, corpus-only measurement.
* **Own definitions.** Heading level accuracy, list markup, the structure score, decimal folding and
  the NFKC normalisation are our definitions. The structure score is a convenience for the headline
  table, not a standard metric, and the PDF structure score uses only list recall and table F1.
* **Versions move.** MarkItDown 0.1.9 and to-markdown 3.5.0 only.

## Reproduce

```bash
cd benchmark/markitdown-comparison
./run.sh                    # uses the committed corpus; about 80 s on the machine above (20 runs per file)
REGENERATE=1 ./run.sh       # rebuild the corpus first (needs Google Chrome on macOS)
RUNS=50 ./run.sh            # more timed runs per file
.venv/bin/python score.py --selftest   # check the scorer itself (needs only the corpus and ground truth)
```

`run.sh` builds `@cognipeer/to-markdown` from this checkout if `dist/` is missing
(`npm ci && npm run build`), creates `.venv` and installs `requirements.txt` with
`requirements.lock.txt` as a pip constraints file (`-c`), so every transitive dependency resolves to the
benchmarked version. `collect_env.py` compares the installed packages with the lock file, records any
drift in `results/env.json` and stops the run if there is any (set `ALLOW_LOCK_DRIFT=1` to override).
It then runs the Node runner, the Python runner (public API) and the Python runner again in converter-only
mode, one after the other, and finally `score.py`. It needs Node 18 or later and Python 3.10 or later.
Set `CHROME_BIN` if Chrome is not at the default macOS path (needed to regenerate PDFs, and used to
record the Chrome version in `env.json`). The wall time of `./run.sh` at 20 runs was 81 s on the machine above.

### Files

| File | Purpose |
| --- | --- |
| `run.sh` | End-to-end reproduction |
| `ground_truth/` | Hand-authored ground-truth Markdown (`ground_truth_derived/` holds the one-table slices used for CSV) |
| `build_long_doc.py` | Provenance for `ground_truth/05_long_report.md` (seeded text builder); not needed to reproduce |
| `generate_corpus.py` | Deterministic corpus generator and manifest writer |
| `corpus/` | Generated inputs and `manifest.json` |
| `requirements.txt`, `requirements.lock.txt` | Top-level pins, and the full `pip freeze` used as a constraints file |
| `make_jobs.py`, `collect_env.py` | Build the file list; record machine and versions and check the lock file |
| `runner_to_markdown.mjs`, `runner_markitdown.py` | One long-lived runner per tool (`runner_markitdown.py ... direct` is the converter-only mode) |
| `score.py` | Normalisation, metrics and report generation; `--selftest` checks the scorer (identity, empty, shuffled order, no pipes, `NaN` cells, decimal folding) |
| `results/summary.json`, `results/summary.md`, `results/env.json`, `results/*/timings.json` | Committed results of the reported run (`results/markitdown-direct/` is the converter-only timing). Raw converter outputs (`results/*/*.md`) are regenerated and git-ignored |
