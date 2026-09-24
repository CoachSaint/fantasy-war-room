# Implementation status

Updated: 2026-09-24

## Decision

**Status: HOLD for full production distribution.** The repository is suitable for a protected demo and an integration preview. It is not evidence of a fully live, current, multi-tenant fantasy intelligence service until the configuration and live gates below are completed.

## Repository-complete work

- Five polished product surfaces plus explicit demo/configuration boundaries.
- League Setup Studio contract with strict input validation and canonical deterministic output.
- Exact scoring profile, roster slot, team/manager mapping, and player assignment DTOs.
- Fail-closed Sleeper roster identity and explicit active-pool availability calculation.
- nflverse official release-asset URL builder, CSV/JSON ingestion, season/week filtering, depth order, and practice participation preservation.
- Deterministic scoring, lineup optimization, seeded draft survival simulation, calibration metrics, and FAAB range helpers.
- Authenticated league setup persistence path and membership-aware recommendation/Coach reads.
- Constant-time cron bearer authorization, bounded request validation, Coach rate limiting, and explicit provider/database degradation responses.
- Initial schema plus workspace/membership/learning migration with RLS definitions.
- Credential-gated Yahoo OAuth, encrypted token persistence, normalized league/roster import, and setup UI are implemented. They have not been proven with a live authenticated import.

## Configuration or owner action still required

| Gate | Current boundary | Owner evidence required |
| --- | --- | --- |
| Supabase | Code supports browser/admin clients; credentials may be absent | Project URL/keys, Auth users, migration application, connected health check |
| Schema | `0001` then `0002` are present in the repository | Exact applied/pending migration output and RLS policy verification |
| League identity | Setup contract and persistence route exist | Authenticated real league setup, membership/roster mapping, persisted result |
| Setup atomicity | Every write and compensating cleanup result is checked | Transactional RPC or equivalent plus injected-failure proof before self-service production use |
| Sleeper | Public adapter exists; no account/league is configured here | Real league selection, current NFL state, roster/player ID verification |
| Yahoo | Production Vercel has server-side OAuth variable names set, but the current deployment still reports `awaiting_credentials`; a new deployment, Yahoo confirmation, and live consent/import have not been proven | Confirm the new Yahoo app's Fantasy Sports: Read permission and Client ID approval; verify migration 0003 and exact callback; redeploy only after the app-specific database is bound; then prove consent and live import |
| Yahoo matchups | League settings, teams, and rosters are imported; weekly matchups are not fetched or persisted and the schema has no matchup relation | Approve a league-week matchup schema and RLS/retry contract, then implement and verify matchup import against a bound test database |
| nflverse | Release assets and bounded parser exist; some seasons/assets may be unavailable | Current season/week asset availability, timestamps, sample data validation |
| Materialization | Scout honestly marks sync, normalization, scoring, diff, and recommendation materialization as skipped until configured | Real provider-to-canonical-player sync, snapshot/evidence persistence, recommendations, and repeatable run |
| Coach | Evidence-constrained OpenRouter path exists; demo path is explicit | `OPENROUTER_API_KEY`, provider/model policy, cost/rate checks, evidence-grounded live response |
| Vercel | Cron declaration exists | Production env scope, deployment binding, cron history, auth negative/positive checks |
| Rollback | Application rollback procedure is documented | Exact known-good deployment/SHA, database backup/PITR anchor, tested recovery |

## Truthful runtime states

- **Demo:** fixture data is shown intentionally and responses identify demo provenance.
- **Preview/configuration required:** the app directs the operator to connect Supabase/league state; no current recommendation claim is valid.
- **Degraded:** a required database/provider/materializer path is unavailable; HTTP and Scout step status must say so.
- **Connected candidate:** authenticated league and provider data exist, but release still needs live end-to-end evidence.
- **Production-ready:** only after exact source/live binding, migrations, RLS isolation, freshness, cron, rollback, and functional/negative checks pass together.

## Release checklist

1. Pin/install dependencies and run `npm test`, `npm run lint`, and `npm run build`.
2. Capture exact Git SHA and CI results; separate passed, failed, and skipped checks.
3. Configure only the documented environment names in the intended Vercel scope.
4. Apply migrations in order and capture declared versus pending results.
5. Verify Supabase Auth, workspace membership, league membership, and RLS isolation with separate users.
6. Complete a real league setup and verify canonical player/roster mappings.
7. Verify current Sleeper and nflverse source data; reject stale/empty data as current intelligence.
8. Run Scout with missing/wrong/correct cron credentials and inspect persisted steps.
9. Verify recommendations and Coach only return the authenticated league context; verify demo remains visibly demo.
10. Record deployment URL/ID, migration result, health output, cron history, provider freshness, rollback anchor, and final owner go/no-go.

The final go/no-go and owner-participation credential actions remain with the release owner. This document intentionally does not claim they have occurred.
