# Yahoo Fantasy integration setup

## Current state

Yahoo granted Fantasy Sports as a permission on the developer account on September 22, 2026. This does **not** add it to an existing application. The read-only integration remains inert until a **new** Yahoo application has that permission, its Client ID has been submitted to Yahoo for confirmation, and the server configuration is complete. Missing credentials return `yahoo_credentials_pending`; they never trigger a provider request or a partial import.

## Owner activation checklist

1. Sign in to [Yahoo Developer Network](https://developer.yahoo.com/apps/) with the developer account that received the Fantasy Sports permission. Create a **new Web Application** named Fantasy War Room. Existing applications cannot acquire the newly granted permission. Select **Fantasy Sports: Read** under API Permissions; do not request write access.
2. Register the stable production callback exactly as:
   `https://fantasy-war-room-pi.vercel.app/api/integrations/yahoo/callback`
   Confirm this is still the actual production domain before saving the Yahoo app. A preview domain or localhost requires its own registered callback and matching `YAHOO_REDIRECT_URI` in that environment.
3. Create the Yahoo app, then submit its **Client ID (Consumer Key)** at [Yahoo Fantasy application confirmation](https://sports.yahoo.com/developer/application-confirmation/). Do not submit the Client Secret. Record Yahoo's confirmation result before enabling live imports.
4. Identify the Supabase project actually bound to this deployment, and inspect its applied migrations before changing it. Apply only pending migrations in order: `0001_initial.sql`, `0002_workspace_learning.sql`, `0003_yahoo_integration.sql`, `0004_yahoo_weekly_matchups.sql`, `0005_yahoo_available_pool.sql`, then `0006_scheduled_yahoo_refresh.sql`. Do not point this app at another product's database.
5. Add these server-only values to the intended Vercel environment:
   - `YAHOO_CLIENT_ID`
   - `YAHOO_CLIENT_SECRET`
   - `YAHOO_REDIRECT_URI`
   - `YAHOO_TOKEN_ENCRYPTION_KEY` (32 random bytes, base64 encoded; retain securely because rotating it requires reconnecting accounts)
   - `YAHOO_OAUTH_SCOPE` only if Yahoo explicitly assigns a scope string
   Use the new app's credentials, replacing any old app credentials. Generate the encryption key once and retain it securely. Do not change it during a client-ID rotation if stored Yahoo tokens must remain decryptable; users must reconnect under the new Yahoo app.
6. Redeploy, authenticate to Fantasy War Room, open `/league/setup`, and select **Connect Yahoo**.
7. After consent, select **Import Yahoo roster**. Confirm league, every roster, starters/bench/IR, scoring payload, roster slots, FAAB/waiver priority when supplied, and the current user's league membership.

Never place the client secret, encryption key, access token, refresh token, authorization code, or OAuth state in source control, screenshots, URLs beyond Yahoo's one-time authorization code callback, or client-side code.

## Implemented flow

- `GET /api/integrations/yahoo/start` requires a Fantasy War Room session, creates a cryptographically random state value cryptographically bound to that user, stores it in a short-lived HttpOnly/SameSite cookie, and redirects to Yahoo.
- `GET /api/integrations/yahoo/callback` verifies session and user-bound state, exchanges the authorization code server-side, encrypts both tokens with AES-256-GCM, persists ciphertext only, clears the state cookie, and returns to setup.
- `GET /api/integrations/yahoo/status` returns a token-free status DTO.
- `DELETE /api/integrations/yahoo/status` deletes the user's stored Yahoo connection and cascades provider links/sync history; imported league snapshots remain explicitly stale until reconnection.
- `POST /api/integrations/yahoo/sync` takes a 30-minute versioned database lease before refreshing or importing, persists a rotated refresh token, discovers the user's NFL leagues, fetches league settings and every team roster, validates required provider structures, and writes league/roster/provider-player mappings. The callback participates in the same compare-and-swap version so reconnect and sync cannot replace each other's credentials.
- `POST /api/integrations/yahoo/refresh` uses the exact server-only `CRON_SECRET` bearer, iterates at most ten previously consented connections, and calls the same locked import path. It never creates consent or exposes stored tokens. It reports failed, partial, and already-running imports separately.
- New Yahoo-only player identities are marked `provider_only` and placed in a service-role reconciliation queue. They are not silently joined by display name or presented as resolved cross-provider identities.

The sync path is read-only with respect to Yahoo. It never submits lineup, waiver, trade, or roster mutations. For each imported head-to-head league it also fetches the current-week scoreboard, validates both teams against imported rosters, and stores matchup scores, projections, status, and winner in `league_week_matchups`. It does not fetch historical or future weeks.

Yahoo synchronization is currently a checked multi-statement import, not a single database transaction. Replacement rows are written before stale-row cleanup so failed retries preserve the previous snapshot, but keep the full-production gate closed until injected live-database failures prove retry behavior or the import is moved behind a transactional database boundary.

### Scheduled refresh activation and fallback

Migration `0006` enables `pg_cron` and `pg_net` on the dedicated Supabase project. It does **not** create a job. After the exact candidate is deployed, verify the refresh endpoint rejects missing/wrong bearer and succeeds with the deployed `CRON_SECRET`. Store that same bearer in Supabase Vault under `fwr_yahoo_refresh_bearer` without printing or checking it into source. Then run `scripts/schedule-yahoo-refresh.sql` against the linked project. The job calls the deployed HTTPS endpoint every two hours; the bearer value stays in Vault. Verify one authorized run and inspect both `cron.job_run_details` and the Yahoo sync-run/connection timestamps. The six-hour roster and availability expiry is a hard freshness bound, not a guarantee that Yahoo or Sleeper responded.

For fallback, run `scripts/unschedule-yahoo-refresh.sql` to stop future calls, use the **Import Yahoo roster** button for a consented account, and keep any stale recommendations hidden. On an application rollback, explicitly inspect the cron job: Vercel deployment rollback does not change the Supabase schedule. The current branch has not deployed the endpoint or activated the job, so scheduled refresh has not been proven with a real Yahoo account.

### Matchup boundary

Migration `0004_yahoo_weekly_matchups.sql` adds league-scoped current-week matchup storage and a read policy for authenticated league members. It has passed a disposable owner/outsider/anonymous RLS probe on the dedicated project. No live Yahoo scoreboard or Mason roster has been imported yet, so provider parsing and end-to-end counts remain unproven. Every imported team must appear exactly once in a two-team current-week matchup; a partial scoreboard fails before league, roster, or matchup writes and cleanup. OAuth lease, token refresh, and sync-run bookkeeping may already have been written. Byes, non-head-to-head leagues, and absent scoreboards therefore fail explicitly; historical and future schedule import remain out of scope.

## Verification gate after approval

- Wrong or missing OAuth state fails without token exchange.
- A callback without an authenticated Fantasy War Room user fails closed.
- Cross-user status, token, league-link, and sync-run reads are denied.
- Revoked/expired Yahoo authorization produces a reconnect state, not demo substitution.
- A user with multiple NFL leagues sees each imported exactly once.
- Yahoo player keys are stored as provider mappings; display names are not used as joins.
- The connected roster is the team marked as owned by the current Yahoo login; the importer never chooses the first roster.
- Refresh-token rotation is stored before the new token is relied on by later invocations.
- Concurrent sync attempts are rejected while the connection's versioned database lock is held.
- Empty or malformed discovery, metadata, team, roster, or slot payloads fail without recording a zero-league completion.
- Unsupported custom/IDP slots or player positions, missing scoring modifiers, and missing selected positions fail explicitly instead of producing a partial import.
- Live deployment, callback URI, Supabase migration, and final environment scope are recorded against one exact Git SHA.
