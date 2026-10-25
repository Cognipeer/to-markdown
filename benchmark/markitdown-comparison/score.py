#!/usr/bin/env python3
"""Deterministic fidelity + speed scoring. See README.md ("Metrics") for the
full definitions. Reads results/<tool>/*.md and results/<tool>/timings.json,
writes results/summary.json and results/summary.md.

Normalisation (applied identically to ground truth and tool output):
  strip HTML comments/tags, Markdown syntax (heading/list/quote markers, table
  pipes and separator rows, emphasis, code ticks, backslash escapes, link and
  image wrappers keep their visible text only), Unicode NFKC, lowercase, drop
  U+0307 (Turkish dotted I artefact), then tokenise: each CJK character is its
  own token, other words are runs of letters/digits (internal . , ' kept for
  numbers and contractions); decimals are compared by value (9.50 == 9.5, so a
  float rendering such as 1200.0 for 1200 is NOT penalised).

HTML comments and tags are stripped from BOTH the ground truth and every tool's
output before scoring, so marker comments such as `<!-- Slide number: 1 -->`
(MarkItDown) or `<!-- ppt/slides/slide1.xml -->` (to-markdown) cost neither tool
anything in the text metrics.

`python score.py --selftest` checks the scorer itself (no results needed).
"""
import difflib
import json
import random
import re
import statistics
import sys
import unicodedata
from collections import Counter
from pathlib import Path

from generate_corpus import parse_md

HERE = Path(__file__).resolve().parent
RES = HERE / "results"
TOOLS = [("to-markdown", "to-markdown"), ("markitdown", "MarkItDown")]
METRICS = ["text_f1", "order", "heading_recall", "heading_level", "list_recall",
           "list_markup", "table_f1", "link_recall"]
STRUCT = ["heading_recall", "heading_level", "list_recall", "table_f1", "link_recall"]
# PDF structure is only visual and link URLs live in annotations. Neither tool recovers PDF headings
# or links (0 for both), so those 0/0 elements would dominate the PDF structure score. They stay in the
# per-metric fidelity table, but the structure score for PDF uses only list recall and table F1.
STRUCT_BY_FORMAT = {"pdf": ["list_recall", "table_f1"]}
TIMING_KEYS = ("median_ms", "min_ms", "max_ms", "q1_ms", "q3_ms", "p95_ms")

CJK = "\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff"
TOKEN = re.compile(rf"[{CJK}]|\d+(?:[.,]\d+)+|[^\W_]+(?:['\u2019][^\W_]+)*")
LIST_LINE = re.compile(r"^\s*(?:[-*+\u2022\u25cf\u25aa\u25e6]|\d+[.)])\s+(.*)$")
HEADING_LINE = re.compile(r"^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$")
SEP_CELL = re.compile(r"^:?-+:?$")


def strip_md(s):
    s = re.sub(r"<!--.*?-->", " ", s, flags=re.S)
    s = re.sub(r"<br\s*/?>", " ", s, flags=re.I)
    s = re.sub(r"<[^>]+>", " ", s)
    s = re.sub(r"!\[([^\]]*)\]\([^)]*\)", r"\1", s)
    s = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", s)
    s = re.sub(r"\\([\\`*_{}\[\]()#+\-.!|<>~])", r"\1", s)
    out = []
    for ln in s.splitlines():
        if re.fullmatch(r"\s*\|?[\s:\-|]*-[\s:\-|]*\|?\s*", ln) and ("|" in ln or re.fullmatch(r"\s*-{3,}\s*", ln)):
            continue  # table separator rows and horizontal rules
        ln = re.sub(r"^\s{0,3}#{1,6}\s+", "", ln)
        ln = re.sub(r"^\s*>+\s?", "", ln)
        ln = re.sub(r"^\s*(?:[-*+\u2022]|\d+[.)])\s+", "", ln)
        out.append(ln.replace("|", " "))
    s = "\n".join(out)
    s = re.sub(r"[*`~]+", "", s)
    s = re.sub(r"(?<!\w)_+|_+(?!\w)", "", s)
    return s


def numtok(t):
    if re.fullmatch(r"\d+\.\d+", t):
        t = t.rstrip("0").rstrip(".")
    return t


def tokens(s, form="NFKC"):
    s = unicodedata.normalize(form, strip_md(s)).lower().replace("\u0307", "")
    return [numtok(t) for t in TOKEN.findall(s)]


