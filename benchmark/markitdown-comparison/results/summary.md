# Benchmark results: @cognipeer/to-markdown vs Microsoft MarkItDown

to-markdown 3.5.0 (commit 9782014) vs MarkItDown 0.1.9. Apple M4 Max, 36.0 GB RAM, Darwin 27.2.0 (arm64), Node v24.10.0, Python 3.13.9. Every cell reads `to-markdown / MarkItDown`. Scores are percentages (higher is better); times are milliseconds (lower is better). The benchmark was written by the to-markdown maintainers.

## Headline

| Format | Files | Text F1 | Structure score | Median ms/file |
| --- | --- | --- | --- | --- |
| DOCX | 5 | 100.0 / 100.0 | 100.0 / 100.0 | 18.1 / 75.6 |
| PDF | 5 | 98.8 / 100.0 | 83.0 / 80.0 | 7.85 / 94.1 |
| PPTX | 2 | 100.0 / 100.0 | 25.0 / 75.0 | 1.12 / 10.7 |
| XLSX | 3 | 100.0 / 97.8 | 100.0 / 96.7 | 1.24 / 5.97 |
| HTML | 5 | 100.0 / 100.0 | 100.0 / 100.0 | 0.81 / 3.29 |
| CSV | 7 | 100.0 / 100.0 | 100.0 / 100.0 | 0.027 / 1.48 |

Structure score is the unweighted mean of the structural metrics that apply to a file (heading recall, heading level accuracy, list item recall, table cell F1, link URL recall), averaged over files. For PDF it uses only list recall and table cell F1: neither tool recovers PDF headings or link URLs (0 for both), and those elements would otherwise dominate the number. They remain in the fidelity table below. Median ms is the median over files of each file's median time.

## Fidelity by format

| Format | Text F1 | Reading order | Heading recall | Heading level | List recall | List markup | Table cell F1 | Link recall |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| DOCX | 100.0 / 100.0 | 100.0 / 100.0 | 100.0 / 100.0 | 100.0 / 100.0 | 100.0 / 100.0 | 100.0 / 100.0 | 100.0 / 100.0 | 100.0 / 100.0 |
| PDF | 98.8 / 100.0 | 98.8 / 97.9 | 0.0 / 0.0 | 0.0 / 0.0 | 96.4 / 100.0 | 36.6 / 43.3 | 66.7 / 50.0 | 0.0 / 0.0 |
| PPTX | 100.0 / 100.0 | 100.0 / 100.0 | 0.0 / 100.0 | n/a / n/a | 100.0 / 100.0 | n/a / n/a | 0.0 / 100.0 | 0.0 / 0.0 |
| XLSX | 100.0 / 97.8 | 100.0 / 97.8 | n/a / n/a | n/a / n/a | n/a / n/a | n/a / n/a | 100.0 / 96.7 | n/a / n/a |
| HTML | 100.0 / 100.0 | 100.0 / 100.0 | 100.0 / 100.0 | 100.0 / 100.0 | 100.0 / 100.0 | 100.0 / 100.0 | 100.0 / 100.0 | 100.0 / 100.0 |
| CSV | 100.0 / 100.0 | 100.0 / 100.0 | n/a / n/a | n/a / n/a | n/a / n/a | n/a / n/a | 100.0 / 100.0 | n/a / n/a |

n/a means the format cannot carry that element or the ground truth has none.

## Sensitivity: Unicode normalisation

Text F1 is computed after NFKC normalisation, which folds PDF ligature glyphs (U+FB01 and similar) back to plain letters. With plain NFC instead, text F1 becomes:

| Format | Text F1 with NFKC (headline) | Text F1 with NFC |
| --- | --- | --- |
| DOCX | 100.0 / 100.0 | 100.0 / 100.0 |
| PDF | 98.8 / 100.0 | 98.4 / 99.0 |
| PPTX | 100.0 / 100.0 | 100.0 / 100.0 |
| XLSX | 100.0 / 97.8 | 100.0 / 97.8 |
| HTML | 100.0 / 100.0 | 100.0 / 100.0 |
| CSV | 100.0 / 100.0 | 100.0 / 100.0 |

