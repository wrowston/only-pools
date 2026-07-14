Type: task
Status: resolved
Blocked by: 06

# Obtain SportsDataIO production proposals

## Question

What written production proposals will SportsDataIO offer for this free-to-participants private NFL pool app's minimal live teams, schedules, status, and score needs—including suitable Leagues API and Global Sports API options, price, SLA, call expectations, environments, storage and display rights, attribution, historical retention, termination terms, and permission to derive and retain Pool results and standings?

## Comments

### Proposal evidence required

Obtain a written proposal for each commercially viable option: (1) the smallest suitable NFL Leagues API package and (2) Global Sports API, if it covers this use case. An email from an authorized SportsDataIO representative is acceptable when it explicitly incorporates the controlling order form, service terms, and data license.

Each proposal must state:

- the product, feeds, and endpoints covering NFL teams, schedules and kickoff changes, game status, live scores, verified final scores, corrections, cancellations, forfeits, and stable/rescheduled identifiers;
- expected live latency, verified-result timing, correction handling, production SLA, support channel, incident communication, and remedies;
- price, currency, billing cadence, minimum term, renewal and price-increase terms, setup or overage fees, and every usage or audience assumption that changes price;
- call limits or unlimited-use meaning, throttles, recommended polling cadence, concurrency rules, caching expectations, and any fair-use constraints;
- development, replay, staging, and production environments or credentials, plus key-rotation and IP/domain restrictions;
- permission for server-side ingestion and storage of raw and normalized provider data, internal game identifiers and reschedule mappings, and operational/audit copies;
- permission to display schedules, team identity, status, and scores to authenticated participants in free private Pools;
- permission to compute, display, and retain independently derived Pool results, Survivor state, Confidence points, Weekly Standings, Season Standings, and audit history;
- required attribution, trademarks, links, branding, copyright notices, and restrictions on exposing or redistributing raw provider data;
- allowed historical retention during the agreement, the rights that survive termination, required deletion or export windows, and whether derived competitive history may remain visible afterward; and
- explicit confirmation that a free-to-participants private NFL pool web app with no wagering, buy-ins, prizes, public feed, or raw-data resale is an allowed use.

Ask SportsDataIO to identify any material contract term not covered above and to provide tiered pricing or the variables needed to quote if audience size or polling volume must be known first. Do not treat a sales call or an unsigned verbal assurance as resolution; attach the written proposals or correspondence here before resolving this ticket.

### Access confirmed

The project owner has a SportsDataIO Free Trial API key. This permits integration work against scrambled trial data but does not establish live production access, user-facing display rights, retention rights, an SLA, or a production price. The key itself must remain secret and must not be added to this ticket or the decision map.

### Sales outreach draft

**Subject:** Production proposal request — free private NFL pool web app

Hello SportsDataIO Sales,

I am evaluating production data access for a free-to-participants, authenticated private NFL pool web app. The app has no wagering, buy-ins, prizes, public data feed, or raw-data resale. SportsDataIO data would be ingested only by our backend and used to power private Survivor and Confidence Pools.

Our minimal needs are NFL teams, schedules and kickoff changes, game status, live scores, verified final scores, corrections, cancellations and forfeits, and stable/rescheduled game identifiers. Please provide written proposals for:

1. the smallest suitable NFL Leagues API package; and
2. Global Sports API, if it supports this use case.

For each option, please specify:

- price, billing cadence, minimum term, renewal terms, setup/overage fees, and the audience or usage assumptions that affect price;
- included feeds/endpoints, expected latency, verified-result timing, correction handling, SLA, support, rate limits, polling guidance, and available development/replay/staging credentials;
- whether we may ingest and store raw and normalized data server-side, display schedules/status/scores to authenticated participants, and retain provider identifiers and operational/audit copies;
- whether we may derive, display, and retain Pool results, Survivor state, Confidence points, weekly/season standings, and competitive audit history;
- required attribution or branding, restrictions on redistribution, historical retention rights, and deletion/retention requirements after termination; and
- explicit confirmation that this free private-pool use is licensed.

Please identify the controlling order form, service terms, and data-license terms, and call out any material restriction not covered above. If you need forecast audience size or polling volume before quoting, please send the relevant pricing bands or variables.

Thank you.

### Alternative-provider research

The [real-time NFL data provider alternatives](../research/nfl-data-provider-alternatives.md) research identifies Sportradar as the strongest documented technical challenger, API-Sports as the leading self-serve budget candidate, MySportsFeeds as a possible middle-market option, and Genius Sports or Stats Perform as enterprise sales paths. This does not resolve the ticket or reopen the locked SportsDataIO baseline by itself.

## Answer

SportsDataIO quoted production access at **$600 per year**. The project owner determined that this is too expensive for the free MVP, so no SportsDataIO production proposal can advance regardless of its remaining SLA, licensing, or retention terms. The Free Trial key remains suitable only for non-production integration exploration with scrambled data.
