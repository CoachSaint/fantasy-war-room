# JTF Software Solutions | Fantasy War Room activation handoff

Updated: 2026-09-24

## Provisioned and verified

- Dedicated Supabase project: `fantasy-war-room`, ref `fswsefqqlltmaktiqwge`, `us-east-1`, created with Nano compute in the sole authenticated organization. No other product's project was reused. The project reports `ACTIVE_HEALTHY`. Supabase lists [Nano as the free compute tier](https://supabase.com/docs/guides/platform/compute-and-disk); the account billing page was not independently inspected.
- The worktree is linked to that exact project. `supabase migration list --linked` showed `0001` through `0004` aligned after each file was applied once in order. The project was empty before migration. No free-tier point-in-time recovery is configured; do not treat the schema as having a tested down migration.
- A disposable live RLS probe created two confirmed test identities and one test league/matchup. The owner read one matchup; an unrelated authenticated user and an anonymous client read zero; an unrelated insert was denied. The test identities and all test league rows were deleted and a follow-up count was zero.
- Vercel Production has `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `NEXT_PUBLIC_APP_URL`, and `NEXT_PUBLIC_DEMO_MODE=true` configured. The existing production Yahoo credentials were not changed or rotated. Values are held in Vercel and the local private credential directory, never in this repository.
- The PR branch adds a validated current-week Yahoo scoreboard import, league-scoped matchup rows, count reporting, and member-only read RLS. It does not claim historical/future schedules or a live Yahoo import.

## Owner and live gates still open

1. Identify Mason's intended Fantasy War Room sign-in email and have him create/sign in to his own Supabase Auth account. Do not guess or assign another person's identity. Confirm the new Yahoo application's Fantasy Sports: Read approval and registered production callback before asking for consent.
2. After the reviewed build is deployed with the correct environment, Mason or the league owner must select **Connect Yahoo** and complete Yahoo consent in their browser. Then run **Import Yahoo roster** from their authenticated session. The operator must compare imported league IDs, owned team, every roster, and current-week matchup counts/scores against the Yahoo league scoreboard. No agent has possession of Mason's Yahoo session, so this proof cannot be fabricated.
3. Verify the production deployment's exact Git SHA, Supabase health, OAuth callback, connection status, cross-user denials, cron authorization and degraded status, and rollback target. Keep demo mode on until those checks and the full data path pass. Do not rotate the Yahoo client secret or token encryption key before proving the current credentials work; a key rotation would invalidate stored tokens.
4. Decide whether to extend beyond current-week head-to-head matchups. The importer intentionally rejects a missing or malformed two-team scoreboard; this needs a product rule for byes, non-head-to-head leagues, and historical/future weeks before wider release.

## Safe status commands

Run from the PR worktree. Do not paste credential values into output, issues, or chat.

```sh
git status --short --branch
git rev-parse HEAD
supabase projects list --output json
supabase migration list --linked
vercel env ls production
gh pr checks 2
curl -fsS https://fantasy-war-room-pi.vercel.app/api/health
curl -fsS https://fantasy-war-room-pi.vercel.app/api/integrations/yahoo/status
```

The Supabase commands may prompt for the database password; use the private project credential store. Public health/status payloads must be interpreted with the exact deployment SHA. A green HTTP response is not an authenticated import proof.

Powered by JTF Software Solutions
