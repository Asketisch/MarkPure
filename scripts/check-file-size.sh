#!/usr/bin/env bash
# File-size audit. The CLAUDE.md project rules say:
#   - Svelte files > 400 lines must be split
#   - Rust files > 500 lines must be split
# This script enforces those limits in CI. A non-zero exit
# code means a file is over budget and should be split (or the
# threshold adjusted, but *don't* do that — the budget is the
# whole point).

set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Thresholds (lines). Tune by editing the CLAUDE.md rule, not
# here — these are the same numbers.
SVELTE_MAX=400
RUST_MAX=500
TS_MAX=400

errors=0
checked=0

scan() {
  local pattern="$1"
  local max="$2"
  local label="$3"
  while IFS= read -r file; do
    [ -z "$file" ] && continue
    local lines
    lines=$(wc -l < "$file" | tr -d ' ')
    if [ "$lines" -gt "$max" ]; then
      echo "❌ $file: $lines lines (limit $max) [$label]"
      errors=$((errors + 1))
    else
      checked=$((checked + 1))
    fi
  done < <(find . -type f -name "$pattern" \
            -not -path './node_modules/*' \
            -not -path './target/*' \
            -not -path './dist/*' \
            -not -path './graphify-out/*' \
            -not -path './*.lock' \
            -not -path './scripts/*')
}

scan "*.svelte" "$SVELTE_MAX" "Svelte"
scan "*.ts"     "$TS_MAX"     "TypeScript"
scan "*.rs"     "$RUST_MAX"   "Rust"

if [ "$errors" -gt 0 ]; then
  echo
  echo "$errors file(s) over budget. Split them per CLAUDE.md rules."
  exit 1
fi

echo "✅ $checked file(s) within budget"
