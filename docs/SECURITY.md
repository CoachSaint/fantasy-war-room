# Security contract

## Authentication and authorization expectations

| Surface | Expected behavior |
| --- | --- |
| `/api/health` | Operational status only; do not treat `200` as proof of league readiness |
| `/api/recommendations?demo=true` | Explicit fixture response with `demo: true`; no league auth is implied |
| `/api/recommendations?leagueId=...` | Requires Supabase credentials, authenticated bearer/cookie identity, and membership/owner access for that league |
| `/api/brief?leagueId=...` | Requires authenticated bearer/cookie identity and league membership; returns only the signed-in user's brief |
| `/api/leagues/setup` | Requires Supabase credentials and authenticated Supabase identity; validates and persists only canonical setup data |
| `/api/integrations/yahoo/start` | Authenticated redirect only; user-bound cryptographic state in a short-lived HttpOnly/SameSite cookie |
| `/api/integrations/yahoo/callback` | Requires the same authenticated app session and exact user-bound state; exchanges the code server-side, participates in the connection version lock, and stores AES-256-GCM ciphertext only |
| `/api/integrations/yahoo/status` | Returns token-free connection metadata scoped to the authenticated user |
| `/api/integrations/yahoo/sync` | Authenticated, rate-limited, read-only Yahoo import; database-serialized refresh rotation, strict provider validation, and persistence results are checked |
| `/api/coach/chat` with `demo: true` | Explicit demo reply and `source: demo-fixture` |
| `/api/coach/chat` connected | Requires league ID, authenticated membership, rate limit, OpenRouter credential, and persisted current league context |
| `/api/scout/run` | Requires exact constant-time `Authorization: Bearer <CRON_SECRET>`; no query-string secret or alternate header is accepted |

Client-supplied user IDs, manager IDs, roster IDs, and league IDs are not authorization. Resolve identity from the Supabase bearer token or SSR session, then verify membership before service-role reads. A service-role key bypasses RLS and must remain server-only.

## Secrets and data handling

- Keep `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, and `OPENROUTER_API_KEY` out of browser code, logs, screenshots, commits, and error bodies.
- Rotate credentials through Vercel/Supabase/provider secret management, not `.env.example`.
- Use only secret names, redacted prefixes, or deployment IDs in release evidence.
- Do not send provider secrets to Coach or persist them in recommendation payloads.
- Keep `NEXT_PUBLIC_DEMO_MODE` as a UI/behavior signal only; it is not an access control.

## RLS and database boundary

Apply `0001_initial.sql` before `0002_workspace_learning.sql`. Migration 2 adds workspace membership, league membership, setup structures, prediction/outcome records, calibration, and helper policies/functions. Verify RLS is enabled and policies are present in the target project. Test at least:

- user A cannot read user B's league, roster, recommendation, or evidence context;
- a league member can read only the league(s) to which they belong;
- viewer/member/admin/owner permissions match the intended write surface;
- service-role jobs write only records scoped to the intended league/workspace;
- unauthenticated calls cannot use a client-supplied ID to gain access.

The application has a legacy owner fallback only when the membership relation does not exist. Treat that as migration-incomplete compatibility, not a production target; once migration 2 is installed, membership checks must be the authoritative path.

## Request and provider safety

The current routes bound JSON/query sizes, Coach message count and total characters, Coach calls per user/IP window, setup collection sizes, scout season/week ranges, and recommendation limits. Preserve these bounds when extending APIs. Keep provider failures explicit and bounded; never substitute fixtures for a missing current provider result.

League setup currently uses checked multi-statement persistence with compensating deletion and returns `setup_rollback_failed` if cleanup cannot be proved. It is not a database transaction. Before enabling self-service live setup, move this operation into a reviewed transactional database function or otherwise prove atomic behavior under injected write and network failures.

Coach receives persisted recommendations and referenced evidence through a constrained prompt that forbids invented live facts. OpenRouter responses are untrusted external content: validate response shape, cap output, and avoid treating model text as executable instructions or deterministic scoring.

## Cron and deployment checks

Cron authorization is a deployment gate, not a unit-test-only claim. Verify missing, wrong, and correct bearer headers against the deployed URL. Confirm the route records a run and reports skipped/failed materialization steps honestly. Keep cron disabled or protected while `CRON_SECRET`, Supabase, migrations, provider mappings, and rollback evidence are incomplete.

## Known security limits

This repository does not prove a configured production Supabase project, deployed environment, DNS, provider account, or live RLS result. It also does not complete the real league synchronization/materialization pipeline. Distribution remains HOLD until owner provisioning and live checks close those gaps.
