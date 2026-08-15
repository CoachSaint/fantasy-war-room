# Decision Engine

## Philosophy
No opaque "AI ranking." Scores are deterministic, versioned, and testable. AI may summarize the payload but does not set the numerical result.

## Canonical score
All outward-facing 0–100 scores are clamped and rounded. Preserve raw feature values for debugging.

## Draft score v1
```text
28% projection/value over replacement
18% opportunity/role
15% market value (ADP discount)
12% roster fit
10% positional scarcity
10% upside
 7% schedule/bye fit
- injury/role uncertainty penalties
```

## Start score v1
```text
34% expected fantasy points
20% opportunity
14% matchup/game environment
12% role trend
10% floor
10% ceiling
- health/usage volatility penalties
```

## Waiver score v1
```text
22% opportunity change
18% usage trend
16% rest-of-season value
14% roster need
12% next-three schedule
10% breakout/upside
 8% acquisition efficiency
```

Weights live in code and must be version tagged (`engineVersion`). Do not silently change weights.

## Confidence
Confidence is different from score. A player can have an 88 score with low confidence if role/injury information is contradictory.

Suggested v1 confidence inputs:
- data freshness
- number and quality of evidence items
- projection agreement
- role certainty
- injury certainty

## Required recommendation payload
- `kind`
- `subjectPlayerId`
- optional `alternativePlayerId`
- `score`
- `confidence`
- `headline`
- `reasonCodes[]`
- `evidenceIds[]`
- `computedAt`
- `freshUntil`
- `engineVersion`

## Guardrails
- stale critical injury evidence reduces confidence
- no recommendation can claim "out", "inactive", "starter", etc. unless represented in normalized evidence
- roster-specific recommendations require scoring settings + roster context
- absence of data must lower confidence, not be interpreted as positive evidence
