Type: grilling
Status: resolved
Blocked by: 17

# Define the Convex synchronization schedule and cost controls

## Question

What exact Convex scheduled-function topology, phase-aware schedule and live polling cadence, terminal confirmation schedule, seven-day correction polling, pre-completion verification pass, coalescing scope, retry and backoff policy, manual resynchronization behavior, stale thresholds, operational diagnostic retention, and provider/Convex request and cost budgets should implement the settled normalization contract while remaining trustworthy on live NFL Sundays?

## Comments

- Production launches on Convex Starter, not Free or Professional. The app remains free to participants; the operator accepts metered overage beyond Starter's included resources so a hard Free-tier cap cannot interrupt production. Critical synchronization diagnostics remain application-owned, with explicit usage and upgrade thresholds to be settled below.
- One one-minute Convex cron invokes a short dispatcher mutation. The dispatcher transactionally claims due work and schedules internal fetch actions; it performs no provider I/O itself. Schedule, live, confirmation, correction, retry, and Production Operator requests all use the same durable work records, coalescing, and provider-wide budget. A skipped dispatcher invocation leaves work due for the next minute rather than breaking a scheduling chain.
- The authoritative full-season schedule sync runs immediately on season bootstrap and Production Operator resync; every 24 hours when the next kickoff is more than seven days away; every six hours from seven days through 24 hours before kickoff; every 30 minutes from 24 hours through two hours before kickoff; and every two minutes from two hours before kickoff until authoritative start is observed. An interrupted or postponed slate refreshes every 30 minutes. A successful observation recomputes the next due time from the new schedule, and a more urgent phase always supersedes a previously scheduled slower refresh.
- League-wide live polling starts 15 minutes before the next scheduled kickoff and runs every two minutes while any game is approaching kickoff, in progress, delayed, or suspended. A game with no authoritative start signal 30 minutes after scheduled kickoff also receives a targeted event lookup. League-wide polling stops once every game in that active window is terminal, postponed, or assigned targeted follow-up; it does not run across idle gaps between Thursday, Sunday, and Monday slates.
- The first valid terminal or cancellation observation creates a provisional candidate and transactionally schedules targeted lookups 15 and 60 minutes after that first observation. Verification requires matching status and score evidence through the 60-minute lookup under the settled confirmation rule. A contradiction replaces the provisional candidate and restarts its clock; a failed or missing lookup leaves the NFL Game Pending and enters the ordinary retry path. League-wide live polling need not continue merely to satisfy confirmation.
- Every Verified Result receives one targeted correction lookup at each 24-hour interval through seven days after verification. Before a Pool may become Completed, Convex performs a fresh targeted pass over every Verified Result contributing to its terminal outcome; a discrepancy enters the normal correction-confirmation process and delays completion. Proactive polling ends after seven days, but an older correction learned through later schedule, targeted, or Production Operator synchronization is still confirmed and applied without an age cutoff.
- Durable work coalesces by synchronization surface and scope: one schedule item per NFL season, one league-live item per active window, and one targeted item per NFL Game and purpose. Duplicate automatic, retry, and Production Operator requests merge into the existing item and may advance its due time without creating parallel work. Different targeted games may execute concurrently under the provider-wide budget. Each claim has a lease; an unfinished item whose lease expires returns to due status with its attempt history intact.
- Each provider fetch has a 15-second deadline. Network failures, timeouts, and 5xx responses retry after 30 seconds, one minute, two minutes, five minutes, and ten minutes with plus or minus 20 percent jitter; continued failure retries every 15 minutes during an active game window and hourly otherwise. A 429 opens a provider-wide 75-second quiet period followed by one probe, with repeated 429s entering the same exponential sequence. A 401 or 403 opens the provider circuit until Production Operator intervention. Malformed or contradictory observations are quarantined and receive targeted refetch work rather than repeated ingestion. A successful probe closes the applicable transient circuit and restores phase cadence.
- A Production Operator may request an audited priority synchronization for the season schedule, league live state, or a targeted NFL Game. The request requires a reason, merges with matching work, advances it to the earliest safe due time, and may use reserved provider capacity. It never bypasses authentication circuits, 429 quiet periods, validation, confirmation windows, coalescing, or safe dependency expansion. It cannot edit NFL facts, discard evidence, force verification, reopen a Pick Lock, or directly change a Pool outcome; any accepted revision triggers the ordinary reconciliation pipeline.
- Freshness is context-aware. Schedule synchronization is Late/Stale at 30/48 hours when the next kickoff is more than seven days away, 8/12 hours from seven days through 24 hours, 45/90 minutes from 24 through two hours, and 4/10 minutes within two hours. League-live synchronization is Late after four minutes and Stale after ten. Terminal confirmation is Late five minutes and Stale 15 minutes after its due time; a daily correction check is Late six hours and Stale 24 hours after due. A Provider Exception is immediate and distinct. Participants see relevant status and last-success time, while failure detail remains restricted to Production Operators.
- Operational retention is tiered. Successful no-change request attempts expire after 30 days. Failed, retried, rate-limited, malformed, and quarantined attempts remain for one year, as do Production Operator resync and access records. Daily aggregate request, latency, failure, and Convex-usage counters remain for 13 months. Meaningful normalized observations, verification evidence, revisions, and corrections remain for every dependent Pool's lifetime under the settled evidence policy. Raw provider payloads and secrets are never retained.
- A provider-wide rolling budget admits at most 60 requests per minute: 40 for routine schedule and live work, ten reserved for terminal confirmation, correction, and failure recovery, and ten reserved for Production Operator work. Routine work cannot consume either reserve; higher-priority work may borrow unused routine capacity. The operator is warned at 50,000 requests in a month. At 75,000, non-urgent correction checks and far-future schedule refreshes pause while kickoff, live, confirmation, recovery, and operator work continue. A 429 always overrides the budget and opens the settled quiet period. The Single Developer plan remains the fixed $90 annual provider cost; any tier change requires a new explicit decision.
- Convex Starter usage raises warnings at 50 percent of any included monthly resource, opens operator review at 75 percent, and becomes a capacity incident at 90 percent or when an overage is projected. Picks, Pick Locks, live synchronization, confirmation, scoring, and recovery are never throttled merely to avoid Convex charges; only non-production diagnostics or already-deferrable background work may be shed. Professional is reviewed when projected Starter overage reaches $25 per developer for two consecutive months, or earlier if daily backups or log streaming become required. A projected Convex bill above $50 in a month requires explicit operator approval without automatically interrupting production correctness.

