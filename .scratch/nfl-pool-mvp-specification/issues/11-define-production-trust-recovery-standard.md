Type: grilling
Status: resolved
Blocked by: 08, 09, 10, 18

# Define the production trust and recovery standard

## Question

What measurable reliability, freshness, observability, failure-state communication, retry, operator intervention, audit retention, and recovery expectations must the production MVP meet during live NFL game windows and provider outages?

## Comments

- Live-window reliability is best-effort with visible degradation, not a participant-facing uptime or latency SLA. Trust comes from frozen Pick Locks, the last consistent official Scoring Revision, and honest failure communication — never from inventing results or extending locks.
- Operator-attention incidents are: Provider Exception; live or confirmation work Stale during an active game window; scoring delayed more than ten minutes after a Verified Result is available without a new Scoring Revision; quarantined or contradictory observations that block verification past the confirmation window; and Convex capacity incidents. Late alone remains automatic-only.
- Response objectives are relaxed single-operator standards: during an active game window, acknowledge within two hours and take a first recovery action within four hours; during quiet periods, both within two calendar days. There is no overnight pager, backup operator, or hard full-restoration deadline while TheSportsDB is unavailable.
- Observability uses in-product Operator Incidents as the source of truth and Sentry as the MVP exception and notification channel. No bespoke email pipeline, Datadog, or PagerDuty for MVP.
- Participant UI assumes shown scores are current when healthy. A single top banner appears only for Stale-during-active-window, Provider Exception, scoring delayed, or repair in progress. There is no scattered last-updated or “scores may be delayed” chrome. This supersedes the participant-facing last-success-time presentation in [Define the Convex synchronization schedule and cost controls](./18-define-convex-sync-schedule-cost-controls.md). Game lifecycle labels such as provisional, postponed, and correction notices remain as previously settled.
- No custom backup or restore regime at launch. Durability is Convex-platform-backed plus automatic recovery and audited resync or replay. Professional backups remain a later upgrade trigger, not a trust launch blocker.
- Operator Incidents open automatically, dedupe by surface and scope, progress through acknowledge and in progress, resolve when the condition clears (with an optional human resolution note) or auto-resolve as recovered automatically, and retain for one year with other Production Operator operational records.
- Trust commitments apply to production only. Preview and staging must not page the production operator channel or write into production Pools.
- Exactly one Production Operator allowlisted identity — the project owner — with step-up before recovery mutations and matching Sentry access. No in-app operator promotion UI.

## Answer

### Reliability commitment

- During live NFL windows the MVP is best-effort with visible degradation. It aims to keep settled synchronization cadences healthy under the Late and Stale thresholds from [Define the Convex synchronization schedule and cost controls](./18-define-convex-sync-schedule-cost-controls.md), but it makes no participant-facing uptime, freshness, or “scores within N minutes” promise.
- Trustworthy behavior means preserving authoritative Pick Locks from the last known schedule, holding the last consistent official Scoring Revision, continuing automatic retry, and communicating degradation honestly. It never invents NFL results, reopens locks, or exposes partial scoring.

### Operator-attention triggers

Automatic recovery continues under the settled retry policy. A Production Operator must give attention when any of the following opens an Operator Incident:

1. **Provider Exception**, including an authentication circuit open from 401/403 or other sustained provider failure that blocks synchronization.
2. **Live or confirmation work Stale** during an active game window. Late alone does not require human attention.
3. **Scoring delayed** — a Verified Result is available but the affected Pool Week has not published a new Scoring Revision within **ten minutes**.
4. **Quarantined or contradictory observations** that prevent verification past the confirmation window; the operator may investigate and request audited resync but still cannot force a result.
5. **Convex capacity incident** at the settled 90 percent or projected-overage threshold.

Pool Owners, Pool Admins, and participants never receive recovery controls — only status where applicable.

### Response objectives

| Window | Acknowledge | First recovery action |
| --- | --- | --- |
| Active game window (kickoff, live, or confirmation work due) | 2 hours | 4 hours |
| Quiet periods | within 2 calendar days | within 2 calendar days |

- Acknowledge means the Production Operator has recorded that they are working the incident.
- First recovery action means an audited resync, deterministic replay request, credential or configuration fix, or an explicit deferred-with-reason note — not necessarily full restoration.
- Full restoration has no hard deadline while TheSportsDB itself is unavailable. Pending weeks and the last official Scoring Revision remain correct until authoritative recovery succeeds.
- MVP assumes a single operator with no overnight pager and no required backup operator.

### Observability

- **Operator Incident** records are the product source of truth for operator attention, acknowledgment, recovery actions, and resolution.
- **Sentry** is the MVP observability and external alert channel: application and sync exceptions, Provider Exception and auth-circuit failures, scoring-pipeline failures, capacity-related errors, and notifications when Operator Incidents open or escalate.
- There is no separate bespoke email pipeline, Datadog, PagerDuty, or Slack requirement for MVP. Convex Professional log streaming remains an optional later upgrade trigger, not a trust prerequisite.
- Detailed attempt logs, fingerprints, and Scoring Revision lineage remain restricted to Production Operator views.

### Participant failure communication

- When synchronization and scoring are healthy, the UI assumes displayed live scores and standings are current. It does not decorate the board with last-updated timestamps or routine “may be delayed” labels.
- A single top-of-experience banner appears only for Stale-during-active-window, Provider Exception, scoring delayed, or repair in progress. Copy stays generic (for example, that some live scores or standings may be temporarily delayed).
- Late alone does not raise the banner. The banner clears when the underlying Operator Incident resolves.
- Outcome-changing correction notices remain until viewed, as previously settled. Game lifecycle states such as provisional, postponed, and canceled remain visible as competitive facts, not as sync chrome.
- Participants receive no email, push, or SMS for sync incidents in MVP. Pool roles see the same banner, not operator diagnostics.
- This participant-communication rule supersedes the earlier guidance that participants see last-success time for ordinary freshness status.

### Durability and platform recovery

- Authoritative competitive state lives in Convex. MVP durability is platform-backed availability plus the settled automatic recovery and Production Operator resync or replay paths.
- There is no custom backup, export, or participant-facing restore regime at launch. Daily Convex backups remain tied to the earlier Professional upgrade triggers and are not a launch trust requirement.
- After a platform outage, restore service and then rely on automatic recovery plus audited resync or replay to rebuild derived state. There is no promised participant-facing RTO or RPO number.

### Operator Incident lifecycle and retention

- Incidents open automatically from the triggers above and dedupe by surface and scope so one failing live window is one incident.
- Lifecycle: open → acknowledge → in progress → resolved. Auto-resolve is allowed when the system heals without human action, recorded as recovered automatically.
- If Late never reaches Stale, no incident opens. If Stale recovers before acknowledgment, auto-resolve is fine.
- Human resolution may include a short resolution note. Operator Incident records retain for one year with other Production Operator operational audit records.

### Production scope and operator identity

- Trust commitments, Operator Incidents, response objectives, and Sentry production paging apply to **production only**. Preview and staging may exercise synchronization for testing but must not create production Operator Incidents, page the production alert channel, or write into production Pools.
- Exactly one Production Operator exists for MVP: the project owner, granted by an explicit Clerk-identity allowlist (or equivalent server-side claim), never by Pool ownership.
- Viewing the incident list does not require step-up. Recovery mutations require step-up verification. Every acknowledge, resync, replay, and resolution note is audited to that identity.
- Allowlist changes are out-of-band for MVP. There is no in-app “promote to Production Operator” UI. Sentry access follows the same single operator.
