# OCR benchmark

Converts every file in a directory with three modes and compares them:

| mode        | options                                   | meaning                                                      |
| ----------- | ----------------------------------------- | ------------------------------------------------------------ |
| `off`       | none                                      | text layers only, no OCR                                     |
| `legacy`    | `ocr: { pdfMode: 'auto' }`                | 3.5.0 behaviour: OCR the whole PDF only when it has no text  |
| `auto-page` | `ocr: { pdfMode: 'auto-page' }`           | OCR only the pages whose text layer is missing or unusable   |

Tesseract runs offline from a local language-data directory.

## Prepare language data

```bash
npm pack @tesseract.js-data/tur@1.0.0 @tesseract.js-data/eng@1.0.0
# extract both tarballs, then copy package/4.0.0_best_int/*.traineddata.gz into one directory
```

## Run

```bash
npx tsx benchmark/ocr/run.ts \
  --dir src/__tests__/fixtures/ocr \
  --out /tmp/ocr-bench \
  --tessdata /path/to/tessdata \
  --lang tr+en \
  --concurrency 2
```

Options: `--dir` (input files, searched recursively), `--out` (report directory), `--tessdata`
(directory with `<lang>.traineddata.gz`), `--lang` (default `eng`), `--concurrency` (default 1).

## Output

- `<out>/report.json` - per file and mode: `totalMs`, `chars`, `stats` (`ocrCalls`, `ocrPages`, `ocrMs`,
  `renderMs`), per-page reports (`text | ocr | empty | error | skipped`), embedded image reports and warnings.
  A failed conversion is recorded with its error message.
- `<out>/markdown/<file>.<mode>.md` - the Markdown of each run, for side-by-side review.

This script is not part of `npm test` and is not published.
