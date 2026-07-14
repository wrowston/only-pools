# Cheapest workable production NFL data provider

Researched on 2026-07-14 against first-party pricing, API documentation, terms, and live API responses.

## Verdict

**TheSportsDB Single Developer annual plan is the cheapest credible option at $90 per year.** It is workable for this MVP only if the product accepts a best-effort provider contract: two-minute live-score freshness, no SLA, and an internal confirmation window that converts provider `FT`/`AOT` observations into a `Verified Result`.

No publicly priced provider below $90 per year documents every trust guarantee in the current map. Nominally free products either lack enough monthly calls, lack publication/storage terms, have not yet proven live NFL coverage, or omit the schedule-change, exceptional-state, and correction semantics the Pool requires.

## Why TheSportsDB is the lowest workable choice

### Cost and capacity

The [annual pricing page](https://www.thesportsdb.com/docs_pricing.php?billing=annual) lists:

- Single Developer: **$90/year**;
- two-minute livescores for NFL and the other major leagues;
- full premium JSON data;
- 100 requests per minute; and
- a production API key.

The monthly supporter option is €9/month, so the annual plan is cheaper for year-round operation. A single NFL league livescore request can return the active slate, so polling every two minutes across Thursday, Sunday, and Monday game windows is comfortably below 100 requests per minute.

### Required data surface

The [API guide](https://www.thesportsdb.com/docs_api_guide) exposes:

- full league season schedules;
- next and previous league events;
- current livescores by league;
- fixed team IDs and event IDs; and
- event lookup and result endpoints.

The [data dictionary](https://www.thesportsdb.com/docs_api_data) documents American-football states `NS`, `Q1`–`Q4`, `HT`, `OT`, `FT`, `AOT`, `CANC`, and `PST`. It supplies home/away scores, fixed team IDs, an event ID, the scheduled timestamp, progress, and an update timestamp. A direct [2025 NFL schedule response](https://www.thesportsdb.com/api/v1/json/123/eventsseason.php?id=4391&s=2025) confirms that the API returns event/team IDs, UTC-like timestamps, scores, postponement flags, and final status in the actual feed.

### Usage rights

The [terms](https://www.thesportsdb.com/docs_terms_of_use.php) say paid subscribers may use the API to develop apps and services, and may copy and modify content returned through official endpoints. They require source attribution for custom artwork, prohibit API resale, and place responsibility for third-party content rights on the subscriber.

The MVP should therefore ingest only factual teams, schedules, statuses, and scores; keep the key server-side; attribute TheSportsDB; avoid provider artwork and NFL/team logos unless separately licensed; never expose raw API access; and retain only normalized facts plus independently derived Pool history.

## Required adapter contract

TheSportsDB does not expose a SportsDataIO-style `IsClosed` or Sportradar-style validated `closed` state. It also publishes no correction change log or production SLA. Selection therefore requires these product constraints:

1. Treat live scores and the first `FT`/`AOT` observation as `Projected Result`, never immediately as `Verified Result`.
2. Create a `Verified Result` only when the same terminal status and score are observed at least twice, at least 15 minutes apart, with the later observation at least 60 minutes after the first terminal observation.
3. Re-fetch every terminal game daily for seven days and once more before Pool completion. A changed score becomes a `Corrected Result` and triggers deterministic replay.
4. Synchronize the season schedule regularly and preserve prior kickoff observations. A changed scheduled instant may move only an unreached Pick Lock; it never reopens a reached Pick Lock.
5. Handle documented `CANC` and `PST` states through the existing disrupted-game policy. Any unrecognized or missing exceptional state keeps the game Pending and exposes a stale/provider-exception message rather than guessing.
6. Store the source event ID but maintain an internal game identity so a removed or recreated provider event can be reconciled by season, week, teams, and schedule history.
7. Treat the feed as best effort: no provider SLA, no guaranteed correction notification, and no automatic fallback provider in the MVP.

These constraints preserve the domain distinction between `Projected Result`, `Verified Result`, and `Corrected Result`, but verification becomes an application policy based on repeated provider observations rather than a provider-issued closed flag.

## Cheaper or similarly priced candidates rejected

### Free tiers

- **MoneyLine Free** advertises commercial use, schedules, canonical IDs, and live/final scores, but includes only 1,000 credits per month and seven days of history. A two-minute NFL game-window poll exceeds that monthly allowance, while the production-sized Starter plan is $29/month ([product](https://www.moneylineapp.com/sports-data-api), [pricing](https://www.moneylineapp.com/pricing)). Its public docs also do not establish exceptional-game or correction semantics.
- **FieldFunded Free** includes 10,000 requests/month, fixtures, scores, and permanent final snapshots, but its public materials are betting/settlement-oriented and do not establish NFL schedule-change identity, verified finality, corrections, or app-specific publication and retention rights ([product and pricing](https://www.fieldfunded.com/)).
- **Big Balls Sports Data Free** advertises 1,000 calls/day and planned 15-second NFL live scores, but says live NFL coverage resumes for the 2026 season and that its underlying nflverse surface refreshes weekly. It lacks a proven live NFL season and the required public exceptional-state/correction contract today ([NFL API](https://bigballsdata.com/nfl-api)).

### API-Sports

API-Sports is technically stronger and its NFL Pro tier is only 15.00 per month: 7,500 requests/day, 30-second game updates, stable team/competition IDs, and `FT`, `AOT`, `CANC`, and `PST` states ([NFL product](https://api-sports.io/sports/nfl), [NFL documentation](https://api-sports.io/documentation/nfl/v1)).

It is not the cheapest legally usable choice for this map because its [terms](https://api-sports.io/terms) explicitly say the service does not grant a license to use or publish the supplied sports data and that the customer must obtain required permissions from rights holders. It also provides data as-is without guaranteed frequency or SLA and has no distinct verified-closed state or correction log.

### Other established providers

MySportsFeeds starts at $39/month for non-live NFL data and requires a quote for near-real-time access. SportsDataIO quoted $600/year. Sportradar, Genius Sports, and Stats Perform remain sales-led enterprise options. None beats TheSportsDB's $90 annual price for this narrow use case.

## Selection gate

The project owner must explicitly accept the best-effort tradeoff before selection: TheSportsDB is the cheapest workable source, but the provider itself does not attest that a final result is verified and provides no SLA. If provider-issued final verification is non-negotiable, no option at this price has been found.
