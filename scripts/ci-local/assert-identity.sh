#!/usr/bin/env bash
# assert-identity.sh — fail-closed identity gate for cloudbuild-pr.yaml.
#
# Refuses the whole build before any install/test cost is spent if the
# commit SHA or source repository Cloud Build observed doesn't match what
# this lane is allowed to build. CANONICAL_REPO is hardcoded here (not a
# caller-supplied substitution) so a misconfigured or tampered trigger can't
# redefine "expected" to match whatever it was actually fed.
#
# Usage: assert-identity.sh <commit-sha> <observed-repo-full-name> [workdir]
set -euo pipefail

CANONICAL_REPO='CoachSaint/fantasy-war-room'

COMMIT_SHA="${1:-}"
OBSERVED_REPO="${2:-}"
WORKDIR="${3:-.}"

if ! [[ "$COMMIT_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "REFUSING: no valid 40-char lowercase commit SHA supplied ('${COMMIT_SHA}')" >&2
  exit 1
fi

if [ -z "$OBSERVED_REPO" ]; then
  echo "REFUSING: no observed source repository supplied (Cloud Build's \$REPO_FULL_NAME was empty)" >&2
  exit 1
fi

if [ "$OBSERVED_REPO" != "$CANONICAL_REPO" ]; then
  echo "REFUSING: source repository mismatch — this lane only builds '${CANONICAL_REPO}', observed '${OBSERVED_REPO}'" >&2
  exit 1
fi

ACTUAL_HEAD="$(git -C "$WORKDIR" rev-parse HEAD)"
if [ "$ACTUAL_HEAD" != "$COMMIT_SHA" ]; then
  echo "REFUSING: workspace HEAD (${ACTUAL_HEAD}) does not match Cloud Build COMMIT_SHA (${COMMIT_SHA})" >&2
  exit 1
fi

echo "identity OK: ${CANONICAL_REPO}@${COMMIT_SHA}"
