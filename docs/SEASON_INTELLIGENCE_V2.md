# Fantasy War Room — Season Intelligence V2 Build Directive

Status: approved product direction for local-agent implementation
Target: 2026 NFL fantasy season
Primary deployment: Next.js on Vercel + Supabase/Postgres

## North Star

Build the most interactive, data-rich and decision-useful fantasy football app we can ship while keeping the deployed architecture lightweight.

The product is not a generic rankings site and not an LLM chat toy.

**Deterministic/statistical systems produce the decision payload. AI explains, reconciles, researches and teaches.**

Every actionable recommendation must be league-aware, roster-aware, time-aware and evidence-backed. Every recommendation must be auditable after the games are played so the system can learn where it was right and wrong.

---

## P0 corrections before adding more surface area

### 1. Replace single-owner league access with workspace membership

The current `leagues.owner_id` RLS design is insufficient because Michael and Mason must both access the same league/workspace safely.

Introduce:

- `workspaces`
- `workspace_members`
- `league_memberships`
- `user_preferences`

Recommended roles:

- `owner`
- `admin`
- `member`
- `viewer`

A workspace owns league records. Users receive access through membership, not by duplicating leagues.

Required behavior:

- Michael and Mason each have separate auth identities.
- Both can enter and view the same league.
- Each user can own a different fantasy roster/team inside the same league.
- Each user can have separate risk tolerance, preferred strategy, notification preferences and decision history.
- Shared NFL/player intelligence is stored once.
- League context is stored once.
- User-specific recommendations are derived against the user's roster and preferences.

Never silently fall back to another user's roster if a mapping fails. Missing roster ownership must produce an explicit setup state/error.

### 2. Correct Sleeper availability semantics

`availablePlayerIds` must mean players who are actually free agents/waiver eligible in the imported league.

Build the available pool as:

`active canonical player pool - all rostered player IDs - unavailable/reserve-only exclusions if league rules require them`

Do not populate `availablePlayerIds` from the set of rostered players.

Use Sleeper `user_id` as the durable external identity because Sleeper usernames can change.

Sleeper's API is read-only and free, exposes leagues, rosters, users, drafts, matchups, transactions and trending add/drop data. Keep calls under Sleeper's stated usage guidance and cache the full NFL player map for at least 24 hours.

### 3. Fix nflverse semantics and transport

Do not use actual weekly fantasy points as a projected-points field.

Separate concepts explicitly:

- `actual_fantasy_points`
- `projected_fantasy_points`
- `expected_fantasy_points`
- `rolling_opportunity`
- `rest_of_season_projection`

Use nflverse release assets / supported release URLs rather than assuming old `master/data/...` raw paths exist. nflverse explicitly publishes current data through release assets and makes it available in CSV/Parquet/RDS/QS formats.

Prefer Parquet or compact JSON generated during ingestion rather than repeatedly downloading huge source files in user requests.

---

# Multi-user / two-manager architecture

## Workspace model

```text
workspace
  ├─ members
  │    ├─ Michael
  │    └─ Mason
  ├─ leagues
  │    └─ 2026 league
  ├─ shared NFL intelligence
  ├─ shared league market state
  └─ per-user manager profiles
       ├─ roster ownership
       ├─ strategy preferences
       ├─ decision history
       └─ personalized recommendations
```

### Required tables

#### `workspaces`
- `id`
- `name`
- `created_by`
- `created_at`

#### `workspace_members`
- `workspace_id`
- `user_id`
- `role`
- `display_name`
- `joined_at`
- unique `(workspace_id, user_id)`

#### `league_memberships`
Maps an authenticated War Room user to the league's external manager/team identity.

- `league_id`
- `user_id`
- `roster_id`
- `provider_user_id`
- `is_primary`
- `created_at`

#### `manager_preferences`
- `user_id`
- `league_id`
- `risk_tolerance` 0–100
- `upside_bias` 0–100
- `floor_bias` 0–100
- `rookie_aggression` 0–100
- `waiver_aggression` 0–100
- `trade_aggression` 0–100
- `qb_strategy`
- `te_strategy`
- `stacking_preference`
- `favorite_teams` jsonb
- `avoid_players` jsonb
- `notes` jsonb

Preferences are a recommendation modifier, never a replacement for objective football value.

---

# Detailed roster entry and league setup

The app must support both provider import and completely manual setup.