## Speed by format

Times are the cost of each tool's default public API call from its own runtime. MarkItDown's call includes content-type detection (Magika) and format dispatch; that cost is not separated in this table (see the converter-only table below).

| Format | Median of per-file medians (ms) | Sum of per-file medians (ms) | Run-to-run spread, median file (max-min)/median | Worst file | Failures |
| --- | --- | --- | --- | --- | --- |
| DOCX | 18.1 / 75.6 | 98.3 / 402.4 | 22% / 53% | 54% / 69% | 0 / 0 |
| PDF | 7.85 / 94.1 | 83.5 / 1024.9 | 38% / 22% | 108% / 58% | 0 / 0 |
| PPTX | 1.12 / 10.7 | 2.24 / 21.3 | 200% / 40% | 253% / 45% | 0 / 0 |
| XLSX | 1.24 / 5.97 | 4.02 / 19.9 | 152% / 40% | 235% / 317% | 0 / 0 |
| HTML | 0.81 / 3.29 | 9.53 / 21.5 | 98% / 23% | 436% / 291% | 0 / 0 |
| CSV | 0.027 / 1.48 | 0.21 / 10.3 | 82% / 25% | 192% / 34% | 0 / 0 |

### MarkItDown converter-only (secondary)

MarkItDown's format converter class called directly on an open file with the extension given: no content-type detection, no dispatch. Corpus files only. The public-API column is the headline measurement above.

| Format | MarkItDown public API, median of medians (ms) | MarkItDown converter only (ms) | to-markdown (ms) |
| --- | --- | --- | --- |
| DOCX | 75.6 | 79.0 | 18.1 |
| PDF | 94.1 | 95.6 | 7.85 |
| PPTX | 10.7 | 8.11 | 1.12 |
| XLSX | 5.97 | 3.85 | 1.24 |
| HTML | 3.29 | 1.03 | 0.81 |
| CSV | 1.48 | 0.031 | 0.027 |

## Per file

Times are median [Q1-Q3] over the timed runs, in ms.

