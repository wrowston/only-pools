# Convex scheduling and TheSportsDB production constraints

Research date: 2026-07-14

## Executive finding

The settled Convex-only synchronization boundary is feasible, but its reliability cannot come from a cron action alone. Convex cron jobs prevent overlap only within the same named cron and may skip a run when its prior execution is still active. A scheduled external-fetch action runs at most once and receives no automatic retry. The durable pattern is therefore a short recurring dispatcher plus transactionally recorded, coalesced work: a mutation commits the work identity and schedules an internal action; the action fetches TheSportsDB; an internal mutation atomically applies valid observations, records the attempt, and schedules any required follow-up or retry.

TheSportsDB's Single Developer plan is ample in raw request capacity for an NFL-only service. It advertises two-minute NFL livescores, 100 requests per minute, V2 header authentication, a league-wide livescore endpoint returning up to 100 events, and a full-league season endpoint returning up to 3,000 events. Those are product capabilities, not a published freshness or availability SLA. The synchronization policy must keep headroom, handle HTTP 429 responses, and define its own late/stale thresholds instead of treating two minutes as a delivery guarantee.

Convex's Free plan is technically capable of the expected polling volume, but it is a hard-cap plan and lacks long-term log streaming, exception reporting, daily backups, custom domains, and any service SLA. A production plan choice and a durable application-level operational record remain explicit decisions.

## Convex scheduling semantics

### Cron jobs are recurring triggers, not a durable backlog

