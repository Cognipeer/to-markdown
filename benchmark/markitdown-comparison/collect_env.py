#!/usr/bin/env python3
"""Write results/env.json: machine and tool versions for the report."""
import json
import os
import platform
import re
import subprocess
import sys
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
CHROME = os.environ.get("CHROME_BIN", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")


def sh(*cmd):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=20).stdout.strip()
    except Exception:
        return None


def norm(name):
    return re.sub(r"[-_.]+", "-", name).lower()


def lock_drift():
    """Compare every package in requirements.lock.txt with what is installed."""
    drift = []
    for line in (HERE / "requirements.lock.txt").read_text().splitlines():
        m = re.fullmatch(r"([A-Za-z0-9_.\-]+)==(\S+)", line.strip())
        if not m:
            continue
        name, want = m.groups()
        try:
            have = version(name)
        except PackageNotFoundError:
            have = None
        if have != want:
            drift.append({"package": norm(name), "locked": want, "installed": have})
    return drift


pkg = json.loads((ROOT / "package.json").read_text())
env = {
    "cpu": sh("sysctl", "-n", "machdep.cpu.brand_string") or platform.processor(),
    "cores": sh("sysctl", "-n", "hw.ncpu"),
    "ram_gb": round(int(sh("sysctl", "-n", "hw.memsize") or 0) / 2**30, 1),
    "os": f"{platform.system()} {platform.release()} ({platform.machine()})",
    "node": sh("node", "-v"),
    "python": platform.python_version(),
    "to_markdown": pkg["version"],
    # last commit that touched the library itself; stays stable when benchmark files are committed
    "to_markdown_commit": sh("git", "-C", str(ROOT), "log", "-1", "--format=%h", "--", "src", "package.json", "package-lock.json"),
    "checkout_head": sh("git", "-C", str(ROOT), "rev-parse", "--short", "HEAD"),
    "markitdown": version("markitdown"),
    "markitdown_deps": {p: version(p) for p in ["pdfminer.six", "mammoth", "python-pptx", "openpyxl", "pandas", "markdownify", "beautifulsoup4"]},
    "lock_file_drift": lock_drift(),
    "chrome_used_for_pdf_generation": sh(CHROME, "--version"),
}
(HERE / "results").mkdir(exist_ok=True)
(HERE / "results" / "env.json").write_text(json.dumps(env, indent=2) + "\n")
print(json.dumps(env, indent=2))
if env["lock_file_drift"]:
    print("WARNING: installed packages differ from requirements.lock.txt, so the numbers may not "
          "reproduce: " + json.dumps(env["lock_file_drift"]), file=sys.stderr)
    if os.environ.get("ALLOW_LOCK_DRIFT") != "1":
        sys.exit("Refusing to continue. Reinstall with `pip install -r requirements.txt -c requirements.lock.txt` "
                 "or set ALLOW_LOCK_DRIFT=1 to benchmark anyway (drift is recorded in results/env.json).")
