#!/usr/bin/env bash
# Local backfill: scripts/classify-local.sh <project>
# Env: JOBS (parallel batches, default 4), LIMIT (only the first N batches, for smoke tests).
set -euo pipefail
project=${1:?usage: classify-local.sh <project>}
cd "$(dirname "$0")/.."
dir=.routine/local/$project
rm -rf "$dir"; mkdir -p "$dir"

node src/collect.js
node src/apply-labels.js --write-batches "$project" "$dir/batches" > "$dir/list"
[ -n "${LIMIT:-}" ] && head -n "$LIMIT" "$dir/list" > "$dir/list.tmp" && mv "$dir/list.tmp" "$dir/list"
mkdir -p "$dir/answers"

one() { # one <batch file>: ask the model, then apply this batch's answers
  local out="$2/answers/$(basename "$1")"
  { cat src/model/prompt.md; echo; cat "$1"; } | claude -p --model sonnet > "$out" &&
    node src/apply-labels.js "$out"
}
export -f one

fail=0
xargs -a "$dir/list" -P "${JOBS:-4}" -I{} bash -c 'one "$1" "$2"' _ {} "$dir" || fail=1
[ "$fail" = 0 ] || { echo "some batches failed (see above); re-run to re-ask what is still pending" >&2; exit 1; }
