Type: grilling
Status: resolved
Blocked by: 14

# Select the production NFL data provider

## Question

Which affordable production NFL data provider should the free MVP adopt, and what operator-funded budget, data coverage, finality and correction semantics, capacity, licensing, retention, SLA, and fallback assumptions must the specification enforce while preserving trustworthy live NFL Sundays?

## Comments

Use the [real-time NFL data provider alternatives](../research/nfl-data-provider-alternatives.md) research as the starting shortlist. SportsDataIO is excluded after its $600 annual quote was rejected. Compare the remaining candidates against the same written evidence checklist used for SportsDataIO rather than selecting on headline price alone.

### Cheapest-option research

The [cheapest workable production NFL provider](../research/cheapest-production-nfl-provider.md) comparison recommends **TheSportsDB Single Developer annual plan at $90/year**, subject to explicit acceptance of its best-effort contract: two-minute live scores, no SLA or provider-issued verified-closed state, and application-level result confirmation and correction polling. API-Sports costs more and expressly does not grant publication rights; nominally free feeds fail volume, licensing, proven-live, or exceptional-state requirements.

## Answer

### Selection and budget

- Adopt **TheSportsDB Single Developer annual plan** as the MVP's sole production NFL data provider at **$90 per year**, funded by the operator while participation remains free.
- Use TheSportsDB's NFL league (`4391`) for teams, regular-season schedules, kickoff times, live state, scores, terminal results, postponements, and cancellations.
- The selection is best-effort: the MVP accepts two-minute advertised NFL livescore freshness, no SLA, no guaranteed correction notification, and no automatic fallback provider.

### Capacity and access

- Keep the production API key server-side. Provider calls flow only through scheduled backend synchronization; clients consume normalized application data and never call or proxy the raw API.
- The plan's advertised 100-request-per-minute limit is comfortably above the MVP's expected single-league polling load. Polling cadence and cost controls remain for [Design the provider normalization and synchronization contract](./08-design-provider-normalization-sync-contract.md) and [Define the production trust and recovery standard](./11-define-production-trust-recovery-standard.md) to specify.

### Result trust and corrections

- The first `FT` or `AOT` observation is a **Projected Result**, not a Verified Result.
- A result becomes verified only after the same terminal status and score are observed at least twice, at least 15 minutes apart, with the later observation at least 60 minutes after the first terminal observation.
- Re-fetch each terminal game daily for seven days and once before Pool completion. A changed outcome becomes a Corrected Result and triggers deterministic replay under [Define disrupted and corrected game policy](./07-define-disrupted-corrected-game-policy.md).
- `CANC` and `PST` use the settled disruption policy. Unknown, missing, or contradictory states remain Pending with a stale/provider-exception indication; the app never guesses.

### Identity, licensing, and retention

- Preserve TheSportsDB event IDs as source references behind an internal game identity capable of reconciling schedule changes and replaced event records.
- Ingest and display only factual teams, schedules, statuses, and scores. Retain normalized facts and independently derived Pool history, attribute TheSportsDB, avoid provider artwork and NFL/team logos unless separately licensed, and prohibit resale or exposure of raw provider data.
- Reassess the provider before expanding beyond the private, free MVP or if live-season operation demonstrates unacceptable freshness, accuracy, capacity, or licensing risk.
