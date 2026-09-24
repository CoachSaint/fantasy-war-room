#!/usr/bin/env bash
# Full local CI-equivalent — same commands and gates as the `verify` job in
# .github/workflows/ci.yml: npm ci, vitest run (parsed for a real pass count,
# not just exit code — a summary that's missing or shows a skip is not a
# pass), npm run lint, npm run build.
#
# Vitest's real observed summary format (captured 2026-09-21 on Node 20.20.2,
# vitest v4.1.10, this repo's actual suite) looks like:
#
#   Test Files  10 passed (10)
#        Tests  63 passed (63)
#
# The parser below matches that exact "Tests  <N> passed (<TOTAL>)" shape,
# and also tolerates the "<N> passed | <M> failed | <K> skipped (<TOTAL>)"
# shape vitest prints when the suite is not all-green.
set -uo pipefail
cd "$(dirname "$0")/../.."
source scripts/ci-local/common.sh

require_node_major 20
assert_expected_sha

echo "==> cloudbuild-pr.yaml config selftest (regression guard against \$-substitution collisions)"
if ! bash scripts/ci-local/cloudbuild-config.selftest.sh; then
  echo "REFUSING: cloudbuild-config selftest failed" >&2
  exit 1
fi

set +e

echo "==> npm ci"
npm ci
if [ $? -ne 0 ]; then
  echo "REFUSING: npm ci failed" >&2
  exit 1
fi

echo "==> npm test (vitest run)"
TMP_OUT="$(mktemp)"
TMP_OUT_PLAIN="$(mktemp)"
trap 'rm -f "$TMP_OUT" "$TMP_OUT_PLAIN"' EXIT
npm test 2>&1 | tee "$TMP_OUT"
status=${PIPESTATUS[0]}

# Vitest may prefix its summary with ANSI color codes in Cloud Build logs.
# Strip those before parsing so a successful suite is not rejected as missing.
perl -pe 's/\e\[[0-9;]*m//g' "$TMP_OUT" > "$TMP_OUT_PLAIN"
TESTS_LINE="$(grep -E '^[[:space:]]*Tests[[:space:]]' "$TMP_OUT_PLAIN" | tail -1)"
TEST_FILES_LINE="$(grep -E '^[[:space:]]*Test Files[[:space:]]' "$TMP_OUT_PLAIN" | tail -1)"

if [ -z "$TESTS_LINE" ]; then
  echo "REFUSING: could not find a vitest 'Tests' summary line in the test output — a missing summary is not a pass" >&2
  exit 1
fi

echo "observed summary lines:"
echo "  ${TEST_FILES_LINE}"
echo "  ${TESTS_LINE}"

TOTAL="$(echo "$TESTS_LINE" | grep -oE '\([0-9]+\)' | tr -d '()' | tail -1)"
PASSED="$(echo "$TESTS_LINE" | grep -oE '[0-9]+ passed' | grep -oE '^[0-9]+')"
FAILED="$(echo "$TESTS_LINE" | grep -oE '[0-9]+ failed' | grep -oE '^[0-9]+')"
SKIPPED="$(echo "$TESTS_LINE" | grep -oE '[0-9]+ skipped' | grep -oE '^[0-9]+')"

TOTAL="${TOTAL:-0}"
PASSED="${PASSED:-0}"
FAILED="${FAILED:-0}"
SKIPPED="${SKIPPED:-0}"

echo "parsed vitest summary: total=${TOTAL} passed=${PASSED} failed=${FAILED} skipped=${SKIPPED}"

if [ "$status" -ne 0 ]; then
  echo "REFUSING: npm test exited non-zero (${status})" >&2
  exit 1
fi

if [ "$FAILED" -gt 0 ]; then
  echo "REFUSING: vitest reported ${FAILED} failed test(s)" >&2
  exit 1
fi

if [ "$SKIPPED" -gt 0 ]; then
  echo "REFUSING: vitest reported ${SKIPPED} skipped test(s) — a skip is not a pass" >&2
  exit 1
fi

# Real observed total on 2026-09-21 (Node 20.20.2, vitest v4.1.10): 63 tests
# across 10 test files, all passing. This floor catches a suite that silently
# shrank (e.g. a broken import causing files to be dropped), not just a
# suite that failed outright.
MIN_TESTS=63
if [ "$TOTAL" -lt "$MIN_TESTS" ]; then
  echo "REFUSING: vitest total (${TOTAL}) is below the expected floor of ${MIN_TESTS} — fewer tests ran than the last verified full suite" >&2
  exit 1
fi

echo "==> npm test: OK (${PASSED}/${TOTAL} passed, 0 failed, 0 skipped)"

echo "==> npm run lint"
npm run lint
if [ $? -ne 0 ]; then
  echo "REFUSING: lint failed" >&2
  exit 1
fi

echo "==> npm run build"
npm run build
if [ $? -ne 0 ]; then
  echo "REFUSING: build failed" >&2
  exit 1
fi

echo "full: OK — verified $(git rev-parse HEAD)"
