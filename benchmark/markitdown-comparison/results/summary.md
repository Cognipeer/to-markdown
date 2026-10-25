# Benchmark results: @cognipeer/to-markdown vs Microsoft MarkItDown

to-markdown 3.5.0 (commit b3b1dad) vs MarkItDown 0.1.9. Apple M4 Max, 36.0 GB RAM, Darwin 27.2.0 (arm64), Node v24.10.0, Python 3.13.9. Every cell reads `to-markdown / MarkItDown`. Scores are percentages (higher is better); times are milliseconds (lower is better). The benchmark was written by the to-markdown maintainers.

## Headline

| Format | Files | Text F1 | Structure score | Median ms/file |
| --- | --- | --- | --- | --- |
| DOCX | 5 | 100.0 / 100.0 | 100.0 / 100.0 | 20.8 / 93.6 |
| PDF | 5 | 98.8 / 100.0 | 30.8 / 29.0 | 8.98 / 94.8 |
| PPTX | 2 | 100.0 / 100.0 | 25.0 / 75.0 | 1.40 / 9.61 |
| XLSX | 3 | 100.0 / 97.8 | 100.0 / 96.7 | 1.57 / 5.57 |
| HTML | 5 | 100.0 / 100.0 | 100.0 / 100.0 | 1.12 / 3.22 |
| CSV | 7 | 100.0 / 100.0 | 100.0 / 100.0 | 0.04 / 1.66 |

Structure score is the unweighted mean of the structural metrics that apply to a file (heading recall, heading level accuracy, list item recall, table cell F1, link URL recall), averaged over files.

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

| Format | Median of per-file medians (ms) | Sum of per-file medians (ms) | Failures |
| --- | --- | --- | --- |
| DOCX | 20.8 / 93.6 | 108.3 / 439.1 | 0 / 0 |
| PDF | 8.98 / 94.8 | 90.5 / 1005.4 | 0 / 0 |
| PPTX | 1.40 / 9.61 | 2.80 / 19.2 | 0 / 0 |
| XLSX | 1.57 / 5.57 | 4.88 / 18.5 | 0 / 0 |
| HTML | 1.12 / 3.22 | 11.4 / 21.8 | 0 / 0 |
| CSV | 0.04 / 1.66 | 0.32 / 12.3 | 0 / 0 |

## Per file

