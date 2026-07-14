Type: grilling
Status: resolved
Blocked by: 01, 07, 16

# Design the provider normalization and synchronization contract

## Question

What provider-independent game model and synchronization contract should isolate TheSportsDB while preserving authoritative identity, schedule changes, monotonic and non-monotonic status updates, safe deduplication, application-confirmed finality, score corrections, freshness indicators, and triggers for downstream locking and scoring?

## Comments

- An **NFL Game** has an immutable internal identity that may retain multiple TheSportsDB event IDs. A replacement provider record is automatically reconciled only when season, teams, and schedule history identify exactly one existing NFL Game; ambiguous matches remain a provider exception for operator review and cannot independently trigger locks or scoring.
- Synchronization retains each distinct normalized provider observation needed to reconstruct identity, schedule, status, and score history, while discarding raw response payloads. A versioned current NFL Game projection is derived from those observations; exact repeat observations are deduplicated without losing their observation times when those times contribute to final-result confirmation.
- A newer observation may revise the projected NFL Game view even when its status appears to move backward, but no provider transition can reopen a reached Pick Lock. Once a Verified Result exists, differing status or score data becomes a correction candidate and must independently satisfy the selected repeated-confirmation policy before producing a Corrected Result. An isolated contradiction records a provider exception without changing official competition.
- The normalized model keeps provider-independent NFL Game lifecycle separate from competitive result authority. Lifecycle distinguishes scheduled, in-progress, interrupted, postponed, canceled, terminal, and unknown conditions; result authority separately distinguishes no result, Projected Result, confirmation pending, Verified Result, and correction candidate. TheSportsDB's raw status code remains observation evidence rather than becoming the application's domain state.
- Each meaningful normalized NFL Game revision emits an idempotent semantic trigger keyed by internal game identity and revision. Kickoff changes request lock reconciliation; the first authoritative start signal requests locking; live and provisional-terminal changes refresh Projected Results; Verified Results and Corrected Results request deterministic scoring; disruption and provider-exception changes request their corresponding reconciliation. An identical poll updates freshness evidence only.
- Semantic triggers use at-least-once delivery with per-game revision ordering. Every consumer is idempotent, records the latest applied revision, safely ignores already-applied or stale work, and retries failures; unrelated NFL Games require no global ordering.
- One valid provider schedule observation is sufficient to revise an NFL Game's authoritative scheduled kickoff, with the prior value retained in observation history. The change moves only an unreached Pick Lock. If the revised kickoff is already past, locking occurs immediately and reconciliation retracts edits accepted at or after that authoritative instant; a reached Pick Lock never reopens.
- Freshness is tracked for both each synchronization surface and each NFL Game. Sync health records last attempt, last success, expected next refresh, and consecutive failures; game freshness records the last relevant observation. Context-aware fresh, late, stale, and provider-exception states are derived from the configured cadence. Participants receive a simple last-refresh time and warning, while Pool administrators and production operators may receive progressively deeper diagnostics without exposing raw provider data.
- Omission of a previously known NFL Game from any provider response is neither deletion nor cancellation. The game and its prior normalized facts remain intact while synchronization records a provider exception, retries targeted event and schedule lookups, and attempts conservative replacement-record reconciliation. Only an explicit supported provider state may establish cancellation.
- Provider ingestion validates and applies each NFL Game observation atomically. An observation with incoherent identity, teams, schedule, lifecycle, or score is quarantined and leaves that game's prior projection unchanged; valid games from the same provider response continue syncing. A game is never assembled from individually accepted fields belonging to incompatible observations.
- TheSportsDB `CANC` is a provisional cancellation on first observation and becomes authoritative only after matching observations satisfy the selected terminal-result confirmation window. The provisional state is visible and an unlocked pick may be changed voluntarily, but it does not itself invalidate picks or award a No-Contest Advance. Confirmed cancellation applies the settled cancellation policy according to whether the affected Pick Lock had been reached.
- Internal game identities, provider aliases, meaningful normalized revisions, and verification or correction evidence are retained for the lifetime of every dependent Pool. Repeated identical observations are compacted into sufficient first-seen, last-seen, count, and confirmation-time evidence. Request-attempt and error diagnostics may use a shorter operational retention window defined by the production trust standard.
- The entire provider pipeline runs in Convex. Scheduled Convex functions invoke server-side Convex actions that fetch TheSportsDB with the protected API key; those actions pass normalized observations to internal Convex mutations that validate and atomically update the database and enqueue semantic follow-up work. Clients query normalized Convex data only and never call, proxy, or receive raw provider API access. No separate synchronization service is part of the MVP.
- Authorized production operators may use audited internal Convex functions to link, unlink, or replace provider aliases and replay normalization, lock reconciliation, and scoring. This authority cannot enter or edit NFL facts, bypass result confirmation, reopen Pick Locks, or directly change Pool outcomes.
- Provider authority is field- and surface-specific: schedule synchronization owns season/week membership and scheduled kickoff; live synchronization supplies authoritative start signals and Projected Result inputs; targeted event/result lookups confirm terminal outcomes and investigate corrections or conflicts. Contradictory cross-surface observations are quarantined for targeted refetch and surfaced as a provider exception rather than resolved by arrival order alone.
- Convex server receipt time is the trusted observation clock used for ordering, freshness, and every 15/60-minute result-confirmation interval. Provider-supplied update timestamps remain diagnostic evidence only and can neither reorder observations nor manufacture elapsed confirmation time.
- Scheduled Convex work is coalesced by synchronization surface and scope so only one schedule, live, or correction run for that scope is active at a time; duplicate invocations exit safely. Targeted per-game lookups may run concurrently, but normalized mutations use observation times, field authority, and revisions so a late response cannot overwrite newer state.
- Authoritative schedule synchronization may automatically create a newly discovered NFL Game only within the configured NFL league and Pool Season, with known teams and no identity ambiguity. Existing frozen Pick Sheets, Pool Week attachments, and reached Pick Locks govern competitive inclusion; suspicious or late discoveries become provider exceptions instead of retroactively altering frozen competition.
- Competition references a stable provider-independent **NFL Team** identity. TheSportsDB team IDs are adapter aliases, while NFL Games, Survivor Picks, and used-team history store the internal identity; a provider swap, alias correction, rename, or abbreviation change cannot alter competitive history.

