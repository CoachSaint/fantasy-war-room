# Data Source Notes

## Sleeper
Use Sleeper for first-party league context: league settings, rosters, drafts, transactions, matchups, trending adds/drops and player IDs.

Important: the full NFL player map is large and is documented as an endpoint to call at most about once per day. Persist/cache it. Never fetch it for every page request or player lookup.

Recommended normalized inputs:
- league settings + roster positions
- roster ownership/starters/reserve
- transaction add/drop/trade events
- draft/pick state
- trending add/drop counts as one market signal, not a recommendation by itself

## nflverse
Use nflverse as the open analytical layer. Current nflreadpy exposes loaders for player stats, rosters/weekly rosters, schedules, snap counts, injuries, depth charts, Next Gen Stats, fantasy ID maps, fantasy rankings and opportunity data.

Implementation freedom: v0.1 keeps a TypeScript `NflverseAdapter` so the runtime mechanism can be chosen during build. The canonical output contract matters more than whether the fetcher is Python or TypeScript.

## News / web intelligence
Treat news as evidence, not truth-by-default. Capture:
- canonical source
- URL
- publication time
- observation time
- short factual summary
- player IDs
- confidence
- fingerprint

If two reputable sources conflict, retain both and lower derived confidence instead of silently choosing one.
