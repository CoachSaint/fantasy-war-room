#!/usr/bin/env bash
# cloudbuild-config.selftest.sh — regression guard for cloudbuild-pr.yaml.
#
# Root rejected an earlier version of this file for two reasons: (1) it fed
# assert-identity.sh a custom "$_REPO_FULL_NAME" substitution that defaults
# to empty instead of the genuine Cloud Build built-in "$REPO_FULL_NAME",
# and (2) inline shell variables in step args ($total, $status,
# ${PIPESTATUS[0]}, ...) collide with Cloud Build's own $-substitution
# parser. This script fails loudly if either shape ever comes back.
set -euo pipefail
cd "$(dirname "$0")/../.."

CONFIG="cloudbuild-pr.yaml"
fail=0

if [ ! -f "$CONFIG" ]; then
  echo "FAIL: $CONFIG not found" >&2
  exit 1
fi

if grep -q '_REPO_FULL_NAME' "$CONFIG"; then
  echo "FAIL: $CONFIG references the custom, empty-by-default \$_REPO_FULL_NAME substitution — use the built-in \$REPO_FULL_NAME instead" >&2
  fail=1
else
  echo "ok: no custom \$_REPO_FULL_NAME substitution present"
fi

ALLOWED='COMMIT_SHA REPO_FULL_NAME'
tokens="$(grep -v '^[[:space:]]*#' "$CONFIG" | grep -oE '\$\{?[A-Za-z_][A-Za-z0-9_]*(\[[^]]*\])?\}?' | sed -E 's/^\$\{?//; s/\}?$//' | sort -u)"

while IFS= read -r tok; do
  [ -z "$tok" ] && continue
  case " $ALLOWED " in
    *" $tok "*) ;;
    *)
      echo "FAIL: $CONFIG contains unexpected token '\$${tok}' — not an allowed built-in substitution (allowed: $ALLOWED)" >&2
      fail=1
      ;;
  esac
done <<< "$tokens"

if [ "$fail" -eq 0 ]; then
  echo "ok: only allowed built-in substitutions (\$COMMIT_SHA, \$REPO_FULL_NAME) appear in $CONFIG — no inline shell vars for Cloud Build to misparse"
fi

if [ "$fail" -ne 0 ]; then
  echo "CLOUDBUILD CONFIG SELFTEST FAILED" >&2
  exit 1
fi
echo "cloudbuild-config selftest: OK"