## Answer

### Production plan and orchestration topology

- Production launches on Convex Starter. Participants pay nothing; the operator accepts metered overage so a Free-tier hard cap cannot interrupt the service. Professional remains an explicit upgrade when its observability, backup, or economic case is met.
- One one-minute cron invokes a short dispatcher mutation. It performs no provider I/O. The mutation transactionally claims due work and schedules internal fetch actions, so a skipped invocation merely leaves work due for the next minute.
- Schedule, live, confirmation, correction, retry, and Production Operator requests share durable work records and one provider-wide admission budget.

### Phase-aware schedule and live synchronization

- The full-season schedule sync runs immediately at season bootstrap and operator resync; every 24 hours when the next kickoff is more than seven days away; every six hours from seven days through 24 hours; every 30 minutes from 24 hours through two hours; and every two minutes from two hours before kickoff until authoritative start. Interrupted or postponed slates refresh every 30 minutes.
- A successful schedule observation recomputes the next due time from current authoritative facts. Entry into a more urgent phase supersedes any slower pending refresh.
- League-wide live polling begins 15 minutes before the next scheduled kickoff and runs every two minutes while a game is approaching kickoff, in progress, delayed, or suspended. A game lacking an authoritative start signal 30 minutes after scheduled kickoff also receives a targeted lookup.
- League-wide polling stops once every game in that active window is terminal, postponed, or assigned targeted follow-up. It does not run across idle Thursday, Sunday, and Monday gaps.

### Terminal confirmation, corrections, and completion