def phrase(s):
    return " ".join(tokens(s))


def f1(gt, out):
    """F1 of two multisets (Counters)."""
    if not gt and not out:
        return 1.0
    common = sum((gt & out).values())
    if not common:
        return 0.0
    p, r = common / sum(out.values()), common / sum(gt.values())
    return 2 * p * r / (p + r)


def table_cells(md):
    cells = Counter()
    for ln in md.splitlines():
        ln = ln.strip()
        if not ln.startswith("|"):
            continue
        parts = [c.strip() for c in re.split(r"(?<!\\)\|", ln.strip("|"))]
        if all(SEP_CELL.match(c) or c == "" for c in parts) and any(SEP_CELL.match(c) for c in parts):
            continue
        for c in parts:
            p = phrase(c)
            if p:
                cells[p] += 1
    return cells


def gt_elements(blocks):
    heads, items, urls = [], [], []
    for b in blocks:
        if b[0] == "h":
            heads.append((b[1], phrase(b[2])))
        elif b[0] in ("ul", "ol"):
            items += [phrase(i) for i in b[1]]
        for txt in ([b[2]] if b[0] == "h" else [b[1]] if b[0] == "p" else b[1] if b[0] in ("ul", "ol") else []):
            urls += re.findall(r"\]\(([^)]+)\)", txt)
    return heads, items, urls


def score_file(entry, out_md):
    gt_md = (HERE / entry["gt"]).read_text(encoding="utf-8")
    gt_blocks = parse_md(gt_md)
    heads, items, urls = gt_elements(gt_blocks)
    carries = set(entry["carries"])
    gt_tok, out_tok = tokens(gt_md), tokens(out_md)
    r = {}
    r["text_f1"] = f1(Counter(gt_tok), Counter(out_tok))
    # sensitivity check: plain NFC instead of NFKC (ligature / compatibility glyphs are NOT folded)
    r["text_f1_nfc"] = f1(Counter(tokens(gt_md, "NFC")), Counter(tokens(out_md, "NFC")))
    sm = difflib.SequenceMatcher(None, gt_tok, out_tok, autojunk=False)
    r["order"] = sm.ratio()
    if "headings" in carries and heads:
        outh = [(len(m.group(1)), phrase(m.group(2))) for m in map(HEADING_LINE.match, out_md.splitlines()) if m]
        used, hit, lvl = set(), 0, 0
        for level, text in heads:
            for i, (ol, ot) in enumerate(outh):
                if i not in used and ot == text:
                    used.add(i)
                    hit += 1
                    lvl += ol == level
                    break
        r["heading_recall"] = hit / len(heads)
        if "heading_levels" in carries:
            r["heading_level"] = lvl / len(heads)
    if "lists" in carries and items:
        flat = f" {phrase(out_md)} "
        r["list_recall"] = sum(f" {it} " in flat for it in items) / len(items)
        if entry["format"] in ("docx", "html", "pdf"):
            marked = [phrase(m.group(1)) for m in map(LIST_LINE.match, out_md.splitlines()) if m]
            r["list_markup"] = sum(any(f" {it} " in f" {ml} " for ml in marked) for it in items) / len(items)
    gt_cells = table_cells(gt_md)
    if "tables" in carries and gt_cells:
        r["table_f1"] = f1(gt_cells, table_cells(out_md))
    if "links" in carries and urls:
        r["link_recall"] = sum(u.rstrip("/") in out_md for u in urls) / len(urls)
    return r


def mean(xs):
    return sum(xs) / len(xs) if xs else None