## Setup wizard

### Step 1 — League basics

Allow:

- league name
- season
- team count
- draft type: snake / auction / keeper / dynasty-ready placeholder
- waiver type: rolling / reverse standings / FAAB
- FAAB budget
- playoff weeks
- trade deadline
- IR rules
- taxi rules placeholder
- keeper count placeholder

### Step 2 — Scoring

Do not reduce scoring to `standard | half_ppr | ppr` internally.

Those can remain UI presets, but canonical scoring must support exact coefficients for:

Passing:
- pass yard
- pass TD
- interception
- completion
- incompletion
- 2-point conversion
- bonuses for 300/400 yards

Rushing:
- rush yard
- rush TD
- rush first down
- 2-point conversion
- 100/200-yard bonuses

Receiving:
- reception
- reception by position if supported
- receiving yard
- receiving TD
- receiving first down
- 2-point conversion
- 100/200-yard bonuses

Misc:
- fumble
- fumble lost
- return yards/TD
- individual defensive player rules placeholder

Kicker and DST:
- field-goal bands
- PAT
- sacks
- turnovers
- safeties
- defensive TD
- points allowed bands
- yards allowed bands

Store exact scoring coefficients in canonical JSON plus a generated normalized scoring profile.

### Step 3 — Roster slots

Support counts for:

- QB
- RB
- WR
- TE
- FLEX (RB/WR/TE)
- SUPER_FLEX (QB/RB/WR/TE)
- WR_RB
- WR_TE
- K
- DST
- BENCH
- IR
- TAXI placeholder

Store slots as first-class rows or strongly typed slot definitions — not only a string array — so lineup optimization can reason about eligibility.

### Step 4 — Teams and owners

Allow two entry modes:

1. provider import
2. manual team grid

Manual grid fields:

- fantasy team name
- manager name
- linked War Room user (optional)
- external/provider IDs (optional)
- current FAAB
- waiver priority
- wins/losses/ties

### Step 5 — Player roster entry

For each team:

- search canonical NFL player index
- multi-select/add
- designate starters
- designate bench
- IR assignment
- position eligibility validation
- duplicate-player prevention across league rosters
- fast paste/import mode for newline or CSV-like player lists

Fast paste must resolve names against canonical identity and show ambiguity before save.

### Step 6 — Verify

Before activating a league, show:

- roster count mismatches
- duplicate players
- illegal lineup slots
- missing manager mapping
- scoring assumptions
- unresolved player IDs

A league with unresolved structural errors cannot silently become active.

---

# Canonical football intelligence model

## Player identity

Canonical player records should map identifiers from multiple sources:

- Sleeper
- GSIS / nflverse
- ESPN ID if legally obtained through a supported source
- Yahoo ID after Yahoo integration
- Sportradar/PFF/other future provider IDs

Never join important player data by display name alone.

## Weekly player feature families

### Opportunity / role

- snap share
- route participation
- targets
- target share
- targets per route run
- air-yards share when available
- carries
- rush share
- goal-line carries
- red-zone opportunities
- red-zone target share
- touches
- opportunities inside the 10 / 5
- two-minute usage
- third-down usage
- first-read / designed-target proxy when available

### Efficiency

- yards per route
- yards per target
- yards after catch
- explosive-play rate
- catch rate over expectation where supported
- rushing success / expected rushing metrics when available
- EPA / success context where appropriate

Efficiency should never overpower opportunity over small samples.

### Environment

- opponent
- home/away
- game total
- implied team total
- spread
- expected play volume
- team pace
- neutral pass rate
- red-zone opportunity expectation
- weather
- indoor/outdoor

### Availability / health

- official status
- practice participation by day
- consecutive missed/limited practices
- injury category
- beat-reporter/coach evidence
- active/inactive status
- backup-role implications

### Market

- draft ADP
- position ADP
- ADP trend
- roster percentage when legitimately available
- Sleeper add/drop trend
- waiver competition proxy
- expert-consensus benchmark when licensed/permitted

### Schedule / replacement

Replacement level must be calculated per actual league configuration.

Do not hard-code one QB/RB/WR/TE replacement baseline for all leagues.

Replacement should consider:

- number of teams
- starting slots
- flex/superflex eligibility
- bench depth
- rostered player distribution
- actual available pool

This is required before WAR/VOR can be trusted.

---

