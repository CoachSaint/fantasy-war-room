# Distribution and release runbook

## Current release boundary

Fantasy War Room is currently a protected demo and integration candidate. It is not cleared for an unattended production league. A green local build is necessary but insufficient: the release owner must prove exact source-to-deployment binding, configured credentials, applied migrations, authenticated membership, provider freshness, cron behavior, rollback readiness, and live positive/negative checks.

## Implemented versus configuration-required

| Area | Implemented in the repository | Required before live distribution |
| --- | --- | --- |
| UI surfaces | `/today`, `/draft`, `/lineup`, `/waivers`, `/players`, setup flow, explicit configuration banners | Connect each surface to a verified league and current persisted data |
| League setup | Strict Zod contract, canonical slot/scoring/team/manager/player validation, deterministic fingerprint | Owner must submit a real setup while authenticated and verify the persisted league/membership result |
| Sleeper | User/league/roster/player/state adapters and fail-closed availability logic | Owner must select a league, map the manager roster, and verify current IDs and state |
| nflverse | Release-asset URLs, CSV/JSON parsing, season/week filters, depth/injury evidence, bounded degraded behavior | Verify the requested season has supported assets and record freshness; do not treat an empty result as current data |
| Decision engine | Deterministic scoring, lineup, draft survival, calibration, waiver/FAAB helpers | Materialize real snapshots, evidence, recommendations, and outcome/calibration records |
| API security | Supabase bearer/cookie identity, league membership authorization, bounded inputs, constant-time cron bearer check, Coach rate limit | Configure Supabase Auth, membership rows, RLS, secret rotation, and live negative tests |
| Scout cron | Vercel schedule and explicit degraded `503` response | Configure Supabase service role and `CRON_SECRET`; complete real sync/materialization steps before calling it healthy |
| Coach | OpenRouter call with evidence-only system instruction; explicit fixture reply in demo mode | Configure `OPENROUTER_API_KEY`, verify model/provider policy, cost limits, and current league context |

## Required provisioning

Set these names in the correct environment; never copy values into this repository:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only)
- `CRON_SECRET` (server-only)
- `OPENROUTER_API_KEY` (server-only, only if live Coach is enabled)
- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_DEMO_MODE` (`true` until the connected flow is verified; do not rely on this flag as an authorization boundary)
- `NFLVERSE_RELEASE_BASE_URL` (optional; official release base by default)
- `YAHOO_CLIENT_ID`, `YAHOO_CLIENT_SECRET`, `YAHOO_REDIRECT_URI`, and `YAHOO_TOKEN_ENCRYPTION_KEY` (server-only; leave unset until the Yahoo application is approved)

The owner must create Supabase Auth users, workspace/league membership records, provider mappings, and a real league setup. Credential creation, secret entry, DNS/domain ownership, billing, and production approval are owner-only actions.

## Migration order

Apply migrations exactly once and in filename order:

1. `supabase/migrations/0001_initial.sql`
2. `supabase/migrations/0002_workspace_learning.sql`
3. `supabase/migrations/0003_yahoo_integration.sql`

The second migration adds workspace membership, exact scoring rules, roster slot definitions, assignments, prediction/outcome, calibration, decision, and source-performance tables plus membership-scoped policies. The third queues encrypted, user-scoped Yahoo OAuth connections, provider links, and sync runs while extending the league provider constraint. Do not edit an applied migration or broaden a declaration to hide pending work. Before promotion, inspect the migration tool's declared and pending sets and apply only the exact pending files. There is no automatic down migration; retain a database rollback/PITR anchor and a tested application rollback plan.

## Vercel and Supabase cron behavior

`vercel.json` schedules `GET /api/scout/run` daily at `0 12 * * *`. Vercel's cron request must carry the platform-provided `Authorization: Bearer <CRON_SECRET>` header. The route rejects missing/mismatched secrets with `401`; missing `CRON_SECRET` or Supabase credentials is a configuration/degraded response, not a successful run. A run with persistence but incomplete provider/materializer work records skipped steps and returns degraded `503`.

After configuring production:

1. Invoke the deployment's health endpoint and confirm Supabase configured/connected state.
2. Send a cron request without the header and with an incorrect header; both must fail.
3. Send the exact bearer header; verify a persisted `scout_runs` record, step statuses, and expected degraded/success semantics.
4. Confirm the Vercel cron invocation history and Supabase timestamps agree.

## Promotion, rollback, and go/no-go

Before promotion, record the exact Git SHA, Vercel deployment URL/ID, migration result, environment scope, and current backup/PITR anchor. Run tests, lint, build, health, authenticated setup, membership isolation, demo truth, provider freshness, cron negative/positive checks, and a recommendation/Coach evidence check against the same deployment.

Go only when source, CI, deployed output, provider state, database schema, and live checks agree. Otherwise keep the deployment in preview/protected-demo mode.

For rollback, first stop or disable the affected cron, preserve failing request/run IDs, promote the last known-good Vercel deployment by exact ID/SHA, and re-run health plus negative auth checks. Do not roll back the database by deleting rows or editing applied migrations; use the reviewed migration/PITR procedure and reconcile application/schema compatibility before resuming cron.

## Demo truth rules

- Demo mode is an explicit preview state, not a connected league.
- Demo recommendations and Coach replies must identify fixture/demo provenance.
- Demo data must never be written as current provider snapshots, evidence, scores, or recommendations.
- A missing provider/database result is `degraded`, `skipped`, or an error; it is never silently replaced by demo data.
- A successful HTTP response alone does not prove current intelligence.
