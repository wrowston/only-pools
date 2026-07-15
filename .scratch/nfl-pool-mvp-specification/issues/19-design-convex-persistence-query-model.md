Type: grilling
Status: resolved
Blocked by: 09

# Design the Convex persistence and query model

## Question

What exact Convex tables, document shapes, stable identities, references, indexes, uniqueness strategies, aggregate and revision boundaries, retention relationships, and authorization-aware focused query surfaces should persist the settled Pool, membership, pick, NFL Game, scoring, audit, and operational contracts without broad reads or conflicting sources of truth?

## Answer

### Aggregate and revision boundaries

- Authoritative competitive inputs and rebuildable projections never share a write model. Picks, frozen Pick Sheets, Pool Rulesets, membership history, and Verified or Corrected Results are authoritative. Weekly Standings, Season Standings, Possible Remaining Points, Survivor eligibility and week outcomes, used-team history, and winner designations are rebuildable projections that publish only with a Scoring Revision (or, for live awareness, as clearly labeled Projected Results derived from current NFL Game state).
- Each Pool Week’s official publish is bounded by an immutable Scoring Revision. Current Weekly Standing rows and related standing-adjacent projections for that week move atomically with that revision; the Pool Week document points at the current revision. Season Standing rows advance only when a fully resolved week’s scoring succeeds, per the settled scoring contract.
- Immediate versus lazy persistence of untouched Confidence Pick Sets remains an implementation choice so long as behavior matches the settled pick-submission rules: every eligible participant has the same authoritative initial set when the Pick Window opens.

### Closed table inventory

- **Identity:** `participants`
- **Pool:** `pools`, `poolMemberships`, `poolInvites`, `returningParticipantInvites`, `poolAuditEvents`, `poolTemplates` (non-competitive prefills only)
- **Week and picks:** `poolWeeks`, `pickSheets`, `survivorPicks`, `confidencePickSets`
- **Scoring:** `scoringRevisions`, `weeklyStandings`, `seasonStandings`
- **NFL:** `nflTeams`, `nflGames`, `nflGameObservations` (compacted evidence; no raw payloads)
- **Ops:** `operatorIncidents`, durable sync claim/orchestration documents required by the schedule ticket, and abuse-report documents for support intake
- No generic events dump, uniqueness-ledger table, raw provider payload store, separate authoritative used-team table, or broad “all picks” collection is part of the MVP.

### Document shapes and identities

- **Participants** hold the Clerk-linked identity, verification flags, suspension state, and Pool-facing profile fields. **Pool Memberships** are one document per `(poolId, participantId)` for role and join/leave/removal state. Former Participant anonymization clears profile and contact fields on the participant document while preserving the stable id on memberships, picks, standings, and audit attribution.
- **Pools** hold type, Pool Season, Start Week, Pool Ruleset (including Pick Lock mode and freeze markers), archival overlay, and completion pointers. They do not embed member arrays, pick history, or standings.
- **Pool Weeks** are one document per `(poolId, week)` for Pickable/Pending lifecycle flags and the current Scoring Revision pointer. **Pick Sheets** are separate frozen Confidence documents (ordered NFL Game domain ids and Default Confidence Ranking metadata) created when that week’s Pick Window opens. Survivor weeks still have Pool Week documents without a Pick Sheet.
- **Survivor Picks** and **Confidence Pick Sets** are one document per `(poolId, participantId, week)`. A Confidence Pick Set embeds every Required Confidence Game’s prediction, confidence value, lock/origin markers, and the Weekly Tiebreaker Prediction.
- **Scoring Revisions** are immutable. **Weekly Standings** are one current row per `(poolId, week, participantId)`. **Season Standings** are one current row per `(poolId, participantId)`. Official Possible Remaining Points and Survivor week eligibility/outcome live on or beside Weekly Standing rows and publish with the Scoring Revision. Used-team history is a small per-participant projection updated with that revision, not an authoritative input table.
- **NFL Teams** and **NFL Games** hold stable application identities and the current projection. **NFL Game Observations** retain compacted confirmation and correction evidence. Live Projected Results are read from the current NFL Game projection and never alter official standings.
- **Pool Invites** and **Returning Participant Invites** store only hashed credentials, expiry, status, and metadata — never the raw secret after creation. **Pool Audit Events** are append-only and sanitized for Pool-facing audiences. Operator Incidents and sync diagnostics stay in operational tables.

### References, indexes, and uniqueness

- NFL Teams and NFL Games use immutable domain-stable ids. Picks, Pick Sheets, and observations reference those ids so provider alias churn cannot rewrite competitive history.
- Pool-local documents reference each other by Convex `_id`, with denormalized `poolId`, `participantId`, and `week` fields for indexes and focused queries.
- Uniqueness is enforced by index-guarded mutations on natural compound keys: one membership per `(poolId, participantId)`; one pick doc and one weekly standing row per `(poolId, week, participantId)`; one season standing row per `(poolId, participantId)`; at most one active ordinary Pool Invite per Pool; stable NFL Team and NFL Game ids; current Scoring Revision via the Pool Week pointer. No uniqueness-ledger table is required for MVP.

### Authorization-aware query surfaces

- Clients use a closed catalog of focused queries. Each is deny-by-default, derives the caller from Clerk, checks current Pool Membership and role, and returns only permitted fields.
- The catalog covers dashboard memberships, pool summary, week games, my picks, visible locked picks, weekly standings, season standings, members (verified contact fields only for Pool Owner and Pool Admins), sanitized Pool audit, Owner readiness, and Production Operator incident/revision views.
- There are no general-purpose list or get-by-id surfaces for competitive documents. Hidden Picks and raw invite credentials never appear on unauthorized queries, logs, or analytics tables.

### Retention relationships

- Competitive and Pool-linked documents retain for the Pool’s lifetime, including while Archived: pools, memberships, picks, sheets, weeks, scoring revisions, standing rows, Pool audit events, and NFL identities or evidence required by dependent Pools.
- Former Participant anonymization removes profile and contact data but keeps the stable id on history.
- Operator Incidents, failed/retried/quarantined sync attempts, and Production Operator access records retain for one year. Successful no-change sync attempts retain for 30 days. Daily usage aggregates retain for 13 months.
- Raw provider payloads, raw invite secrets, and Hidden Pick contents are never retained in logs or analytics tables.
