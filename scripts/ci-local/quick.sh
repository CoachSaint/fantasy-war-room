#!/usr/bin/env bash
# quick.sh — fast local sanity check, no install, no test run.
#
# fantasy-war-room is a Next.js/TypeScript app with a tsconfig.json, so a
# type-only compile (`tsc --noEmit`) is the fast, no-install signal here —
# far more useful than a bare syntax check for a TS codebase. If a
# tsconfig.json is ever removed, fall back to a plain Node syntax check over
# any non-TS JS sources under src/.
set -euo pipefail
cd "$(dirname "$0")/../.."

if [ -f tsconfig.json ]; then
  echo "==> npx tsc --noEmit (tsconfig.json found)"
  npx tsc --noEmit
  echo "quick: OK — TypeScript compiles cleanly (no emit)"
else
  echo "==> no tsconfig.json found, falling back to node --check over src/**/*.{js,mjs}"
  shopt -s globstar nullglob
  files=(src/**/*.js src/**/*.mjs)
  if [ "${#files[@]}" -eq 0 ]; then
    echo "quick: no JS files found under src/ to check"
    exit 0
  fi
  for f in "${files[@]}"; do
    echo "checking: $f"
    node --check "$f"
  done
  echo "quick: OK — all src/ JS files pass node --check"
fi
