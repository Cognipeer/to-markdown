#!/usr/bin/env bash
# Reproduce the whole benchmark. Steps run strictly one after another (the
# comparison is timing-sensitive and the heavy steps are memory hungry).
#
#   ./run.sh                 use the committed corpus
#   REGENERATE=1 ./run.sh    rebuild the corpus first (needs Google Chrome for PDFs)
#   RUNS=5 ./run.sh          timed runs per file (default 5, after 1 warm-up)
set -euo pipefail
cd "$(dirname "$0")"
HERE="$PWD"
ROOT="$(cd ../.. && pwd)"
RUNS="${RUNS:-5}"

# 1. Node side: install and build @cognipeer/to-markdown from this checkout
if [ ! -f "$ROOT/dist/index.js" ]; then
  (cd "$ROOT" && npm ci --no-audit --no-fund && npm run build)
fi

# 2. Python side: isolated virtualenv with pinned dependencies
if [ ! -x .venv/bin/python ]; then python3 -m venv .venv; fi
.venv/bin/pip install -q -r requirements.txt

# 3. Corpus (committed; regenerate only on request)
if [ "${REGENERATE:-0}" = "1" ]; then .venv/bin/python generate_corpus.py; fi

# 4. Jobs + environment
.venv/bin/python make_jobs.py
.venv/bin/python collect_env.py > /dev/null

# 5. One long-lived process per tool, run sequentially
rm -rf results/to-markdown results/markitdown
node --max-old-space-size=4096 runner_to_markdown.mjs results/jobs.json results/to-markdown "$RUNS"
.venv/bin/python runner_markitdown.py results/jobs.json results/markitdown "$RUNS"

# 6. Score and write results/summary.json + results/summary.md
.venv/bin/python score.py > /dev/null
echo "Done. See results/summary.md"