# Decision engines

## Draft engine

Output more than a single rank.

For each available player return:

- overall draft score
- projected value over replacement
- market value / ADP discount
- positional scarcity
- roster fit
- tier
- downside risk
- upside score
- probability player survives to next pick
- portfolio/roster construction impact
- recommended action: TAKE / TARGET / WAIT / PASS

Draft strategy must be pick-position aware and should support simulation of the next 1–3 rounds.

### Draft simulation

Build a lightweight Monte Carlo/market simulation using ADP distributions rather than an LLM.

Question it should answer:

> If we pass on this RB at pick 31, what is the probability a comparable RB remains at pick 42, and what WR/TE/QB value would we gain by waiting?

This is a major competitive feature.

## Start/Sit engine

For every candidate:

- median projection
- floor
- ceiling
- confidence interval
- role certainty
- injury uncertainty
- matchup adjustment
- game-environment adjustment
- late-swap risk

Return an optimal lineup plus the marginal expected value of each decision.

Example:

`Start A over B: +2.7 median points, +0.8 floor, -1.4 ceiling, 82% confidence.`

This allows users to choose floor vs upside intentionally.

## Waiver engine

Rank available players for **this roster**, not globally.

Include:

- add score
- suggested drop(s)
- marginal roster improvement
- FAAB bid range
- urgency
- probability another manager claims player
- role-change signal
- short-term schedule
- rest-of-season value
- stash value

FAAB should respond to league budget remaining, week of season, roster need and scarcity.

## Trade engine

Add after the core roster model is correct.

Trade valuation must evaluate:

- points above replacement, not summed name value
- starting lineup impact
- bench replacement effect
- positional scarcity
- playoff schedule
- roster holes created
- two-for-one roster-slot value
- risk concentration

Return both objective value and **whether we would actually do it for this team**.

---

# Season-long learning loop

Chat history is not learning.

The system must maintain a prediction and decision ledger.

## `prediction_events`

Every material prediction is immutable and timestamped.

Fields:

- `id`
- `player_id`
- `league_id` nullable
- `user_id` nullable
- `prediction_type`
- `target_week`
- `predicted_mean`
- `predicted_floor`
- `predicted_ceiling`
- `probability` where applicable
- `feature_snapshot_id`
- `engine_version`
- `created_at`

Prediction types include:

- weekly points
- start-vs-sit win probability
- breakout
- injury-active probability
- target/carry range
- rest-of-season value tier

## `prediction_outcomes`

After games finalize:

- actual fantasy points under league scoring
- actual snaps
- actual routes
- actual targets/carries
- actual injury/availability outcome
- prediction error
- calibration bucket

## `decision_events`

Record what War Room recommended.

- user
- league
- recommendation
- alternatives
- recommendation confidence
- recommendation timestamp
- whether user accepted/ignored/overrode
- user note/reason

Do not assume the user made a move simply because the app recommended it.

## `engine_calibration`

Track by:

- engine version
- position
- prediction type
- season phase
- confidence bucket
- sample size

Metrics:

- MAE / RMSE for projected points
- Brier score for probabilities
- coverage rate for floor/ceiling intervals
- rank correlation
- start/sit decision win rate
- waiver add value after 1/3/6 weeks
- regret versus best available alternative

### Learning rule

No online model may rewrite production weights directly from a single week's outcomes.

Use bounded calibration updates:

1. record predictions
2. record actuals
3. measure error by feature family
4. identify persistent bias over adequate sample
5. create candidate calibration change
6. backtest against prior weeks
7. version the engine
8. promote only when validation improves

This keeps the app genuinely self-improving without letting one fluke Sunday poison the model.

---

# Expert consensus and source weighting

Treat external expert opinion as one signal, not ground truth.

FantasyPros' 2026 ECR methodology is useful as a benchmark because it aggregates experts using rank points rather than a naive mean and increasingly filters toward historically accurate experts during the season. Their public accuracy methodology evaluates draft and weekly expert predictions against actual production.

Do **not** scrape or republish commercial ranking datasets unless their terms/license permit it.

Instead, our internal `source_performance` table should learn reliability from sources we are permitted to ingest.

Example:

- official NFL transaction/inactive data: very high fact confidence
- official team injury report/practice: very high status confidence
- trusted beat reporter: high but event-specific
- consensus/market signal: medium-high predictive input
- social rumor: low until corroborated

