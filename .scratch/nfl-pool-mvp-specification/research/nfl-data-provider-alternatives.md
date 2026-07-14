# Real-time NFL data provider alternatives

Researched on 2026-07-13 against first-party product pages, API documentation, pricing, and terms.

## What the MVP actually needs

The product does not need player statistics, play-by-play, odds, injuries, projections, or betting data. Its minimum provider contract is:

- NFL teams and durable provider identifiers;
- regular-season schedules, weeks, kickoff instants, and schedule changes;
- live game state and scores;
- final score, winner, and tie state;
- a trustworthy distinction between provisional completion and a verified result, or an equivalent documented finalization process;
- cancellation, postponement, suspension, forfeit, and reschedule behavior;
- correction, replacement, and deleted-game signals with identifiers that support reconciliation; and
- commercial rights to ingest, normalize, cache, display, and retain the source data and independently derived Pool results and standings.

## Shortlist

### Sportradar NFL API — strongest documented technical alternative

Sportradar's NFL API has the closest public technical match to the current SportsDataIO-dependent design.

- Its NFL schedule feeds expose durable game GUIDs, weekly and season schedules, kickoff times, status, and scoring ([Weekly Schedule](https://developer.sportradar.com/football/reference/nfl-weekly-schedule)).
- Its documented lifecycle distinguishes `complete` from validated `closed`, and covers `cancelled`, `postponed`, `delayed`, `suspended`, flex scheduling, and time-to-be-determined states. The provider says NFL games normally move to `closed` about one hour after completion ([Game Status Workflow](https://developer.sportradar.com/football/docs/nfl-ig-game-status-workflow)).
- Its Daily Change Log identifies changes to schedules and results, and the live-game guidance explicitly calls out later game-summary corrections ([Daily Change Log](https://developer.sportradar.com/football/reference/nfl-daily-change-log), [Live Game Updates](https://developer.sportradar.com/football/docs/nfl-ig-live-game-retrieval)).
- Version 7 now retains deleted game IDs and exposes them in schedule feeds and the change log, which directly supports deterministic reconciliation ([Deleted Games](https://developer.sportradar.com/sportradar-updates/changelog/us-football-apis-deleted-games)).
- Endpoint-specific cache and polling guidance is public, and game endpoints update in real time ([Update Frequencies](https://developer.sportradar.com/football/docs/nfl-ig-update-frequencies)).

Production price, SLA, storage/display rights, attribution, and post-termination retention are not public enough to approve. Those still require a written sales proposal. Sportradar is the best challenger if the destination continues to require trustworthy live Sundays and provider-verified results.

### API-Sports American Football — leading self-serve budget candidate

API-Sports is dramatically easier to price and start.

- The NFL/NCAA API exposes teams, seasons, schedules, games, live scores, events, and standings. Team and competition IDs are documented as stable across seasons ([NFL API documentation](https://api-sports.io/documentation/nfl/v1)).
- Games update every 30 seconds and include not-started, quarter, halftime, overtime, finished, cancelled, and postponed states ([NFL API documentation](https://api-sports.io/documentation/nfl/v1)).
- Current public plans show 7,500 requests/day for 15.00 per month, 75,000 for 25.00, and 150,000 for 35.00, with higher custom quotas available; the checkout currency should be confirmed ([NFL pricing](https://api-sports.io/sports/nfl)).
- The terms permit building applications, websites, and fantasy products but prohibit direct data resale. They also allow immediate suspension following a rights-holder complaint and do not establish the app-specific retention rights this map requires ([Terms](https://api-sports.io/terms)).

The public contract has a material gap: `FT`/`AOT` means finished, but the docs do not expose a separate provider-verified closed state, a change log for corrected results, deleted/recreated game semantics, forfeit handling, or a production SLA. Before selection, API-Sports must confirm those points and the rights to store normalized schedules/results and retain derived Pool history. Without that confirmation, it cannot satisfy the current `Verified Result` model as written.

### MySportsFeeds — plausible middle-market candidate

MySportsFeeds publicly offers NFL schedules, scores, boxscores, standings, and play-by-play, with delivery levels from non-live through near-real-time or real-time ([Data Feeds](https://www.mysportsfeeds.com/data-feeds/), [Home](https://www.mysportsfeeds.com/)). Its CORE package includes schedules and scores. Commercial NFL CORE pricing starts at $39/month for non-live access, while near-real-time pricing requires a quote; subscriptions include the two most recent seasons by default ([Pricing](https://www.mysportsfeeds.com/feed-pricing/)).

This is potentially the best price/relationship middle ground, but the public material does not establish exact NFL latency, a provisional-versus-verified final state, correction and exceptional-game semantics, a production SLA, or the required storage/display/retention license. The provider says its accuracy combines crowd-sourcing and in-house review, which is a different trust posture from an official or operator-validated feed. It needs the same written contract checklist as SportsDataIO before it can be selected.

### Genius Sports — official, enterprise, likely excessive for this MVP

Genius Sports markets itself as the NFL's official sports data API partner and offers ultra-low-latency live and historical feeds for technology, media, fantasy, websites, and apps ([Official Sports Data API](https://www.geniussports.com/engage/official-sports-data-api/)). That gives it the strongest provenance in the shortlist.

Its public page does not disclose product-level NFL endpoint contracts, pricing, SLA, storage/display rights, or retention. It is therefore a sales-led enterprise candidate, not a self-serve MVP choice. It is worth contacting only if official provenance is mandatory or the lower-cost providers fail the trust contract.

### Stats Perform / Opta — enterprise alternative requiring direct qualification

Stats Perform supplies sports data to media, fantasy, gaming, teams, and leagues and documents American Football products, but its relevant commercial API detail and pricing are not publicly decision-complete ([Stats Perform developer knowledge base](https://developers.statsperform.com/), [American Football](https://www.statsperform.com/team-performance/american-football/)). Treat it as another enterprise sales route, behind Sportradar and Genius Sports for this narrow MVP.

### TheSportsDB — inexpensive fallback, not a production-trust match yet

TheSportsDB advertises two-minute NFL live scores, with a $295 lifetime Single Developer tier and $999 lifetime Small Business tier ([Pricing](https://www.thesportsdb.com/docs_pricing.php?billing=lifetime)). Its terms allow paid subscribers to build apps and services and to copy or modify API content, require attribution, and prohibit API resale ([Terms](https://www.thesportsdb.com/docs_terms_of_use.php)).

The public contract does not demonstrate a verified-final state, correction/change-log semantics, reschedule identity handling, forfeit coverage, or an SLA. Two-minute scores are fast enough for a social pool, but the missing trust semantics make this a fallback or secondary cross-check rather than the primary production source under the current destination.

## Not substitutes

- Odds APIs are not authoritative schedule/result providers and add data the MVP explicitly does not need.
- Unofficial ESPN endpoints, scraping, and community packages do not provide a durable commercial license or SLA.
- Historical projects such as nflfastR are valuable for analysis and test fixtures, not live production scoring.

## Recommendation

If the production-trust destination remains unchanged, compare written proposals from **SportsDataIO and Sportradar** first. Add **API-Sports** as the budget challenger and **MySportsFeeds** as the middle-market challenger, but require written answers on verified finality, corrections, exceptional states, SLA, and storage/display/retention rights before either advances.

Do not integrate five providers. Preserve the provider-normalization boundary, select one primary source, and consider a second source only for health checks or incident diagnosis after its license permits that use.
