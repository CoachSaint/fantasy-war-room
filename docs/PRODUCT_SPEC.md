# Product Spec — Fantasy War Room v0.1

## North-star promise
Open the app and know what to do with your fantasy team right now.

## Release surfaces
### Today
One screen summarizing the decision delta since the last successful Scout run:
- critical injuries / availability changes
- risers and fallers
- waiver opportunities
- lineup changes
- three highest-value actions
- `What changed since yesterday?`

### Draft
- scoring/roster configuration
- available-player board
- recommendation modes: Best Pick, Best Value, Safe Pick, Upside Swing
- positional scarcity + roster-fit context
- player-vs-player compare
- pick history

### Lineup
- projected points, floor, median, ceiling
- opponent/matchup context
- health/role volatility
- Start A over B recommendation
- confidence + compact rationale + evidence

### Waivers
- available players only
- roster-needs-aware ranking
- add/drop pairs
- FAAB suggestion as percentage band
- stash / urgency / ROS value
- 3-week outlook

### Players
- score + rank
- trend
- opportunity/usage
- health
- schedule/matchup
- evidence timeline
- recommendation context

### Ask Coach
Natural-language interface over structured tools. It must retrieve current league/team/player context before answering roster questions. It cannot invent a player status, ranking movement, or projection that does not exist in the decision payload/evidence set.

## Non-goals for v0.1
No social network, native app, paid subscriptions, ESPN/Yahoo write access, dynasty engine, or auto-submit roster moves.

## UX rules
- decisive content first; charts second
- mobile usable with one hand
- glass only for navigation/control surfaces, not every card
- typography and spacing carry hierarchy
- no purple AI gradient aesthetic
- avoid visible table grids unless data density truly requires them
- every decision has: action, confidence, reason, updated time

## Success criteria
A tester can import/configure a team and answer these in under 30 seconds each:
1. Who should I draft?
2. Who should I start?
3. Who should I add/drop?
4. What changed today?
5. Why is the app recommending that?
