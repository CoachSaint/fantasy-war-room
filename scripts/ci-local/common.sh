#!/usr/bin/env bash
# Shared helper for fantasy-war-room local CI scripts.
set -euo pipefail

require_node_major() {
  local required="$1"
  local actual
  actual="$(node -e 'console.log(process.versions.node.split(".")[0])')"
  if [ "$actual" != "$required" ]; then
    echo "REFUSING: .github/workflows/ci.yml pins Node ${required}, this shell has Node ${actual} ($(node -v)). A pass on the wrong Node is not proof of anything — install/activate Node ${required} first." >&2
    exit 1
  fi
}

assert_expected_sha() {
  local actual expected
  actual="$(git rev-parse HEAD)"
  expected="${CI_LOCAL_EXPECTED_SHA:-$actual}"
  if [ "$actual" != "$expected" ]; then
    echo "REFUSING: checked-out HEAD (${actual}) does not match CI_LOCAL_EXPECTED_SHA (${expected})" >&2
    exit 1
  fi
}