| File | Tool | Text F1 | Order | Headings | Levels | Lists | Tables | Links | Median [Q1-Q3] ms | Min-max ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 08_workbook_inventory_t1.csv | to-markdown | 100.0 | 100.0 | n/a | n/a | n/a | 100.0 | n/a | 0.047 [0.035-0.058] | 0.028-0.12 |
| 08_workbook_inventory_t1.csv | MarkItDown | 100.0 | 100.0 | n/a | n/a | n/a | 100.0 | n/a | 1.48 [1.47-1.53] | 1.43-1.81 |
| 08_workbook_inventory_t2.csv | to-markdown | 100.0 | 100.0 | n/a | n/a | n/a | 100.0 | n/a | 0.027 [0.025-0.028] | 0.024-0.046 |
| 08_workbook_inventory_t2.csv | MarkItDown | 100.0 | 100.0 | n/a | n/a | n/a | 100.0 | n/a | 1.46 [1.44-1.56] | 1.41-1.61 |
| 08_workbook_inventory_t3.csv | to-markdown | 100.0 | 100.0 | n/a | n/a | n/a | 100.0 | n/a | 0.027 [0.027-0.028] | 0.026-0.033 |
| 08_workbook_inventory_t3.csv | MarkItDown | 100.0 | 100.0 | n/a | n/a | n/a | 100.0 | n/a | 1.43 [1.41-1.49] | 1.39-1.75 |
| 09_workbook_turkce_t1.csv | to-markdown | 100.0 | 100.0 | n/a | n/a | n/a | 100.0 | n/a | 0.031 [0.028-0.035] | 0.027-0.065 |
| 09_workbook_turkce_t1.csv | MarkItDown | 100.0 | 100.0 | n/a | n/a | n/a | 100.0 | n/a | 1.50 [1.49-1.58] | 1.46-1.97 |
| 09_workbook_turkce_t2.csv | to-markdown | 100.0 | 100.0 | n/a | n/a | n/a | 100.0 | n/a | 0.028 [0.027-0.031] | 0.023-0.055 |
| 09_workbook_turkce_t2.csv | MarkItDown | 100.0 | 100.0 | n/a | n/a | n/a | 100.0 | n/a | 1.48 [1.46-1.49] | 1.44-1.55 |
| 10_workbook_multilingual_t1.csv | to-markdown | 100.0 | 100.0 | n/a | n/a | n/a | 100.0 | n/a | 0.024 [0.023-0.025] | 0.022-0.028 |
| 10_workbook_multilingual_t1.csv | MarkItDown | 100.0 | 100.0 | n/a | n/a | n/a | 100.0 | n/a | 1.48 [1.46-1.51] | 1.43-1.80 |
| 10_workbook_multilingual_t2.csv | to-markdown | 100.0 | 100.0 | n/a | n/a | n/a | 100.0 | n/a | 0.026 [0.025-0.027] | 0.022-0.031 |
| 10_workbook_multilingual_t2.csv | MarkItDown | 100.0 | 100.0 | n/a | n/a | n/a | 100.0 | n/a | 1.46 [1.45-1.48] | 1.43-1.64 |
| 01_handbook_en.docx | to-markdown | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | n/a | 100.0 | 18.1 [17.1-19.2] | 15.1-24.9 |
| 01_handbook_en.docx | MarkItDown | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | n/a | 100.0 | 59.6 [59.2-91.5] | 58.5-96.5 |
| 02_sales_report.docx | to-markdown | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 18.4 [17.8-19.3] | 16.8-22.1 |
| 02_sales_report.docx | MarkItDown | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 80.6 [64.1-98.5] | 63.3-103.7 |
| 03_turkce_rapor.docx | to-markdown | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 18.0 [16.5-18.4] | 15.6-19.4 |
| 03_turkce_rapor.docx | MarkItDown | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 62.5 [61.4-96.6] | 60.1-103.2 |
| 04_multilingual.docx | to-markdown | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 16.9 [16.2-17.5] | 15.4-18.8 |
| 04_multilingual.docx | MarkItDown | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 75.6 [59.7-94.9] | 58.9-99.0 |
| 05_long_report.docx | to-markdown | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 26.8 [26.2-28.1] | 25.4-28.5 |
| 05_long_report.docx | MarkItDown | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 124.0 [93.5-129.3] | 91.6-136.3 |
| 01_handbook_en.html | to-markdown | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | n/a | 100.0 | 0.79 [0.75-0.86] | 0.72-1.19 |
| 01_handbook_en.html | MarkItDown | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | n/a | 100.0 | 2.67 [2.56-2.80] | 2.51-3.11 |
| 02_sales_report.html | to-markdown | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 1.17 [1.12-1.32] | 1.08-2.23 |
| 02_sales_report.html | MarkItDown | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 3.29 [3.16-3.46] | 3.09-4.37 |
| 03_turkce_rapor.html | to-markdown | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 0.81 [0.76-0.83] | 0.73-4.24 |
| 03_turkce_rapor.html | MarkItDown | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 3.44 [3.21-3.59] | 3.12-3.81 |
| 04_multilingual.html | to-markdown | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 0.65 [0.63-0.69] | 0.60-1.92 |
| 04_multilingual.html | MarkItDown | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 2.71 [2.63-2.76] | 2.57-2.86 |
| 05_long_report.html | to-markdown | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 6.12 [5.93-6.68] | 5.65-11.3 |
| 05_long_report.html | MarkItDown | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 9.36 [9.18-9.56] | 8.79-36.0 |
| 01_handbook_en.pdf | to-markdown | 97.5 | 97.5 | 0.0 | 0.0 | 81.8 | n/a | 0.0 | 7.22 [6.88-8.42] | 6.36-10.4 |
| 01_handbook_en.pdf | MarkItDown | 100.0 | 100.0 | 0.0 | 0.0 | 100.0 | n/a | 0.0 | 94.1 [93.2-95.1] | 91.9-112.8 |
| 02_sales_report.pdf | to-markdown | 98.6 | 98.6 | 0.0 | 0.0 | 100.0 | 100.0 | 0.0 | 4.45 [4.22-4.69] | 3.94-8.73 |
| 02_sales_report.pdf | MarkItDown | 100.0 | 100.0 | 0.0 | 0.0 | 100.0 | 100.0 | 0.0 | 40.0 [39.4-42.2] | 38.4-61.7 |
| 03_turkce_rapor.pdf | to-markdown | 100.0 | 100.0 | 0.0 | 0.0 | 100.0 | 0.0 | 0.0 | 7.85 [7.45-8.22] | 7.21-9.11 |
| 03_turkce_rapor.pdf | MarkItDown | 100.0 | 94.8 | 0.0 | 0.0 | 100.0 | 0.0 | 0.0 | 75.9 [74.9-78.5] | 73.8-93.6 |
| 04_multilingual.pdf | to-markdown | 98.5 | 98.5 | 0.0 | 0.0 | 100.0 | 66.7 | 0.0 | 13.9 [13.5-15.1] | 12.5-17.7 |
| 04_multilingual.pdf | MarkItDown | 100.0 | 94.7 | 0.0 | 0.0 | 100.0 | 0.0 | 0.0 | 102.2 [100.9-103.3] | 99.4-119.2 |
| 05_long_report.pdf | to-markdown | 99.4 | 99.4 | 0.0 | 0.0 | 100.0 | 100.0 | 0.0 | 50.0 [49.3-51.1] | 47.9-57.6 |
| 05_long_report.pdf | MarkItDown | 100.0 | 100.0 | 0.0 | 0.0 | 100.0 | 100.0 | 0.0 | 712.7 [689.5-725.3] | 671.7-803.1 |
| 06_deck_roadmap.pptx | to-markdown | 100.0 | 100.0 | 0.0 | n/a | 100.0 | 0.0 | 0.0 | 1.15 [1.09-1.39] | 0.97-2.66 |
| 06_deck_roadmap.pptx | MarkItDown | 100.0 | 100.0 | 100.0 | n/a | 100.0 | 100.0 | 0.0 | 10.7 [10.2-11.3] | 9.35-13.1 |
| 07_deck_turkce.pptx | to-markdown | 100.0 | 100.0 | 0.0 | n/a | 100.0 | 0.0 | 0.0 | 1.09 [1.01-1.17] | 0.94-3.70 |
| 07_deck_turkce.pptx | MarkItDown | 100.0 | 100.0 | 100.0 | n/a | 100.0 | 100.0 | 0.0 | 10.6 [9.79-11.1] | 9.31-14.1 |
| 08_workbook_inventory.xlsx | to-markdown | 100.0 | 100.0 | n/a | n/a | n/a | 100.0 | n/a | 1.58 [1.40-2.00] | 1.26-3.68 |
| 08_workbook_inventory.xlsx | MarkItDown | 97.0 | 97.0 | n/a | n/a | n/a | 95.8 | n/a | 8.28 [7.76-9.19] | 7.04-10.2 |
| 09_workbook_turkce.xlsx | to-markdown | 100.0 | 100.0 | n/a | n/a | n/a | 100.0 | n/a | 1.24 [1.17-1.33] | 1.09-1.55 |
| 09_workbook_turkce.xlsx | MarkItDown | 97.7 | 97.7 | n/a | n/a | n/a | 97.5 | n/a | 5.97 [5.76-6.53] | 5.46-7.84 |
| 10_workbook_multilingual.xlsx | to-markdown | 100.0 | 100.0 | n/a | n/a | n/a | 100.0 | n/a | 1.20 [1.14-1.27] | 0.80-3.62 |
| 10_workbook_multilingual.xlsx | MarkItDown | 98.5 | 98.5 | n/a | n/a | n/a | 96.8 | n/a | 5.68 [5.43-6.16] | 5.05-23.0 |

## Robustness and speed on the existing benchmark/test_files (no fidelity score)

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

## Failures on the scored corpus

None.
