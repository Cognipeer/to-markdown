#!/usr/bin/env python3
"""Write results/env.json: machine and tool versions for the report."""
import json
import platform
import subprocess
import sys
from importlib.metadata import version
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


def sh(*cmd):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=20).stdout.strip()
    except Exception:
        return None


pkg = json.loads((ROOT / "package.json").read_text())
env = {
    "cpu": sh("sysctl", "-n", "machdep.cpu.brand_string") or platform.processor(),
    "cores": sh("sysctl", "-n", "hw.ncpu"),
    "ram_gb": round(int(sh("sysctl", "-n", "hw.memsize") or 0) / 2**30, 1),
    "os": f"{platform.system()} {platform.release()} ({platform.machine()})",
    "node": sh("node", "-v"),
    "python": platform.python_version(),
    "to_markdown": pkg["version"],
    "to_markdown_commit": sh("git", "-C", str(ROOT), "rev-parse", "--short", "HEAD"),
    "markitdown": version("markitdown"),
    "markitdown_deps": {p: version(p) for p in ["pdfminer.six", "mammoth", "python-pptx", "openpyxl", "pandas", "markdownify", "beautifulsoup4"]},
    "chrome_used_for_pdf_generation": sh(CHROME, "--version"),
}
(HERE / "results").mkdir(exist_ok=True)
(HERE / "results" / "env.json").write_text(json.dumps(env, indent=2) + "\n")
print(json.dumps(env, indent=2))