- Convex supports interval jobs with seconds-level granularity and UTC cron expressions. At most one run of a particular named cron can execute at once; if it is still running, later runs may be skipped and the skip is logged. Distinct cron jobs are not mutually exclusive. [Convex cron jobs](https://docs.convex.dev/scheduling/cron-jobs)
- Pausing a deployment is not a safe synchronization-only kill switch: all new function calls fail, scheduled jobs queue until resume, and cron invocations are skipped. A production incident control therefore needs an application-level sync enable/disable or phase gate rather than relying on deployment pause. [Convex deployment pause behavior](https://docs.convex.dev/production/pause-deployment)
- On the Free/Starter S16 deployment class, Convex documents capacity for eight concurrent scheduled jobs, 64 Convex-runtime or HTTP actions, 64 Node actions, 16 queries, and 16 mutations. Those are platform ceilings, not an invitation to use all capacity; the provider pipeline still needs its own per-surface and global coalescing. [Convex limits](https://docs.convex.dev/production/state/limits)

### Mutation-owned scheduling gives the required handoff guarantee

- `runAfter` and `runAt` create durable scheduled functions stored in Convex. Scheduling from a mutation is atomic with that mutation: a committed mutation guarantees the function was scheduled, while a failed mutation schedules nothing. Scheduling from an action is not atomic; work it schedules can still run even if the action later times out or fails. [Convex scheduled functions](https://docs.convex.dev/scheduling/scheduled-functions)
- Scheduled mutations are guaranteed to execute exactly once and Convex retries internal platform errors. Scheduled actions are at-most-once and are not automatically retried because they can have external side effects. A retry must be explicitly driven by a mutation that checks durable state before scheduling another action. [Convex scheduled-function error handling](https://docs.convex.dev/scheduling/scheduled-functions#error-handling)
- Scheduled functions do not inherit the caller's authentication context. Provider synchronization should use internal functions and explicit trusted work identifiers, not depend on an end-user identity flowing through the scheduler. [Convex scheduled functions](https://docs.convex.dev/scheduling/scheduled-functions#auth)
- Each scheduled execution has a system-table record, but completed results remain available for only seven days. Pending work can be inspected and canceled in the dashboard. Application-owned attempt, lease, revision, and outcome records are required for the longer operational history contemplated by the map. [Convex scheduled-function status](https://docs.convex.dev/scheduling/scheduled-functions#retrieving-scheduled-function-status)

### Actions define the external-call failure boundary

- Only actions may call an external HTTP API. Queries and mutations cannot fetch TheSportsDB; actions cannot directly access the database and must call queries or mutations. [Convex function types](https://docs.convex.dev/functions/overview)
- Actions from one client can execute in parallel. Convex recommends capturing intent in a mutation and scheduling an internal action, which also gives the mutation a place to enforce deduplication. [Convex action ordering](https://docs.convex.dev/functions/actions)
- Actions time out after ten minutes, allow up to 1,000 concurrent I/O operations within one function, and have 64 MiB in the Convex runtime or 512 MiB in Node. They are not automatically retried. All promises must be awaited. A simple TheSportsDB `fetch` needs no Node runtime and avoids the larger Node allocation and cold start. [Convex actions](https://docs.convex.dev/functions/actions)
- HTTP actions are also not automatically retried and limit request and response bodies to 20 MB. They are unnecessary for outbound polling; ordinary internal actions can use `fetch`. [Convex HTTP actions](https://docs.convex.dev/functions/http-actions)

## Convex execution, database, and quota limits

### Per-execution boundaries

- Query and mutation user code has a one-second execution limit. A transaction may read 16 MiB, write 16 MiB, scan 32,000 documents, read 4,096 index ranges, write 16,000 documents, and return 16 MiB. A single function may schedule up to 1,000 functions; the current limits page lists a 4 MiB per-scheduled-function argument cap, 16 MiB total scheduled arguments per mutation, and one million outstanding scheduled functions. [Convex limits](https://docs.convex.dev/production/state/limits)
- Documents are capped at 1 MiB, 1,024 fields, 16 levels of nesting, and 8,192 array elements. Tables allow 32 indexes with 16 fields per index. These limits do not threaten a single NFL season feed, but they rule out treating one unbounded mutation as a whole-service reconciliation or storing raw provider payload history in one document. [Convex limits](https://docs.convex.dev/production/state/limits)
- The scheduled-functions guide currently says one function can schedule 1,000 functions with 8 MB of total arguments, while the central limits page says 16 MiB total. The design should stay well below the lower published value and pass identifiers rather than payloads. [Scheduled-functions guide](https://docs.convex.dev/scheduling/scheduled-functions), [central limits](https://docs.convex.dev/production/state/limits)

### Free-tier and paid-plan consequences

- Free includes hard monthly totals of one million function calls, 20 GB-hours of action compute, 0.5 GB database storage, 1 GB database I/O, 1 GB file storage, and 1 GB egress. Explicit calls, scheduled executions, subscription updates, and file accesses all count as function calls. Starter keeps the same included amounts and bills overage; Professional includes 25 million calls and 250 GB-hours of action compute. [Convex limits](https://docs.convex.dev/production/state/limits), [Convex pricing](https://www.convex.dev/pricing)
- A continuous two-minute dispatcher produces 21,600 scheduled executions in a 30-day month. If every run performs one action and one applying mutation, the polling path alone is about 43,200 function calls before retries, targeted lookups, scoring triggers, client calls, and subscription updates. This is comfortably below one million, but the total app—not just polling—shares the team-level quota.
- Convex warns that sustained Free-plan overage may cause function calls to return HTTP errors. Starter and Professional continue serving and apply metered charges. Resource usage is summed across all projects in a Convex team. [Convex pricing FAQ](https://www.convex.dev/pricing/faq)
- Free/Starter include crons, the Health and Insights dashboard, and recent logs. They do not include log streaming, exception reporting, daily backups, or custom domains; those begin with Professional at $25 per developer per month. Convex documents a service SLA only for Business/Enterprise, not Free, Starter, or Professional. [Convex pricing](https://www.convex.dev/pricing), [Convex limits](https://docs.convex.dev/production/state/limits)

### Secrets and environment configuration

- Convex environment variables are set per deployment, can hold the TheSportsDB key, and can be read through declared typed configuration or `process.env`. Development and production values are separate and must each be provisioned. [Convex environment variables](https://docs.convex.dev/production/environment-variables)
- Two current official pages disagree on environment-variable count and name limits: the dedicated guide says 512 variables, 512 KiB total, names up to 256 characters, and values up to 8 KiB; the central limits page says 1,000 variables, names up to 40 characters, and values up to 8 KiB. This service needs only a few short names, so the discrepancy is not blocking; use the stricter overlapping limits and verify the dashboard at implementation time. [Environment-variable guide](https://docs.convex.dev/production/environment-variables), [central limits](https://docs.convex.dev/production/state/limits)

## Observability constraints

- The Convex Health dashboard exposes one-hour failure and cache-hit charts, scheduler lag in minutes, deployment state, and insights for excessive reads and write conflicts. The cron view shows current jobs and logged run results. [Convex Health dashboard](https://docs.convex.dev/dashboard/deployments/health), [Convex cron jobs](https://docs.convex.dev/scheduling/cron-jobs)
- Dashboard logs include request ID, function name, outcome, duration, log lines, and exceptions, but Convex describes them only as a short recent history. Long-term streams to Axiom, Datadog, PostHog, or a webhook require Professional. [Convex dashboard logs](https://docs.convex.dev/dashboard/deployments/logs), [Convex log streams](https://docs.convex.dev/production/integrations/log-streams)
- A Free/Starter production design cannot rely on Convex logs to satisfy the map's audit and diagnostic-retention requirements. It needs bounded application tables for sync attempts, provider response classification, rate limiting, retries, stale transitions, operator actions, and meaningful normalized revisions. Whether to pay for Professional observability remains a plan decision, not a substitute for product-domain audit records.

## TheSportsDB Single Developer constraints

### Plan, access, and authentication

- The annual Single Developer plan is advertised at $90 per year and includes two-minute livescores for NFL, full Premium JSON data, higher returned-data limits, and 100 requests per minute. The Small Business tier is the one that explicitly adds dedicated email support and a private API key; no published SLA is listed for Single Developer. [TheSportsDB annual pricing](https://www.thesportsdb.com/docs_pricing.php?billing=annual)
- Premium enables V2, which is the API version TheSportsDB says it will develop going forward. V2 sends the key in the `X-API-KEY` header and returns standard HTTP status codes. V1 embeds the key in the URL. The Convex adapter should therefore use V2 and keep the header key solely in the production deployment secret. [TheSportsDB documentation](https://www.thesportsdb.com/documentation)
- Paid use permits apps and services within the rate limit. Provider-supplied custom artwork requires source attribution; trademarked logos must remain unmodified, third-party content still requires legal permission, and API resale is prohibited. The settled normalized-facts boundary remains appropriate. [TheSportsDB terms](https://www.thesportsdb.com/docs_terms_of_use.php)

### Capacity and freshness

- Premium is limited to 100 requests per minute. Exceeding the limit returns HTTP 429 and the documentation instructs callers to wait another minute before trying again; it does not document a `Retry-After` guarantee. [TheSportsDB rate limits](https://www.thesportsdb.com/documentation#rate-limit)
- V2 provides one league-livescore call returning up to 100 current events, enough for an NFL slate, and one full-league-season schedule call returning up to 3,000 events. NFL synchronization need not fan out one request per game during ordinary polling. Targeted event calls remain useful for terminal confirmation, omissions, conflicts, and corrections. [TheSportsDB V2 endpoints](https://www.thesportsdb.com/documentation)
- At a continuous two-minute cadence, one endpoint consumes 0.5 requests per minute and 21,600 requests in 30 days. Even a phase-aware mix of schedule, league-live, and targeted confirmation work has substantial headroom under 100 per minute if all work shares a global limiter and retries do not stampede.
- “2 min livescore” is a plan feature, not a contractual maximum age or uptime promise in the published pricing and terms. Polling faster than two minutes cannot make the upstream feed fresher and should not be the normal policy. The app must expose its own last-success time and define late/stale thresholds that tolerate provider delay or outage.

## Decisions now made possible

The next decision can now specify these without more external research:

1. **Convex plan and production posture:** Free with hard-cap failure risk and application-owned diagnostics; Starter for pay-as-you-go continuity; or Professional for historical log streaming, exception reporting, and daily backups. None below Business has a published service SLA.
2. **Job topology:** one short dispatcher or a small fixed set of surface dispatchers, with durable per-scope work records and mutation-owned scheduling; never a long-lived cron action that assumes every interval runs.
3. **Phase-aware cadence:** season bootstrap and schedule refresh, pre-kickoff acceleration, one league-wide live poll no faster than the advertised two-minute feed cadence, targeted terminal confirmation at the settled 15/60-minute boundaries, and bounded seven-day correction polling.
4. **Retry and rate policy:** a single provider-wide token budget with reserved operator and confirmation headroom; explicit classification for 429, timeout, 5xx, malformed, and contradictory data; mutation-scheduled retries with jitter and durable attempt numbers; and coalescing that prevents cron, retry, and manual work from duplicating the same scope.
5. **Freshness and participant states:** exact fresh, late, stale, and provider-exception thresholds based on expected schedule plus last successful relevant observation, not on the mere fact that a cron fired.
6. **Observability and retention:** application-owned operational tables and alert thresholds that work on Free/Starter, plus an explicit choice on Professional log streaming and exception reporting. Convex's seven-day scheduled-function history and unspecified short log window are insufficient by themselves.
7. **Cost and capacity budgets:** monthly ceilings for function calls, action compute, database I/O, and provider requests with alerts well below hard limits. The estimate must include reactive subscription updates and downstream scoring, not only provider polls.
8. **Operational controls:** an application-level synchronization gate, forced coalesced resync, and rate-aware retry controls. Pausing the Convex deployment is an emergency whole-app action, not the normal provider recovery mechanism.

## Sources

- [Convex cron jobs](https://docs.convex.dev/scheduling/cron-jobs)
- [Convex scheduled functions](https://docs.convex.dev/scheduling/scheduled-functions)
- [Convex actions](https://docs.convex.dev/functions/actions)
- [Convex production limits](https://docs.convex.dev/production/state/limits)
- [Convex environment variables](https://docs.convex.dev/production/environment-variables)
- [Convex deployment pause behavior](https://docs.convex.dev/production/pause-deployment)
- [Convex Health dashboard](https://docs.convex.dev/dashboard/deployments/health)
- [Convex dashboard logs](https://docs.convex.dev/dashboard/deployments/logs)
- [Convex log streams](https://docs.convex.dev/production/integrations/log-streams)
- [Convex pricing](https://www.convex.dev/pricing) and [pricing FAQ](https://www.convex.dev/pricing/faq)
- [TheSportsDB annual pricing](https://www.thesportsdb.com/docs_pricing.php?billing=annual)
- [TheSportsDB API documentation](https://www.thesportsdb.com/documentation)
- [TheSportsDB terms](https://www.thesportsdb.com/docs_terms_of_use.php)