def main():
    manifest = json.loads((HERE / "corpus" / "manifest.json").read_text(encoding="utf-8"))["files"]
    env = json.loads((RES / "env.json").read_text()) if (RES / "env.json").exists() else {}
    timings = {t: json.loads((RES / t / "timings.json").read_text()) for t, _ in TOOLS}
    direct_path = RES / "markitdown-direct" / "timings.json"
    direct = json.loads(direct_path.read_text()) if direct_path.exists() else None
    per_file = []
    for entry in manifest:
        for t, _ in TOOLS:
            path = RES / t / f"{entry['file']}.md"
            out = path.read_text(encoding="utf-8") if path.exists() else ""
            tm = timings[t]["files"].get(entry["file"], {})
            row = {"file": entry["file"], "format": entry["format"], "tool": t, "ok": tm.get("ok", False),
                   "error": tm.get("error"), **{k: tm.get(k) for k in TIMING_KEYS}, "out_chars": len(out)}
            row.update({k: round(v, 4) for k, v in score_file(entry, out).items()})
            per_file.append(row)

    fmts = sorted({m["format"] for m in manifest}, key=lambda f: ["docx", "pdf", "pptx", "xlsx", "html", "csv"].index(f))
    per_format = {}
    for f in fmts:
        per_format[f] = {}
        for t, _ in TOOLS:
            rows = [r for r in per_file if r["format"] == f and r["tool"] == t]
            agg = {"n_files": len(rows), "failures": sum(not r["ok"] for r in rows)}
            for m in METRICS + ["text_f1_nfc"]:
                vals = [r[m] for r in rows if m in r]
                agg[m] = round(mean(vals), 4) if vals else None
            # structure score: per-file mean of applicable structural metrics, then mean over files
            keys = STRUCT_BY_FORMAT.get(f, STRUCT)
            per = [mean([r[m] for m in keys if m in r]) for r in rows if any(m in r for m in keys)]
            agg["structure"] = round(mean(per), 4) if per else None
            ok = [r for r in rows if r["ok"]]
            ms = [r["median_ms"] for r in ok]
            agg["median_ms"] = round(statistics.median(ms), 3) if ms else None
            agg["total_median_ms"] = round(sum(ms), 2) if ms else None
            # run-to-run spread: (slowest run - fastest run) / median, per file
            spread = [(r["max_ms"] - r["min_ms"]) / r["median_ms"] for r in ok if r["median_ms"]]
            agg["spread_median"] = round(statistics.median(spread), 3) if spread else None
            agg["spread_max"] = round(max(spread), 3) if spread else None
            if direct and t == "markitdown":
                dm = [direct["files"][r["file"]]["median_ms"] for r in ok
                      if direct["files"].get(r["file"], {}).get("ok")]
                agg["direct_median_ms"] = round(statistics.median(dm), 3) if dm else None
                agg["direct_total_median_ms"] = round(sum(dm), 2) if dm else None
            per_format[f][t] = agg

    robust = []
    for jid in timings["to-markdown"]["files"]:
        if jid.startswith("robust__"):
            row = {"file": jid[len("robust__"):]}
            for t, _ in TOOLS:
                tm = timings[t]["files"].get(jid, {})
                row[t] = {k: tm.get(k) for k in ("ok", *TIMING_KEYS, "out_chars", "error")}
            robust.append(row)

    summary = {"env": env, "tool_meta": {t: timings[t]["meta"] for t, _ in TOOLS},
               "per_format": per_format, "per_file": per_file, "robustness": robust}
    if direct:
        summary["markitdown_converter_only"] = {
            "meta": direct["meta"],
            "per_file": {k: {m: v.get(m) for m in ("ok", *TIMING_KEYS)} for k, v in direct["files"].items()}}
    (RES / "summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (RES / "summary.md").write_text(render_md(summary, fmts), encoding="utf-8")
    print((RES / "summary.md").read_text(encoding="utf-8"))


def pct(x):
    return "n/a" if x is None else f"{x * 100:.1f}"


def pair(pf, f, key, fmt=pct):
    a, b = pf[f]["to-markdown"][key], pf[f]["markitdown"][key]
    return f"{fmt(a)} / {fmt(b)}"


def ms(x):
    if x is None:
        return "n/a"
    return f"{x:.3f}" if x < 0.1 else f"{x:.2f}" if x < 10 else f"{x:.1f}"


def render_md(s, fmts):
    pf, env = s["per_format"], s["env"]
    L = []
    L += ["# Benchmark results: @cognipeer/to-markdown vs Microsoft MarkItDown", "",
          f"to-markdown {env.get('to_markdown')} (commit {env.get('to_markdown_commit')}) vs MarkItDown {env.get('markitdown')}. "
          f"{env.get('cpu')}, {env.get('ram_gb')} GB RAM, {env.get('os')}, Node {env.get('node')}, Python {env.get('python')}. "
          "Every cell reads `to-markdown / MarkItDown`. Scores are percentages (higher is better); times are milliseconds (lower is better). "
          "The benchmark was written by the to-markdown maintainers.", "",
          "## Headline", "",
          "| Format | Files | Text F1 | Structure score | Median ms/file |", "| --- | --- | --- | --- | --- |"]
    for f in fmts:
        L.append(f"| {f.upper()} | {pf[f]['to-markdown']['n_files']} | {pair(pf, f, 'text_f1')} | {pair(pf, f, 'structure')} | {pair(pf, f, 'median_ms', ms)} |")
    L += ["", "Structure score is the unweighted mean of the structural metrics that apply to a file (heading recall, heading level accuracy, list item recall, table cell F1, link URL recall), averaged over files. "
          "For PDF it uses only list recall and table cell F1: neither tool recovers PDF headings or link URLs (0 for both), and those elements would otherwise dominate the number. "
          "They remain in the fidelity table below. Median ms is the median over files of each file's median time.", "",
          "## Fidelity by format", "",
          "| Format | Text F1 | Reading order | Heading recall | Heading level | List recall | List markup | Table cell F1 | Link recall |",
          "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"]
    for f in fmts:
        L.append(f"| {f.upper()} | " + " | ".join(pair(pf, f, k) for k in METRICS) + " |")
    L += ["", "n/a means the format cannot carry that element or the ground truth has none.", "",
          "## Sensitivity: Unicode normalisation", "",
          "Text F1 is computed after NFKC normalisation, which folds PDF ligature glyphs (U+FB01 and similar) back to plain letters. "
          "With plain NFC instead, text F1 becomes:", "",
          "| Format | Text F1 with NFKC (headline) | Text F1 with NFC |", "| --- | --- | --- |"]
    for f in fmts:
        L.append(f"| {f.upper()} | {pair(pf, f, 'text_f1')} | {pair(pf, f, 'text_f1_nfc')} |")
    L += ["",
          "## Speed by format", "",
          "Times are the cost of each tool's default public API call from its own runtime. MarkItDown's call includes content-type "
          "detection (Magika) and format dispatch; that cost is not separated in this table (see the converter-only table below).", "",
          "| Format | Median of per-file medians (ms) | Sum of per-file medians (ms) | Run-to-run spread, median file (max-min)/median | Worst file | Failures |",
          "| --- | --- | --- | --- | --- | --- |"]
    for f in fmts:
        a, b = pf[f]["to-markdown"], pf[f]["markitdown"]
        L.append(f"| {f.upper()} | {pair(pf, f, 'median_ms', ms)} | {pair(pf, f, 'total_median_ms', ms)} | "
                 f"{a['spread_median'] * 100:.0f}% / {b['spread_median'] * 100:.0f}% | {a['spread_max'] * 100:.0f}% / {b['spread_max'] * 100:.0f}% | "
                 f"{a['failures']} / {b['failures']} |")
    if "markitdown_converter_only" in s:
        L += ["", "### MarkItDown converter-only (secondary)", "",
              "MarkItDown's format converter class called directly on an open file with the extension given: no content-type "
              "detection, no dispatch. Corpus files only. The public-API column is the headline measurement above.", "",
              "| Format | MarkItDown public API, median of medians (ms) | MarkItDown converter only (ms) | to-markdown (ms) |", "| --- | --- | --- | --- |"]
        for f in fmts:
            b = pf[f]["markitdown"]
            L.append(f"| {f.upper()} | {ms(b['median_ms'])} | {ms(b['direct_median_ms'])} | {ms(pf[f]['to-markdown']['median_ms'])} |")
    L += ["", "## Per file", "",
          "Times are median [Q1-Q3] over the timed runs, in ms.", "",
          "| File | Tool | Text F1 | Order | Headings | Levels | Lists | Tables | Links | Median [Q1-Q3] ms | Min-max ms |",
          "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"]
    for r in s["per_file"]:
        L.append(f"| {r['file']} | {dict(TOOLS)[r['tool']]} | " + " | ".join(
            pct(r.get(k)) for k in ["text_f1", "order", "heading_recall", "heading_level", "list_recall", "table_f1", "link_recall"])
            + f" | {ms(r['median_ms'])} [{ms(r['q1_ms'])}-{ms(r['q3_ms'])}] | {ms(r['min_ms'])}-{ms(r['max_ms'])} |")
    L += ["", "## Robustness and speed on the existing benchmark/test_files (no fidelity score)", "",
          "| File | to-markdown ms (median [Q1-Q3]) | MarkItDown ms (median [Q1-Q3]) | Status |", "| --- | --- | --- | --- |"]
    for r in s["robustness"]:
        a, b = r["to-markdown"], r["markitdown"]
        st = ", ".join(f"{dict(TOOLS)[t]} failed: {r[t]['error']}" for t in ("to-markdown", "markitdown") if not r[t]["ok"]) or "both ok"
        L.append(f"| {r['file']} | {ms(a['median_ms'])} [{ms(a['q1_ms'])}-{ms(a['q3_ms'])}] | {ms(b['median_ms'])} [{ms(b['q1_ms'])}-{ms(b['q3_ms'])}] | {st} |")
    fails = [r for r in s["per_file"] if not r["ok"]]
    L += ["", "## Failures on the scored corpus", ""]
    L += [f"- {r['file']} ({dict(TOOLS)[r['tool']]}): {r['error']}" for r in fails] or ["None."]
    return "\n".join(L) + "\n"


def selftest():
    """Sanity-check the scorer against synthetic outputs derived from the ground truth.
    Needs corpus/manifest.json and ground_truth/, not results/. Exits non-zero on failure."""
    manifest = json.loads((HERE / "corpus" / "manifest.json").read_text(encoding="utf-8"))["files"]
    rng = random.Random(7)
    failures, checks = [], 0

    def check(cond, msg):
        nonlocal checks
        checks += 1
        if not cond:
            failures.append(msg)

    def pipes_removed(md):
        return "\n".join(ln.replace("|", " ") if ln.strip().startswith("|") else ln for ln in md.splitlines())

    def nan_cells(md):  # what a pandas-based converter writes for an empty cell
        return re.sub(r"\|\s*(?=\|)", "| NaN ", md)

    # unit checks on normalisation
    check(tokens("9.50 and 1200.0") == tokens("9.5 and 1200"), "decimal folding: 9.50 == 9.5 and 1200.0 == 1200")
    check(tokens("\ufb01gures") == tokens("figures"), "NFKC folds the fi ligature")
    check(tokens("**Bold** [link](http://x.y) <!-- c --> <b>t</b>") == ["bold", "link", "t"], "markup and comments are stripped")
    check(tokens("日本語") == ["日", "本", "語"], "each CJK character is one token")

    for e in manifest:
        gt = (HERE / e["gt"]).read_text(encoding="utf-8")
        name, carried = e["file"], set(e["carries"])
        ident = score_file(e, gt)
        applicable = [k for k in ident if k != "text_f1_nfc"]
        check(all(ident[k] == 1.0 for k in applicable), f"{name}: ground truth against itself must score 100 on every metric, got {ident}")
        empty = score_file(e, "")
        check(empty["text_f1"] == 0 and empty["order"] == 0, f"{name}: empty output must score 0 text F1 and order")
        check(all(empty[k] == 0 for k in applicable if k not in ("text_f1", "order")), f"{name}: empty output must score 0 on every structural metric")

        blocks = [b for b in re.split(r"\n\s*\n", gt) if b.strip()]
        shuffled = blocks[:]
        for _ in range(10):
            rng.shuffle(shuffled)
            if shuffled != blocks:
                break
        if shuffled != blocks and len(blocks) > 1:
            sh = score_file(e, "\n\n".join(shuffled))
            check(sh["text_f1"] == 1.0, f"{name}: shuffling blocks must not change text F1")
            check(sh["order"] < 1.0, f"{name}: shuffling blocks must lower the order score")
            other = [k for k in applicable if k not in ("order",)]
            check(all(sh[k] == 1.0 for k in other), f"{name}: shuffling blocks must only lower the order score, got {sh}")

        if "tables" in carried and "table_f1" in ident:
            np_ = score_file(e, pipes_removed(gt))
            check(np_["table_f1"] == 0.0, f"{name}: removing table pipes must zero the table score")
            check(all(np_[k] == ident[k] for k in applicable if k != "table_f1"), f"{name}: removing table pipes must only lower the table score, got {np_}")
            if re.search(r"\|\s*\|", gt):
                nn = score_file(e, nan_cells(gt))
                check(nn["table_f1"] < 1.0, f"{name}: NaN in empty cells must lower the table score")

    print(f"selftest: {checks - len(failures)}/{checks} checks passed over {len(manifest)} ground-truth files")
    for f in failures:
        print("FAIL:", f)
    return 1 if failures else 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    main()
