#!/usr/bin/env python3
"""Long-lived MarkItDown runner (library API, no LLM client, no plugins).

Per file: 1 warm-up conversion (its output is saved) then N timed runs.
Usage: python runner_markitdown.py results/jobs.json results/markitdown [runs]
"""
import json
import logging
import math
import platform
import statistics
import sys
import time
import traceback
from importlib.metadata import version
from pathlib import Path

from markitdown import MarkItDown


def p95(xs):  # nearest-rank
    s = sorted(xs)
    return s[min(len(s) - 1, math.ceil(0.95 * len(s)) - 1)]


def main():
    logging.getLogger('pdfminer').setLevel(logging.ERROR)  # silence font warnings only
    jobs = json.loads(Path(sys.argv[1]).read_text())
    out = Path(sys.argv[2])
    runs = int(sys.argv[3]) if len(sys.argv) > 3 else 5
    out.mkdir(parents=True, exist_ok=True)
    md = MarkItDown()  # enable_plugins defaults to False; no llm_client
    res = {}
    for job in jobs:
        rec = {"ok": False}
        try:
            text = md.convert(job["path"]).text_content
            (out / f"{job['id']}.md").write_text(text, encoding="utf-8")
            rec["out_chars"] = len(text)
            times = []
            for _ in range(runs):
                t0 = time.perf_counter()
                md.convert(job["path"]).text_content
                times.append((time.perf_counter() - t0) * 1000)
            rec.update(ok=True, runs_ms=[round(t, 2) for t in times],
                       median_ms=round(statistics.median(times), 2), p95_ms=round(p95(times), 2))
        except Exception as e:  # record, never abort the run
            rec["error"] = f"{type(e).__name__}: {str(e)[:400]}"
            (out / f"{job['id']}.md").write_text("", encoding="utf-8")
        res[job["id"]] = rec
        print(f"{job['id']:45s} {'ok ' if rec['ok'] else 'ERR'} {rec.get('median_ms', '-')}", flush=True)
    meta = {"tool": "markitdown", "version": version("markitdown"), "python": platform.python_version(),
            "runs": runs, "warmups": 1}
    (out / "timings.json").write_text(json.dumps({"meta": meta, "files": res}, indent=2) + "\n")


if __name__ == "__main__":
    main()
