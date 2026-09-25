# CI-Local / Cloud Build PR-CI Runbook — fantasy-war-room

Powered by JTF Software Solutions

## What this is
Additive, non-Actions verification, added on `feat/no-github-actions-ci`.
`.github/workflows/ci.yml` is unchanged and stays authoritative — it already
runs only on `workflow_dispatch` (cost control, flipped 2026-09-20), so this
branch does not disable anything Actions is currently doing. This adds a
local script pack (`scripts/ci-local/`) and an active Cloud Build config
(`cloudbuild-pr.yaml`) that run the same verification sequence as the dormant
Actions `verify` job:
`npm ci` → `npm test` (vitest) → `npm run lint` (eslint) → `npm run build`
(`next build`). The active Cloud Build lane now uses Node 22, matching the
current Supabase SDK runtime requirement and the Vercel build runtime.

## Local commands
- `scripts/ci-local/quick.sh` — fast, no-install sanity check. This repo has
  a `tsconfig.json`, so `quick.sh` runs `npx tsc --noEmit`. (If the
  `tsconfig.json` is ever removed, it falls back to `node --check` over any
  non-TS JS files under `src/`.)
- `scripts/ci-local/full.sh` — exact equivalent of the CI `verify` job:
  Node-22 assertion (`require_node_major 22`), checked-out-SHA assertion
  (`CI_LOCAL_EXPECTED_SHA` if set, else current HEAD), a clean-checkout
  assertion, then `npm ci`, `npm
  test` (vitest run, parsed for a real pass/fail/skip count — not just exit
  code, so a missing summary or a silent skip cannot pass), `npm run lint`,
  `npm run build`. Refuses on any failure.
- `scripts/ci-local/assert-identity.selftest.sh` — adversarial proof that
  `assert-identity.sh` refuses empty/short/uppercase/mismatched SHAs and
  wrong repo names, and still accepts a valid identity.
- `scripts/ci-local/cloudbuild-config.selftest.sh` — regression guard that
  fails loudly if `cloudbuild-pr.yaml` ever regresses to referencing the
  custom, empty-by-default `$_REPO_FULL_NAME` substitution instead of Cloud
  Build's genuine built-in `$REPO_FULL_NAME`, or if any inline shell
  variable (`$total`, `${PIPESTATUS[0]}`, etc.) sneaks into a step's `args`
  where Cloud Build's own `$`-substitution parser would misread it.

## Cloud lane
`cloudbuild-pr.yaml` — steps: `assert-identity` (fail-closed SHA + repo
match, hardcoded to `CoachSaint/fantasy-war-room`, plus its own selftest) on
`gcr.io/cloud-builders/git` → `full-ci` (the same `scripts/ci-local/full.sh`
used locally) on plain `node:22`. No browser-driven tests exist in this repo
— `vitest.config.mjs` sets `environment: "node"`, and neither
`playwright` nor `puppeteer` nor `@testing-library/*` appear anywhere in
`package.json` or config — so a plain `node:22` image is correct; no
Chromium-capable step was added. Never deploys. Reports via Cloud Build's own
native GitHub check — no `gh`, no token, no status spoofing.

**Current 2026-09-25 status:** The PR trigger is active and reports the native
`fantasy-war-room-pr-ci (jtf-home-group)` check. This config remains
verification-only and does not deploy. The protected Yahoo activation PR is
draft until owner Yahoo data, final review, and release checks pass. The
credential-gated hosted fixtures are excluded from the ordinary test run;
run them explicitly with `FWR_LIVE_TEST=1` against disposable hosted records.

## Verified prerequisites — actually run, not fabricated
All of the following were executed for real on this box on 2026-09-21, after
installing and switching to Node 20 via `nvm install 20 && nvm use 20`
(default shell Node was v22.23.1; `node -v` after switching reported
`v20.20.2`, `npm -v` reported `10.8.2`):

- `bash scripts/ci-local/assert-identity.selftest.sh` — **PASS**. All six
  malformed-identity cases refused (empty sha, short sha, uppercase sha,
  empty observed repo, wrong observed repo, sha mismatched vs. workspace
  HEAD); the valid-identity case was accepted.
- `bash scripts/ci-local/cloudbuild-config.selftest.sh` — **PASS**. No
  `$_REPO_FULL_NAME` reference found; only the two allowed built-in
  substitutions (`$COMMIT_SHA`, `$REPO_FULL_NAME`) appear anywhere in
  `cloudbuild-pr.yaml`.
- `bash scripts/ci-local/full.sh` — **PASS**, end to end:
  - `npm ci` — succeeded, 415 packages added / 416 audited. Six
    `@supabase/*` sub-packages emitted `EBADENGINE` warnings (they declare
    `engines.node >=22.0.0`) — these are non-fatal `npm warn` lines, exit
    code 0, and this is the identical behavior the real Actions `verify` job
    would see since it also pins Node 20 via `actions/setup-node@v4`.
  - `npm test` (`vitest run`, vitest v4.1.10) — real observed summary:
    ```
     Test Files  10 passed (10)
          Tests  63 passed (63)
    ```
    **63 tests passed, 0 failed, 0 skipped, across 10 test files.** This is
    the exact count `full.sh`'s `MIN_TESTS` floor is now set to.
  - `npm run lint` (`eslint .`) — **PASS**, no errors or warnings emitted.
  - `npm run build` (`next build`, Next.js 16.3.1 with Turbopack) — **PASS**.
    Compiled successfully, TypeScript check finished, all 22 routes
    collected/prerendered/generated with no errors (only the same
    `@supabase/supabase-js` Node-20-deprecation warnings noted above, which
    are informational, not failures).
- `scripts/ci-local/quick.sh` — **PASS**. `tsconfig.json` is present, so it
  ran `npx tsc --noEmit`, which compiled cleanly with no type errors.
- `cloudbuild-pr.yaml` YAML syntax — validated with Ruby's stdlib YAML
  parser (`ruby -ryaml -e "YAML.load_file('cloudbuild-pr.yaml')"`, since this
  box's `python3` does not have `PyYAML` installed) — parsed cleanly,
  top-level keys: `steps`, `options`, `timeout`. No `gcloud builds submit`
  was run — this repo remains un-submitted per the hard boundary against any
  GCP API call.
