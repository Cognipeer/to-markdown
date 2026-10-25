#!/usr/bin/env python3
"""Write results/jobs.json: the list of files every runner converts.

'corpus' jobs are scored for fidelity. 'robustness' jobs are the pre-existing
benchmark/test_files (speed and success/failure only, no fidelity score).
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROBUST_DIR = HERE.parent / "test_files"
# only formats that BOTH tools support, and only the core office/web/csv ones
ROBUST = ["test.docx", "test.xlsx", "test.xls", "test.pptx", "test.pdf",
          "test_blog.html", "test_wikipedia.html", "test_serp.html", "test_mskanji.csv"]

jobs = []
for m in json.loads((HERE / "corpus" / "manifest.json").read_text(encoding="utf-8"))["files"]:
    jobs.append({"id": m["file"], "path": str(HERE / "corpus" / m["file"]), "set": "corpus"})
for f in ROBUST:
    p = ROBUST_DIR / f
    if p.exists():
        jobs.append({"id": "robust__" + f, "path": str(p), "set": "robustness"})
(HERE / "results").mkdir(exist_ok=True)
(HERE / "results" / "jobs.json").write_text(json.dumps(jobs, indent=2) + "\n", encoding="utf-8")
print(f"{len(jobs)} jobs")