| File | Tool | Text F1 | Order | Headings | Levels | Lists | Tables | Links | Median ms | p95 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 08_workbook_inventory_t1.csv | to-markdown | 100.0 | 100.0 | n/a | n/a | n/a | 100.0 | n/a | 0.08 | 0.25 |
| 08_workbook_inventory_t1.csv | MarkItDown | 100.0 | 100.0 | n/a | n/a | n/a | 100.0 | n/a | 1.87 | 2.69 |
| 08_workbook_inventory_t2.csv | to-markdown | 100.0 | 100.0 | n/a | n/a | n/a | 100.0 | n/a | 0.06 | 0.09 |
| 08_workbook_inventory_t2.csv | MarkItDown | 100.0 | 100.0 | n/a | n/a | n/a | 100.0 | n/a | 1.53 | 2.54 |
| 08_workbook_inventory_t3.csv | to-markdown | 100.0 | 100.0 | n/a | n/a | n/a | 100.0 | n/a | 0.04 | 0.05 |
| 08_workbook_inventory_t3.csv | MarkItDown | 100.0 | 100.0 | n/a | n/a | n/a | 100.0 | n/a | 1.83 | 3.63 |
| 09_workbook_turkce_t1.csv | to-markdown | 100.0 | 100.0 | n/a | n/a | n/a | 100.0 | n/a | 0.04 | 0.05 |
| 09_workbook_turkce_t1.csv | MarkItDown | 100.0 | 100.0 | n/a | n/a | n/a | 100.0 | n/a | 2.36 | 2.49 |
| 09_workbook_turkce_t2.csv | to-markdown | 100.0 | 100.0 | n/a | n/a | n/a | 100.0 | n/a | 0.03 | 0.03 |
| 09_workbook_turkce_t2.csv | MarkItDown | 100.0 | 100.0 | n/a | n/a | n/a | 100.0 | n/a | 1.66 | 1.72 |
| 10_workbook_multilingual_t1.csv | to-markdown | 100.0 | 100.0 | n/a | n/a | n/a | 100.0 | n/a | 0.03 | 0.03 |
| 10_workbook_multilingual_t1.csv | MarkItDown | 100.0 | 100.0 | n/a | n/a | n/a | 100.0 | n/a | 1.53 | 1.64 |
| 10_workbook_multilingual_t2.csv | to-markdown | 100.0 | 100.0 | n/a | n/a | n/a | 100.0 | n/a | 0.04 | 0.04 |
| 10_workbook_multilingual_t2.csv | MarkItDown | 100.0 | 100.0 | n/a | n/a | n/a | 100.0 | n/a | 1.48 | 1.52 |
| 01_handbook_en.docx | to-markdown | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | n/a | 100.0 | 21.4 | 23.7 |
| 01_handbook_en.docx | MarkItDown | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | n/a | 100.0 | 63.6 | 99.4 |
| 02_sales_report.docx | to-markdown | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 20.8 | 23.4 |
| 02_sales_report.docx | MarkItDown | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 93.6 | 108.4 |
| 03_turkce_rapor.docx | to-markdown | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 19.5 | 19.7 |
| 03_turkce_rapor.docx | MarkItDown | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 95.0 | 99.7 |
| 04_multilingual.docx | to-markdown | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 17.9 | 18.3 |
| 04_multilingual.docx | MarkItDown | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 62.4 | 98.8 |
| 05_long_report.docx | to-markdown | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 28.8 | 33.8 |
| 05_long_report.docx | MarkItDown | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 124.5 | 131.2 |
| 01_handbook_en.html | to-markdown | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | n/a | 100.0 | 1.12 | 1.20 |
| 01_handbook_en.html | MarkItDown | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | n/a | 100.0 | 2.76 | 3.77 |
| 02_sales_report.html | to-markdown | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 1.56 | 1.63 |
| 02_sales_report.html | MarkItDown | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 3.22 | 3.62 |
| 03_turkce_rapor.html | to-markdown | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 1.05 | 1.22 |
| 03_turkce_rapor.html | MarkItDown | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 3.38 | 3.59 |
| 04_multilingual.html | to-markdown | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 0.98 | 11.0 |
| 04_multilingual.html | MarkItDown | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 2.73 | 2.87 |
| 05_long_report.html | to-markdown | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 6.74 | 7.24 |
| 05_long_report.html | MarkItDown | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 9.73 | 10.6 |
| 01_handbook_en.pdf | to-markdown | 97.5 | 97.5 | 0.0 | 0.0 | 81.8 | n/a | 0.0 | 8.98 | 10.7 |
| 01_handbook_en.pdf | MarkItDown | 100.0 | 100.0 | 0.0 | 0.0 | 100.0 | n/a | 0.0 | 94.8 | 96.3 |
| 02_sales_report.pdf | to-markdown | 98.6 | 98.6 | 0.0 | 0.0 | 100.0 | 100.0 | 0.0 | 5.16 | 5.44 |
| 02_sales_report.pdf | MarkItDown | 100.0 | 100.0 | 0.0 | 0.0 | 100.0 | 100.0 | 0.0 | 39.6 | 42.7 |
| 03_turkce_rapor.pdf | to-markdown | 100.0 | 100.0 | 0.0 | 0.0 | 100.0 | 0.0 | 0.0 | 8.94 | 9.09 |
| 03_turkce_rapor.pdf | MarkItDown | 100.0 | 94.8 | 0.0 | 0.0 | 100.0 | 0.0 | 0.0 | 73.4 | 87.2 |
| 04_multilingual.pdf | to-markdown | 98.5 | 98.5 | 0.0 | 0.0 | 100.0 | 66.7 | 0.0 | 15.5 | 18.3 |
| 04_multilingual.pdf | MarkItDown | 100.0 | 94.7 | 0.0 | 0.0 | 100.0 | 0.0 | 0.0 | 107.9 | 124.3 |
| 05_long_report.pdf | to-markdown | 99.4 | 99.4 | 0.0 | 0.0 | 100.0 | 100.0 | 0.0 | 51.9 | 53.5 |
| 05_long_report.pdf | MarkItDown | 100.0 | 100.0 | 0.0 | 0.0 | 100.0 | 100.0 | 0.0 | 689.6 | 699.4 |
| 06_deck_roadmap.pptx | to-markdown | 100.0 | 100.0 | 0.0 | n/a | 100.0 | 0.0 | 0.0 | 1.41 | 1.57 |
| 06_deck_roadmap.pptx | MarkItDown | 100.0 | 100.0 | 100.0 | n/a | 100.0 | 100.0 | 0.0 | 9.45 | 9.89 |
| 07_deck_turkce.pptx | to-markdown | 100.0 | 100.0 | 0.0 | n/a | 100.0 | 0.0 | 0.0 | 1.39 | 1.66 |
| 07_deck_turkce.pptx | MarkItDown | 100.0 | 100.0 | 100.0 | n/a | 100.0 | 100.0 | 0.0 | 9.78 | 10.3 |
| 08_workbook_inventory.xlsx | to-markdown | 100.0 | 100.0 | n/a | n/a | n/a | 100.0 | n/a | 2.00 | 2.55 |
| 08_workbook_inventory.xlsx | MarkItDown | 97.0 | 97.0 | n/a | n/a | n/a | 95.8 | n/a | 7.53 | 7.94 |
| 09_workbook_turkce.xlsx | to-markdown | 100.0 | 100.0 | n/a | n/a | n/a | 100.0 | n/a | 1.57 | 2.38 |
| 09_workbook_turkce.xlsx | MarkItDown | 97.7 | 97.7 | n/a | n/a | n/a | 97.5 | n/a | 5.57 | 7.47 |
| 10_workbook_multilingual.xlsx | to-markdown | 100.0 | 100.0 | n/a | n/a | n/a | 100.0 | n/a | 1.31 | 1.55 |
| 10_workbook_multilingual.xlsx | MarkItDown | 98.5 | 98.5 | n/a | n/a | n/a | 96.8 | n/a | 5.39 | 5.54 |

## Robustness and speed on the existing benchmark/test_files (no fidelity score)

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

## Failures on the scored corpus

None.