- The first valid terminal or cancellation observation creates a provisional candidate and transactionally schedules targeted lookups 15 and 60 minutes later.
- Verification requires matching status and score evidence through the 60-minute lookup. A contradiction replaces the candidate and restarts its confirmation clock; a failed or missing lookup leaves the NFL Game Pending and enters retry.
- Every Verified Result receives a targeted correction lookup at each 24-hour interval through seven days after verification.
- Before a Pool may become Completed, Convex freshly checks every Verified Result contributing to its terminal outcome. A discrepancy enters ordinary correction confirmation and delays completion.
- Proactive polling ends after seven days, but an older correction discovered through later synchronization or operator action is still confirmed and applied without an age cutoff.

### Coalescing, claims, and retries

- Work coalesces by surface and scope: one schedule item per NFL season, one league-live item per active window, and one targeted item per NFL Game and purpose.
- Duplicate automatic, retry, and operator requests merge into the existing item and may advance its due time. Different targeted games may execute concurrently under the provider budget.
- Every claim has a lease. An unfinished item whose lease expires returns to due status with its attempt history intact.
- Each provider fetch has a 15-second deadline. Network failures, timeouts, and 5xx responses retry after 30 seconds, one minute, two minutes, five minutes, and ten minutes with plus or minus 20 percent jitter; continued failure retries every 15 minutes during an active window and hourly otherwise.
- A 429 creates a provider-wide 75-second quiet period followed by one probe; repeated 429s enter exponential backoff. A 401 or 403 opens the provider circuit until Production Operator intervention.
- Malformed or contradictory observations are quarantined and receive targeted refetch work rather than repeated ingestion. A successful transient probe closes its circuit and restores phase cadence.

### Production Operator resynchronization

- A Production Operator may request an audited priority synchronization for the season schedule, league live state, or a targeted NFL Game. The request requires a reason, merges with matching work, and advances it to the earliest safe due time.
- Operator work may use reserved provider capacity but never bypasses authentication circuits, 429 quiet periods, validation, confirmation windows, coalescing, or safe dependency expansion.
- Operator action cannot edit NFL facts, discard evidence, force verification, reopen a Pick Lock, or directly change a Pool outcome. Accepted revisions trigger ordinary lock and scoring reconciliation.

### Freshness and participant communication

- Schedule synchronization is Late/Stale at 30/48 hours when the next kickoff is more than seven days away, 8/12 hours from seven days through 24 hours, 45/90 minutes from 24 through two hours, and 4/10 minutes within two hours.
- League-live synchronization is Late after four minutes and Stale after ten. Terminal confirmation is Late five minutes and Stale 15 minutes after due; a daily correction check is Late six hours and Stale 24 hours after due.
- A Provider Exception is immediate and distinct. Participants see relevant status and last-success time; detailed failures remain restricted to Production Operators.
- If TheSportsDB fails near kickoff, existing authoritative times still enforce Pick Locks. Late and Stale status become visible while retry and operator recovery continue; no failure reopens locks or exposes partial scoring.

### Retention, request capacity, and cost control

- Successful no-change request attempts expire after 30 days. Failed, retried, rate-limited, malformed, quarantined, and operator records remain for one year. Daily aggregate request, latency, failure, and Convex-usage counters remain for 13 months.
- Meaningful normalized observations, verification evidence, revisions, and corrections remain for every dependent Pool's lifetime. Raw provider payloads and secrets are never retained.
- The provider admission ceiling is 60 requests per rolling minute: 40 for routine work, ten reserved for confirmation/correction/recovery, and ten reserved for operator work. Routine work cannot consume reserves; priority work may borrow unused routine capacity.
- The operator is warned at 50,000 provider requests per month. At 75,000, non-urgent correction checks and far-future schedule work pause, while kickoff, live, confirmation, recovery, and operator work continue. Any 429 still opens the quiet period. TheSportsDB remains the $90 annual Single Developer plan unless a later explicit decision changes it.
- Convex Starter warns at 50 percent of an included monthly resource, opens operator review at 75 percent, and becomes a capacity incident at 90 percent or projected overage. Production correctness is never throttled merely to avoid charges.
- Professional is reviewed when projected Starter overage reaches $25 per developer for two consecutive months, or earlier if daily backups or log streaming become required. A projected Convex bill above $50 in a month requires explicit operator approval without automatically interrupting production.
