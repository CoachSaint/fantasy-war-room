# Implementation status

Updated: 2026-09-25

## Decision

**Status: HOLD for full production distribution.** The repository is suitable for a protected demo and an integration preview. It is not evidence of a fully live, current, multi-tenant fantasy intelligence service until the configuration and live gates below are completed.

### 2026-09-24 activation check

- The dedicated Supabase project is on the **Free** plan with no selected paid add-ons. It has approximately 12 MB in a 500 MB database allowance. The application connects to the hosted project; a local Docker/Supabase CLI container is not required for production.
- Auth now points at the Vercel production URL, permits the exact `/auth/callback` redirect, and disables public signups. Administrator-generated invite links plus user-set passwords were proven with disposable users. The Supabase built-in mailer cannot deliver invites to arbitrary recipients without custom SMTP, so the operator must send the generated link directly to Mason's confirmed address after deployment.
- Connected roster and player APIs were proven against disposable owner/outsider/anonymous accounts. Owner reads succeeded, outsider and anonymous reads were denied, and all disposable rows/users were removed.
- The current nflverse weekly roster release provides exact Yahoo numeric player IDs and GSIS IDs. The candidate now joins imported Yahoo player keys to GSIS-backed canonical players when the mapping is unique. A disposable two-team Yahoo persistence fixture proved both roster assignments and a matchup, plus four provider IDs mapping to two canonical players; cleanup returned all affected table counts to zero. This is not a real Yahoo API consent/import proof.
- Yahoo settings normalization now reads only `stat_modifiers`, so a normal response containing both `stat_categories` and `stat_modifiers` does not reject category rows for lacking a numeric scoring value. A mixed-shape regression fixture passes. Connected League Settings displays the imported context; Coach excludes expired recommendations.
- The nflverse 2026 player-stats release currently contains regular-season weeks 1 and 2 while Sleeper reports week 3. Historical actuals are stored with their source week and never labeled as projections. Week 3 injury evidence is fetched separately. The large depth-chart asset is skipped under the bounded fetch limit.
- The candidate separately ingests current-week Sleeper projection fields for exact GSIS-matched players and keeps standard, half-PPR, and PPR values distinct. A disposable live Week 3 projection was persisted and repeated without duplicates, then removed. The public projection endpoint is observed but absent from Sleeper's published API reference; provider availability and non-commercial licensing remain release considerations. No projection accuracy claim has been established.
- Scout remains degraded: Yahoo consent/league sync, full snapshot diff, draft decisions, and full waiver/FAAB/three-week guidance are incomplete. The local candidate computes same-position Yahoo lineup swaps and narrow current-week add/drop pairs from source-matched Sleeper forecasts and imported Yahoo scoring modifiers. A disposable hosted-database control fixture proved one owner-scoped lineup swap, one available-player add/drop pair, replacement on rerun, a recommendation-change brief, and owner/outsider/anonymous read boundaries; it was cleaned up. The brief tracks materialized decision changes only. These checks do not establish forecast accuracy or a real Yahoo import. No real user league or recommendation has been imported or created.
- Migration `0005_yahoo_available_pool.sql` (SHA-256 `696b95953e8d94a009d3042fa98264045b70a32f83a0ecd10722a991da7cc019`) was applied to the dedicated hosted project after private public-schema/data dumps and a rolled-back SQL validation. The private pre-migration backups are `/Users/michaelsaint/.local/share/jtf/fantasy-war-room/rollback/2026-09-24-pre-0005-schema.sql` (SHA-256 `87c331cc87dd91339de7a893388d3b6665b26dab21ea9ce190f217308d59a905`) and `2026-09-24-pre-0005-data.sql` in the same directory (SHA-256 `32b076fb29ac377663db34f1048c47684b64a1e92a6f404eee867c98de32ba0b`). The migration list now shows local/remote `0001`–`0005` aligned. Yahoo sync can fetch at most 200 candidates per league from the official `status=A` collection, records whether the scan is truncated, and expires availability after six hours. No real Yahoo consent or live availability response has been observed. Post-fixture counts for users, leagues, players, evidence, recommendations, availability, and connections returned to zero.
- A manual Yahoo import now recomputes lineup and waiver advice from any already-ingested current-week forecasts and writes a new decision brief. The import response identifies leagues that were evaluated, still lack current inputs, or failed refresh; the setup UI keeps that result visible after its status reload. The hosted disposable control fixture passed this combined path. Scheduled Yahoo roster refresh and projection ingestion remain incomplete, so a manual import alone does not guarantee current advice.
- A bounded cron-authenticated Yahoo refresh endpoint now shares the manual sync lease and token-rotation path. Migration `0006_scheduled_yahoo_refresh.sql` enabled `pg_cron`/`pg_net` on the dedicated hosted Free project; local and remote migrations `0001`–`0006` align. A read-only query confirmed **zero** `fwr-yahoo-refresh` jobs. Scheduling requires deployment, the current `CRON_SECRET` in Supabase Vault, and a positive/negative endpoint check first; no scheduled Yahoo call or real consent has occurred.

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
| Supabase | Dedicated Free project `fswsefqqlltmaktiqwge` is healthy and the current Vercel production alias reports connected Supabase in demo mode; the candidate branch has not been deployed | Exact candidate SHA/deployment binding, Mason login, and live access checks |
| Schema | `0001` through `0006` are aligned on the dedicated project; `0006` only enables scheduler extensions and creates no job; private schema/data dumps predate `0005`, and disposable owner/outsider availability RLS reads passed | Recheck history before promotion and prove full user/membership isolation with real league data |
| League identity | Setup contract and persistence route exist | Authenticated real league setup, membership/roster mapping, persisted result |
| Setup atomicity | Every write and compensating cleanup result is checked | Transactional RPC or equivalent plus injected-failure proof before self-service production use |
| Sleeper | Public adapter exists; no account/league is configured here | Real league selection, current NFL state, roster/player ID verification |
| Yahoo | Production Vercel reports Yahoo credentials configured, but no user has consented or imported a league; the candidate branch has not been deployed | Confirm Fantasy Sports: Read permission and exact callback, then prove Mason's consent and live import with his account |
| Yahoo matchups | Current-week scoreboard fetch, normalization, persistence, schema and member-only RLS are implemented; no real Yahoo response or import is yet proven | Complete an authenticated Yahoo consent/sync and verify roster and matchup rows/counts against Yahoo's current-week scoreboard |
| nflverse | Release assets and bounded parser exist; some seasons/assets may be unavailable | Current season/week asset availability, timestamps, sample data validation |
| Materialization | Candidate branch persists source-labeled global nflverse actuals, matched evidence, and current-week Sleeper forecasts; narrow Yahoo lineup, available-player add/drop, and recommendation-change brief paths passed a disposable hosted-database control fixture; full snapshot diff remains skipped | Repeatable live Scout run with real Yahoo consent, exact league scoring, waiver/FAAB and draft decisions, and source-backed actions across the release surfaces |
| Coach | Evidence-constrained OpenRouter path exists; demo path is explicit | `OPENROUTER_API_KEY`, provider/model policy, cost/rate checks, evidence-grounded live response |
| Vercel | Cron declaration and a healthy current demo deployment exist; candidate branch is local only | Exact candidate deployment binding, cron history, auth negative/positive checks |
| Yahoo refresh schedule | The cron-authenticated endpoint and a guarded two-hour SQL job script are in the candidate; the hosted project has zero active Yahoo jobs | Deploy exact candidate, verify cron bearer and import behavior, store secret in Vault, activate job, and inspect actual job/HTTP/provider results |
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
