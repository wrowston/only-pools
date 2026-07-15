Type: research
Status: resolved
Blocked by: 08

# Research Convex scheduling and provider constraints

## Question

What current production constraints in Convex and the selected TheSportsDB Single Developer plan bound the NFL synchronization design, including cron and scheduled-function semantics, action duration and retry behavior, transactional follow-up scheduling, concurrency, HTTP and environment-secret handling, function and database limits, observability, quotas and pricing, TheSportsDB's 100-request-per-minute capacity and two-minute live freshness, and any assumptions that require an explicit product or architecture decision?

## Answer

The [full research findings](../research/convex-scheduling-provider-constraints.md) establish that the Convex-only pipeline is feasible, but reliability must be built around transactionally recorded, coalesced work rather than assuming every cron action runs. A named cron never overlaps itself but may skip a run; scheduled mutations are exactly-once with internal retries, while external-fetch actions are at-most-once and need durable, explicitly scheduled retry logic.

TheSportsDB's Single Developer capacity is generous for an NFL-only workload: one league livescore call can cover the slate, the plan allows 100 requests per minute, and a continuous two-minute poll uses only 0.5 request per minute. Its advertised two-minute livescore is not a published freshness SLA, so the product must define its own late and stale thresholds and preserve request headroom for confirmation, corrections, recovery, and operator work.

Convex Free can accommodate the polling path on paper, but it has hard caps and lacks log streaming, exception reporting, daily backups, custom domains, and any service SLA. The next scheduling decision must choose the Convex plan, exact phase-aware cadence, retry and provider-wide rate budget, coalescing topology, operational retention, participant-facing freshness thresholds, and application-level recovery controls.