Source weights should be fact-type specific. A source can be excellent at injury news and mediocre at player projection.

---

# Football-expert knowledge standard

The Coach/Scout system should explicitly reason with the following concepts and vocabulary:

## Draft / roster construction

- value based drafting / VOR
- positional replacement level
- tier-based drafting
- ADP value and market price
- positional runs
- roster construction
- zero-RB / hero-RB / robust-RB as strategies, not dogma
- late-round QB vs elite QB economics
- TE scarcity
- superflex QB economics
- playoff-week correlation
- stacking and game correlation where relevant
- injury/fragility risk
- rookie uncertainty and draft-capital priors

## Weekly football analysis

- opportunity precedes production
- routes matter more than raw snap count for receivers
- targets per route and target share contextualize role
- carry share and goal-line work contextualize RB usage
- efficiency is noisy in small samples
- touchdown rate regresses
- role changes matter faster than season-long box scores
- opponent quality must be adjusted for schedule/context
- betting/game environment can improve expectations but cannot replace player role
- weather matters most in extreme wind/precipitation and kicking/passing contexts
- practice progression matters more than a static Wednesday designation

## Waivers

- chase changing opportunity before last week's fantasy points
- identify contingent value
- distinguish one-week replacement from season-long role acquisition
- FAAB value is time-dependent; unused budget has diminishing value late in season

## Evaluation

- a correct process can lose one week
- measure probabilistic calibration, not only binary wins
- compare recommendations against realistic alternatives available at decision time
- never use information published after a decision deadline when scoring historical advice

---

# Data-source hierarchy

## Tier 1 — core/open

### Sleeper API
Use for:

- league metadata
- exact scoring settings
- roster positions
- league users
- rosters/starters/reserve
- drafts and draft picks
- matchups
- transactions
- traded picks
- trending adds/drops

Sleeper is read-only. Attribute trending data as required.

### nflverse
Use release assets for:

- play-by-play
- player summary stats
- rosters
- weekly rosters
- depth charts
- practice/injury data
- snap counts
- Next Gen Stats datasets made available through nflverse
- FTN charting subset made available through nflverse
- player ID crosswalks

Cache locally in Supabase/object storage after ingestion.

## Tier 2 — first-party context

- official team/NFL injury and transaction reporting
- NFL schedules/state
- NWS/NOAA weather for outdoor games

## Tier 3 — market/expert optional

- legally accessible betting market data
- licensed/compliant projection or consensus source
- Yahoo Fantasy API once app access/OAuth is approved

Yahoo's official Fantasy Sports API supports league/team/player access through OAuth 2.0 and currently requires application access/review. Build a provider boundary now, not a brittle scraper.

---

# Lightweight deployment architecture

Keep the browser/application path simple:

```text
Vercel Next.js UI / server routes
        │
        ├── Supabase Auth + Postgres + Realtime
        ├── deterministic TypeScript decision services
        └── optional LLM explanation provider

Supabase Cron / Edge Function ingestion lane
        │
        ├── Sleeper
        ├── nflverse release assets
        ├── injury/news/context
        └── feature materialization
```

## Scheduling recommendation

Do not make Sunday freshness depend on Vercel Hobby Cron. Vercel Hobby cron is limited to once per day and has loose timing precision.

Use Supabase Cron + Edge Functions for ingestion/update schedules. Supabase supports `pg_cron` and scheduled Edge Function invocation, allowing much more frequent lightweight refreshes without introducing another always-on server.

Suggested cadence:

### Offseason / early draft season
- player master: daily
- ADP/market: 2–4x daily if source permits
- news/injury: every 2–4 hours

### NFL game weeks
- Tuesday–Wednesday: every 2 hours
- Thursday–Saturday daytime: hourly for evidence/state
- Sunday 7am–noon Central: every 10–15 minutes for high-priority availability/news signals where provider terms allow
- Sunday after early inactives: immediate recompute
- Monday/Tuesday: outcome reconciliation and calibration

Do not run expensive full-model work every 10 minutes. Incrementally ingest deltas and only recompute affected players/leagues.

---

# UI / interaction requirements

Data-rich must not become visually dense sludge.

## Global interaction model

Every important player row/card should support:

- tap/click to expand
- compare
- add to watchlist
- ask Coach about this player
- view evidence timeline
- view trend chart
- view why rank changed

