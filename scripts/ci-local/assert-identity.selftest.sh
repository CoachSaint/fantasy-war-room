#!/usr/bin/env bash
# Adversarial selftest for assert-identity.sh — proves it actually refuses
# malformed identities instead of silently passing them through.
set -euo pipefail
cd "$(dirname "$0")"

fail=0
assert_refuses() {
  local desc="$1"; shift
  if ./assert-identity.sh "$@" >/dev/null 2>&1; then
    echo "FAIL: expected refusal for: $desc" >&2
    fail=1
  else
    echo "ok: refused — $desc"
  fi
}

REAL_SHA="$(git rev-parse HEAD)"
ZERO_SHA="0000000000000000000000000000000000000000"

assert_refuses "empty sha"            ""        "CoachSaint/fantasy-war-room" "."
assert_refuses "short sha"            "abc123"  "CoachSaint/fantasy-war-room" "."
assert_refuses "uppercase sha"        "$(printf 'A%.0s' $(seq 1 40))" "CoachSaint/fantasy-war-room" "."
assert_refuses "empty observed repo"  "$REAL_SHA" ""                        "."
assert_refuses "wrong observed repo"  "$REAL_SHA" "someone-else/not-this-repo" "."
assert_refuses "sha != workspace HEAD" "$ZERO_SHA" "CoachSaint/fantasy-war-room" "."

echo "==> confirming a VALID identity still passes (no false-positive refusal)"
./assert-identity.sh "$REAL_SHA" "CoachSaint/fantasy-war-room" "."

if [ "$fail" -ne 0 ]; then
  echo "SELFTEST FAILED" >&2
  exit 1
fi
echo "selftest: OK — every malformed identity refused, valid identity accepted"
