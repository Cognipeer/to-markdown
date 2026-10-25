#!/usr/bin/env python3
"""Long-lived MarkItDown runner (library API, no LLM client, no plugins).

Per file: 1 warm-up conversion (its output is saved) then N timed runs.
Usage: python runner_markitdown.py results/jobs.json results/markitdown [runs] [direct]

Default mode times the public call `MarkItDown().convert(path)`, which includes
content-type detection (Magika) and format dispatch. With the extra argument
`direct` it instead calls the format's converter class on an open file, with
the extension given, which skips detection and dispatch (scored-corpus jobs
only). That is a secondary, converter-only measurement.
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


def stats(times):
    """Timing summary in ms, 3 decimals. IQR uses linear interpolation (type 7)."""
    q = statistics.quantiles(times, n=4, method="inclusive") if len(times) > 1 else [times[0]] * 3
    r3 = lambda x: round(x, 3)
    return dict(runs_ms=[r3(t) for t in times], median_ms=r3(statistics.median(times)),
                min_ms=r3(min(times)), max_ms=r3(max(times)), q1_ms=r3(q[0]), q3_ms=r3(q[2]),
                p95_ms=r3(p95(times)))


def direct_converter(path):
    """Return (converter, StreamInfo) for a corpus file, bypassing detection and dispatch."""
    from markitdown import StreamInfo
    from markitdown.converters import (CsvConverter, DocxConverter, HtmlConverter, PdfConverter,
                                       PptxConverter, XlsConverter, XlsxConverter)
    ext = Path(path).suffix.lower()
    conv = {".docx": DocxConverter, ".pdf": PdfConverter, ".pptx": PptxConverter, ".xlsx": XlsxConverter,
            ".xls": XlsConverter, ".html": HtmlConverter, ".csv": CsvConverter}[ext]()
    return conv, StreamInfo(extension=ext, charset="utf-8" if ext in (".html", ".csv") else None)


def convert_direct(path):
    conv, info = direct_converter(path)
    with open(path, "rb") as f:
        return conv.convert(f, info).markdown


def main():
    logging.getLogger('pdfminer').setLevel(logging.ERROR)  # silence font warnings only
    jobs = json.loads(Path(sys.argv[1]).read_text())
    out = Path(sys.argv[2])
    runs = int(sys.argv[3]) if len(sys.argv) > 3 else 20
    direct = len(sys.argv) > 4 and sys.argv[4] == "direct"
    out.mkdir(parents=True, exist_ok=True)
    md = MarkItDown()  # enable_plugins defaults to False; no llm_client
    res = {}
    convert = convert_direct if direct else (lambda p: md.convert(p).text_content)
    for job in jobs:
        if direct and job.get("set") != "corpus":
            continue
        rec = {"ok": False}
        try:
            text = convert(job["path"])
            (out / f"{job['id']}.md").write_text(text, encoding="utf-8")
            rec["out_chars"] = len(text)
            times = []
            for _ in range(runs):
                t0 = time.perf_counter()
                convert(job["path"])
                times.append((time.perf_counter() - t0) * 1000)
            rec.update(ok=True, **stats(times))
        except Exception as e:  # record, never abort the run
            rec["error"] = f"{type(e).__name__}: {str(e)[:400]}"
            (out / f"{job['id']}.md").write_text("", encoding="utf-8")
        res[job["id"]] = rec
        print(f"{job['id']:45s} {'ok ' if rec['ok'] else 'ERR'} {rec.get('median_ms', '-')}", flush=True)
    meta = {"tool": "markitdown", "mode": "converter-only" if direct else "public-api",
            "version": version("markitdown"), "python": platform.python_version(),
            "runs": runs, "warmups": 1}
    (out / "timings.json").write_text(json.dumps({"meta": meta, "files": res}, indent=2) + "\n")


if __name__ == "__main__":
    main()