## Today

Show only actionable deltas first:

- `3 things changed since your last visit`
- lineup alerts
- waiver opportunity
- injury impact
- market movers
- upcoming deadline

## Player detail

Tabs/sections:

- Overview
- Usage
- Projection
- Matchup
- Health
- Market
- News/Evidence
- History

Include sparklines/trend charts for:

- weekly points
- snap share
- route share
- target share
- rush share
- projection
- WAR/VOR
- roster/add trend

## Decision transparency

Every recommendation must have an expandable `Why?` drawer containing:

- top positive factors
- top negative factors
- latest evidence
- data freshness
- model confidence
- what would change the recommendation

Example:

> Start Player A — 82% confidence. This flips to Player B if A is inactive, projected snaps fall below 60%, or the game total drops materially before lock.

## Two-manager experience

Persistent user/roster switcher must make it obvious whose team is currently being optimized.

Never mix Michael's personalized roster advice with Mason's.

Shared league intelligence can be identical; personal action cards cannot.

---

# Ask Coach architecture

The current demo-context prompt must evolve into tool-backed retrieval.

Coach should call internal services for:

- current league context
- current roster
- available players
- player comparison
- lineup optimization
- waiver candidates
- draft candidates
- evidence timeline
- prediction history
- recommendation history

LLM context should contain only the minimum structured facts required for the current question.

Never dump the entire player database into the prompt.

The deterministic fallback must never claim specific live facts that were not returned by the current evidence layer.

---

# Performance budget

Targets:

- PWA-like interaction feel on modern phone
- no full NFL dataset shipped to browser
- player search via server/query index
- virtualize long draft/player lists
- cache shared intelligence aggressively
- compute league-specific scores server-side/materialized
- optimistic UI for notes/watchlist/preferences
- lazy-load charts and deep evidence

Initial browser JS target should stay disciplined; interactive richness should come from focused client islands rather than converting every page into one giant client component.

---

# Agent execution order

## Agent C / Platform first

1. migration `0002_workspace_learning.sql`
2. workspace/member/league-membership RLS
3. auth + invitation flow
4. manual league/roster persistence
5. prediction/decision/outcome ledger
6. Supabase Cron foundation

## Agent B / Intelligence concurrently

1. fix Sleeper roster/available-pool semantics
2. replace nflverse transport with release-asset ingestion
3. separate actual vs projected data
4. replacement-level calculation from real league structure
5. projection baseline and confidence intervals
6. weekly feature materialization
7. outcome reconciliation/calibration metrics

## Agent A / Product concurrently

1. workspace/user/roster switcher
2. setup wizard
3. detailed scoring editor
4. roster slot editor
5. manual player roster entry
6. verification screen
7. interactive evidence/trend panels
8. decision `Why?` drawer

## Merge gate additions

A change is not complete unless:

- two authenticated users can access one workspace under RLS
- each user's roster mapping is explicit
- recommendations cannot cross user/team context
- actual stats are never mislabeled projections
- available-player pool excludes rostered players
- every prediction has immutable pre-outcome timestamp/version
- outcome scoring cannot see future information
- engine update is versioned and backtested
- live-fact fallbacks do not fabricate stats/news

---

# Definition of the expert system we are building

We cannot make the software a literal human-certified fantasy expert. We can make it meet a stronger engineering standard: **it records every prediction, knows exactly what evidence was available when the prediction was made, measures its own accuracy, learns bounded corrections over the season, and can explain every recommendation in football terms.**

That is the standard local agents should build toward.

## External references

- Sleeper API: https://docs.sleeper.com/
- nflverse organization/data: https://github.com/nflverse and https://github.com/nflverse/nflverse-data/releases
- Yahoo Fantasy Sports API: https://sports.yahoo.com/developer/docs/
- FantasyPros ECR methodology: https://support.fantasypros.com/hc/en-us/articles/115001219327-What-is-ECR-Expert-Consensus-Rankings-and-how-do-you-calculate-it
- FantasyPros accuracy methodology: https://www.fantasypros.com/about/faq/football-draft-accuracy-methodology/
- Supabase Cron: https://supabase.com/docs/guides/cron
- Supabase scheduled Edge Functions: https://supabase.com/docs/guides/functions/schedule-functions
- Vercel Cron limits: https://vercel.com/docs/cron-jobs/usage-and-pricing