## Answer

### Convex-only provider boundary

- The complete synchronization pipeline runs inside Convex. Scheduled Convex functions invoke server-side actions that fetch TheSportsDB with a protected API key, and those actions submit normalized observations to internal mutations for atomic validation, persistence, and follow-up scheduling.
- Clients read normalized Convex data only. They never call TheSportsDB, receive the provider key, proxy raw endpoints, or depend on provider response shapes. The MVP has no separate synchronization service.
- Pool-domain functions consume only provider-independent NFL Teams, NFL Games, lifecycle state, result authority, freshness, and semantic revisions. The adapter alone understands TheSportsDB IDs, status codes, endpoints, and payloads.

### Stable identity and normalized evidence

- An **NFL Team** has a stable internal identity. TheSportsDB team IDs are aliases; picks, used-team history, and NFL Games never use provider IDs or mutable display names as competitive identity.
- An **NFL Game** has one immutable internal identity and may accumulate multiple TheSportsDB event-ID aliases through postponement, rescheduling, or provider record replacement.
- A replacement event auto-reconciles only when Pool Season, home and away NFL Teams, and schedule history identify exactly one existing NFL Game. Ambiguity creates a provider exception and cannot independently affect locks or scoring.
- Authoritative season-schedule synchronization may create a new NFL Game automatically only for the configured NFL league and Pool Season, with known teams and no identity ambiguity. Frozen Pick Sheets, fixed Pool Week attachments, and reached Pick Locks still govern competitive inclusion.
- Convex retains distinct normalized observations sufficient to reconstruct identity, schedule, lifecycle, score, verification, and correction history. Raw provider payloads are discarded. Repeated identical facts may be compacted into first-seen, last-seen, count, and confirmation-time evidence.
- Every observation is stamped with Convex server receipt time. That is the trusted clock for ordering, freshness, and the 15/60-minute confirmation policy; provider update timestamps remain diagnostic evidence only.

### Atomic ingestion and source authority

