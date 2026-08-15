# Yahoo Fantasy integration queue

## Current state

The read-only Yahoo integration is implemented but deliberately inert until Yahoo approves the developer application and the server configuration is complete. Missing credentials return `yahoo_credentials_pending`; they never trigger a provider request or a partial import.

## Owner activation checklist

1. In Yahoo Developer Network, create or finish approval for a Web Application with **Fantasy Sports: Read** access. Do not request write access.
2. Register the stable production callback exactly as:
   `https://fantasy-war-room-pi.vercel.app/api/integrations/yahoo/callback`
3. Apply migrations in order: `0001_initial.sql`, `0002_workspace_learning.sql`, then `0003_yahoo_integration.sql`.
4. Add these server-only values to the intended Vercel environment:
   - `YAHOO_CLIENT_ID`
   - `YAHOO_CLIENT_SECRET`
   - `YAHOO_REDIRECT_URI`
   - `YAHOO_TOKEN_ENCRYPTION_KEY` (32 random bytes, base64 encoded; retain securely because rotating it requires reconnecting accounts)
   - `YAHOO_OAUTH_SCOPE` only if Yahoo explicitly assigns a scope string
5. Redeploy, authenticate to Fantasy War Room, open `/league/setup`, and select **Connect Yahoo**.
6. After consent, select **Import Yahoo roster**. Confirm league, every roster, starters/bench/IR, scoring payload, roster slots, FAAB/waiver priority when supplied, and the current user's league membership.

Never place the client secret, encryption key, access token, refresh token, authorization code, or OAuth state in source control, screenshots, URLs beyond Yahoo's one-time authorization code callback, or client-side code.

## Implemented flow

- `GET /api/integrations/yahoo/start` requires a Fantasy War Room session, creates a cryptographically random state value cryptographically bound to that user, stores it in a short-lived HttpOnly/SameSite cookie, and redirects to Yahoo.
- `GET /api/integrations/yahoo/callback` verifies session and user-bound state, exchanges the authorization code server-side, encrypts both tokens with AES-256-GCM, persists ciphertext only, clears the state cookie, and returns to setup.
- `GET /api/integrations/yahoo/status` returns a token-free status DTO.
- `DELETE /api/integrations/yahoo/status` deletes the user's stored Yahoo connection and cascades provider links/sync history; imported league snapshots remain explicitly stale until reconnection.
- `POST /api/integrations/yahoo/sync` takes a 30-minute versioned database lease before refreshing or importing, persists a rotated refresh token, discovers the user's NFL leagues, fetches league settings and every team roster, validates required provider structures, and writes league/roster/provider-player mappings. The callback participates in the same compare-and-swap version so reconnect and sync cannot replace each other's credentials.
- New Yahoo-only player identities are marked `provider_only` and placed in a service-role reconciliation queue. They are not silently joined by display name or presented as resolved cross-provider identities.

The sync path is read-only with respect to Yahoo. It never submits lineup, waiver, trade, or roster mutations.

Yahoo synchronization is currently a checked multi-statement import, not a single database transaction. Replacement rows are written before stale-row cleanup so failed retries preserve the previous snapshot, but keep the full-production gate closed until injected live-database failures prove retry behavior or the import is moved behind a transactional database boundary.

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