- Each NFL Game observation validates and applies atomically. Incoherent identity, teams, schedule, lifecycle, or scores quarantine that observation and leave the prior projection intact, while unrelated valid games from the same response continue syncing.
- Schedule synchronization owns season/week membership and scheduled kickoff. Live synchronization supplies authoritative start signals and inputs to Projected Results. Targeted event/result lookups confirm terminal outcomes and investigate corrections, missing records, and endpoint conflicts.
- Cross-surface contradictions trigger targeted refetching and a provider exception; arrival order alone never decides which conflicting fact wins.
- Omission from a response is neither deletion nor cancellation. The prior game remains intact while Convex retries targeted and schedule lookups and searches for a conservative replacement-record match. Only explicit supported evidence may establish cancellation.
- Scheduled work is coalesced by synchronization surface and scope so duplicate schedule, live, or correction invocations exit safely. Targeted per-game lookups may overlap, but observation-time, field-authority, and revision guards prevent late responses from overwriting newer state.

### Lifecycle and result authority

- The normalized NFL Game lifecycle is independent of competitive result authority. Lifecycle distinguishes scheduled, in-progress, interrupted, postponed, canceled, terminal, and unknown conditions. Result authority separately distinguishes no result, Projected Result, confirmation pending, Verified Result, and correction candidate.
- Provider lifecycle may move backward or contradict an earlier observation. Before verification, the newest valid authoritative observation may revise projections; it can never reopen a reached Pick Lock.
- The first TheSportsDB `FT` or `AOT` observation remains provisional. The same terminal status and score must be observed at least twice, at least 15 minutes apart, with the later observation at least 60 minutes after the first terminal observation before creating a Verified Result.
- The first `CANC` observation is likewise provisional. It may warn participants, and an unlocked pick may be changed voluntarily, but cancellation rules apply only after matching observations satisfy the same confirmation window.
- Once a Verified Result exists, differing status or score data is a correction candidate. It must independently satisfy the repeated-confirmation policy before creating a Corrected Result and triggering deterministic replay. An isolated contradiction records a provider exception without changing official competition.
- Unknown, malformed, missing, or irreconcilable states fail closed: affected competition remains Pending against the last official state rather than guessing.

### Schedule changes and lock reconciliation

- One valid authoritative schedule observation is sufficient to revise the scheduled kickoff, with every prior value preserved in normalized history.
- A revised kickoff moves only an unreached Pick Lock. If the new instant is already past, Convex locks immediately and reconciliation retracts edits accepted at or after that instant. No later schedule or lifecycle change reopens a reached lock.
- A postponed state changes the projected lifecycle, but a Game Kickoff Lock waits only when the authoritative kickoff is actually withdrawn without a replacement, consistent with the settled disruption policy.
- A rescheduled or replacement record remains the same NFL Game. Frozen Confidence Pick Sheets and locked Survivor Picks retain their original Pool Week attachment, and the game cannot be counted again in a later Pool Week.

### Semantic revisions and downstream guarantees

- Every meaningful normalized change creates a versioned NFL Game revision and an idempotent semantic trigger keyed by game and revision. Identical observations update freshness evidence without relocking or rescoring.
- Kickoff changes request lock reconciliation; the first authoritative start signal requests locking; live and provisional-terminal changes refresh Projected Results; Verified Results and Corrected Results request deterministic scoring; disruption and provider exceptions request their corresponding reconciliation.
- Trigger delivery is at least once. Consumers apply a game's revisions in order, record the latest applied revision, retry failures, and ignore already-applied or stale work. Unrelated games require no global ordering.
- Projection persistence and follow-up scheduling share the internal mutation boundary so a committed semantic revision cannot be silently separated from the work it requires.

### Freshness, retention, and recovery authority

- Each synchronization surface records last attempt, last success, expected next refresh, and consecutive failures. Each NFL Game records its last relevant observation. The configured cadence derives context-aware fresh, late, stale, or provider-exception states.
- Participants see a simple last-successful-refresh time and relevant stale or exception warning. Pool administrators and production operators may receive progressively deeper diagnostics without access to raw provider responses.
- NFL Team and NFL Game identities, aliases, meaningful revisions, and verification/correction evidence remain for the lifetime of every dependent Pool. Short-lived request and error diagnostics may expire under the production trust standard.
- Authorized production operators may use audited internal Convex functions to link, unlink, or replace provider aliases and replay normalization, lock reconciliation, and scoring. They cannot enter NFL facts, force verification, reopen locks, or directly change Pool outcomes.
- Exact Convex job topology, polling cadence, retry windows, operational diagnostic retention, and request/cost budgets are intentionally delegated to the newly surfaced scheduling research and decision tickets.
