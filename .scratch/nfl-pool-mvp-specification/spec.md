Status: ready-for-agent
Label: ready-for-agent
Source map: [NFL Pool MVP Decision Map](./map.md)

# NFL Pool MVP — Implementation Spec

## Problem Statement

Friends want a free, private place to run Survivor and Confidence NFL pools together without spreadsheets, group chats, or paid commissioner tools. They need trustworthy locks and standings on live Sundays, simple invites, and clear honesty when scores or recovery are delayed — not billing, public leagues, or Phase 2 social features.

Operators need a production system whose product rules, domain language, architecture boundaries, game-day UX, and acceptance criteria are already decided so implementation can proceed without reopening settled fog.

## Solution

Ship a free web app where verified adults create private Survivor or Confidence Pools for the current NFL regular season, invite friends with a shareable Pool Invite, submit autosaved picks that lock server-authoritatively, and watch progressive Weekly and Season Standings update from Verified Results. A Convex-only TheSportsDB pipeline keeps schedule, live, confirmation, and correction work honest; a single Production Operator handles Season Bootstrap, Sync Gate, and audited recovery; participants see one quiet incident banner when something needs attention.

The MVP is done when the closed catalog of 52 trust-critical acceptance scenarios can be demonstrated on Production or a Production-parity path after the settled go-live sequence.

## User Stories

1. As a new adult, I want to sign up with verified email and phone and confirm I am 18+, so that only eligible people can join private Pools.
2. As a returning Participant, I want both email and phone re-verified on each new sign-in if either lapsed, so that contact and identity stay trustworthy without interrupting an already-valid session mid-use.
3. As a Participant, I want a clear My Pools home after sign-in, so that I can see every membership, next action, and create or join entry points in one place.
4. As a Pool Owner, I want Create Pool disabled until an Available Season exists, so that I never create a Pool against an incomplete schedule.
5. As a Pool Owner, I want to create an immediately Active Survivor Pool for the current Pool Season, so that competition can start without a separate activation step.
6. As a Pool Owner, I want to create an immediately Active Confidence Pool for the current Pool Season, so that friends can compete on weekly confidence points.
7. As a Pool Owner, I want Pool Type and Pool Season fixed at creation, so that competitive identity cannot be silently rewritten.
8. As a Pool Owner, I want to choose a valid Start Week whose first game has not kicked off, so that admission and picking start from a fair slate.
9. As a Pool Owner, I want to choose Game Kickoff Lock or Weekly Cutoff Lock before competition freezes, so that the Pool matches how my group wants locks to work.
10. As a Pool Owner, I want Start Week and outcome-affecting Pool Ruleset values editable until the first accepted competitive edit or Pick Lock, so that I can fix setup mistakes early but not after play has consequences.
11. As a Pool Owner, I want to create a Pool from a prior-season Pool Template, so that I can reuse name, type, rules, lock mode, and Start Week preference without copying history.
12. As a Pool Owner, I want Returning Participant Invites from a template, so that prior friends can opt in without automatic enrollment.
13. As a Pool Owner, I want one reusable ordinary Pool Invite link, so that I can share admission without binding it to a specific email or phone.
14. As a Pool Owner, I want to retrieve or rotate the Pool Invite credential after step-up verification, so that I can share or invalidate access safely.
15. As an invited person, I want opening the invite URL alone not to enroll me, so that I must consciously authenticate and accept.
16. As an invited person, I want to acknowledge Owner/Admin contact visibility before joining, so that I understand who can see my verified email and phone.
17. As an invited person, I want accept to create exactly one membership and be idempotent on repeat, so that double-taps do not create duplicate relationships.
18. As a Pool Owner, I want invite acceptance refused after the Start Week’s first scheduled kickoff, so that membership closes fairly and never reopens on reschedule.
19. As a Pool Member, I want to leave voluntarily before Start Week scoring completes, so that I can exit without rewriting competitive history.
20. As a Pool Owner or Pool Admin, I want to remove a Pool Member, so that I can manage disruptive membership while preserving attributed picks and standings.
21. As a removed Participant, I want ordinary invites not to reinstate me, so that only audited Owner reinstatement can restore Member access.
22. As a Pool Owner, I want exactly one Owner at all times with transfer requiring step-up and explicit Admin accept, so that administrative continuity is auditable.
23. As a sole Pool Owner, I want to be blocked from leaving or deleting my identity while I own the Pool, so that Ownership Recovery is not triggered casually.
24. As a Pool Admin, I want to manage ordinary invites and remove Members but not alter admin roles or operator sync, so that delegated authority stays limited.
25. As any current participant, I want sanitized Pool Audit Events for role, membership, invite, archive, and restore actions, so that administrative changes are transparent without leaking secrets.
26. As a Pool Owner, I want to archive a Pool into a reversible read-only overlay, so that it leaves normal My Pools without pausing locks, sync, or scoring.
27. As a Pool Owner, I want to restore an Archived Pool without undoing missed locks, so that archival never becomes a way to reopen opportunities.
28. As an Alive Survivor Participant, I want to pick one NFL team per included week, including Thursday games, so that I can compete under fixed single-elimination rules.
29. As a Survivor Participant, I want each team usable at most once, including provisional advance picks, so that one-use history stays fair.
30. As a Survivor Participant, I want changing an unlocked pick to release the old team and reserve the new one, so that reservations stay accurate.
31. As a Survivor Participant, I want advance Provisional Survivor Picks for future Pickable Weeks, so that I can plan ahead while earlier weeks are Pending.
32. As a Survivor Participant, I want elimination on verified loss, tie, or missing required pick with no strikes or revivals, so that outcomes are deterministic.
33. As a Survivor Participant, I want later provisional picks invalidated without consuming their teams when I am eliminated earlier, so that unused teams remain available only while I am Alive.
34. As a Survivor Participant, I want sole or joint winners declared only from Verified Results and settled weeks, so that provisional scores cannot crown winners.
35. As a Confidence Participant, I want a frozen Pick Sheet and Default Confidence Ranking when the week opens, so that every eligible person starts from the same authoritative set.
36. As a Confidence Participant, I want unique confidence values high-to-low by default with blank winner predictions, so that I can assign points deliberately.
37. As a Confidence Participant, I want autosave on every pick, reorder, and tiebreaker gesture without a Save button, so that I never wonder whether my choices stuck.
38. As a Confidence Participant, I want partial multi-edit responses that explain each accepted and rejected unit, so that lock races never silently drop work.
39. As a Confidence Participant, I want client and server uniqueness enforcement for confidence values, so that invalid assignments cannot score.
40. As a Confidence Participant, I want an Automatic Confidence Pick Set of home teams and default ranking if I never touch a week before first lock, so that untouched weeks still produce fair standings.
41. As a Confidence Participant, I want correct picks to earn their assigned value and incorrect or locked omissions to earn zero, so that scoring matches the rulebook.
42. As a Confidence Participant, I want a Weekly Tiebreaker Prediction on the last scheduled required game, so that weekly ties can resolve deterministically when usable.
43. As a Confidence Participant, I want progressive official Weekly Standings after each Verified Result and Season Standings only after fully resolved weeks, so that live projections never masquerade as official.
44. As a Participant, I want my unlocked choices Hidden from opponents, Owners, and Admins, so that privacy holds until Pick Lock.
45. As a Participant, I want locked picks to reveal authored, automatic, or omission provenance, so that everyone understands how a choice became official.
46. As a Participant under Game Kickoff Lock, I want each game to lock at authoritative kickoff or provider start with no grace period, so that client clocks cannot cheat.
47. As a Participant under Weekly Cutoff Lock, I want remaining Survivor and Confidence components including the tiebreaker to freeze at Sunday 1:00 p.m. Eastern, so that late Sunday games share one cutoff.
48. As a Participant, I want postponement never to reopen a reached Pick Lock, so that disruption cannot rewrite fairness.
49. As a Survivor Participant, I want pre-lock cancellation to let me replace a pick and post-lock cancellation to No-Contest Advance while consuming the team, so that canceled games have explicit outcomes.
50. As a Confidence Participant, I want post-freeze cancellation to keep the slot, score zero, and not renumber values, so that uniqueness and scoring stay stable.
51. As a Participant, I want only Verified Results (after TheSportsDB confirmation policy) to settle elimination, points, and completion, so that first FT/AOT projections cannot decide the Pool.
52. As a Participant, I want Corrected Results to replay downstream standings and possibly reopen Completed→Active, so that authoritative provider corrections stay honest.
53. As a Participant, I want the Week Board as my primary in-pool surface for picks, save/lock trust, and live/result state, so that game day stays one hierarchy.
54. As a Participant, I want Standings and Pool as secondary chips, not equal bottom tabs, so that navigation matches the settled shell.
55. As a desktop Participant (≥900px), I want the same hierarchy expanded with sidebar, framed game table, and context rail, so that wider screens deepen rather than reinvent the flow.
56. As a Confidence Participant on desktop, I want a top-5 weekly peek plus my row and a full standings link in the rail, so that I get context without Hidden Picks or operator chrome.
57. As a Survivor Participant on desktop, I want alive count and a short alive list with a full standings link, so that elimination state is glanceable.
58. As a keyboard or touch user, I want Board, Standings, and Pool completable with ≥44px targets, visible focus, and reduced-motion respect, so that game day remains accessible.
59. As a Participant, I want quiet inline SaveTrust and polite live regions only for save trust and the incident banner, so that live scores do not spam assistive tech.
60. As a Participant when sync is healthy, I want no last-updated chrome, so that the UI assumes scores are current.
61. As a Participant during Stale-in-window, Provider Exception, scoring delayed, or repair, I want one top StatusBanner, so that degradation is honest and singular.
62. As a Pool Owner, I want PoolPanel readiness for invites, roles, and rules summary, so that commissioner work lives beside the board rather than in a separate app.
63. As a Production Operator, I want audited Season Bootstrap to seed NFL Teams and schedule until the season is Available, so that Create Pool can open safely.
64. As a Production Operator, I want a Sync Gate default ON in Production and OFF in Dev, so that Preview cannot burn provider budget overnight.
65. As a Production Operator, I want Operator Incidents for Provider Exception, Stale-in-window, scoring delayed >10 minutes, quarantine past confirmation, and Convex capacity, so that attention has a product source of truth.
66. As a Production Operator, I want Sentry plus in-product incidents without a custom pager stack, so that MVP observability stays simple.
67. As a Production Operator, I want audited priority resync and deterministic replay that cannot invent NFL facts or reopen locks, so that recovery stays constrained.
68. As a Participant during repair, I want valid picking to continue against the last official Scoring Revision, so that maintenance never freezes the board.
69. As a Participant, I want to file a private Abuse Report without copying Hidden Picks or raw invites, so that support can review without automatic penalties.
70. As a Participant, I want no buy-in, prize, payout, or wagering surfaces, so that the free private service stays clearly non-monetary.
71. As a developer shipping releases, I want Convex schema/functions deployed before frontend that needs them, so that game-window cutovers are avoided.
72. As a developer, I want Preview and local wired only to Convex Dev with CI failing on Production secrets, so that environments stay isolated.
73. As a Production Operator, I want a go-live smoke (sign-in, My Pools, throwaway Pool, invite, unlocked pick, lock/scoring wiring) before real participants, so that first open is deliberate.

## Implementation Decisions

### Product and domain baseline

- The [NFL Pool Web App Architecture Brief](./brief.md) remains the locked baseline except where superseded: TheSportsDB is the sole MVP NFL feed; SportsDataIO is retired on cost.
- Domain vocabulary follows [CONTEXT.md](../../CONTEXT.md). Prefer glossary terms (Pool, Pool Season, Verified Result, Scoring Revision, Hidden Pick, Sync Gate, Production Operator, etc.) over avoided synonyms.
- Phase 2 features, billing/Stripe, public pools, push notifications, custom branding, manual result overrides, and advanced admin tooling remain out of scope.

### Stack and module boundaries

- Next.js App Router + TypeScript + Tailwind CSS + shadcn/ui for the web app; rebuild production components from the game-day prototype rather than promoting throwaway markup.
- Convex owns persistence, mutations, queries, scheduled dispatcher, provider fetch actions, scoring, and realtime updates. There is no separate sync service.
- Clerk owns authentication, sessions, and verified email/phone identity; Convex `participants` link to Clerk ids. Deny-by-default authz on every query/mutation; client-supplied roles are ignored.
- Sentry plus in-product Operator Incidents are the MVP observability pair. No Datadog/PagerDuty/custom email pipeline for MVP.

### Persistence and query model

- Separate authoritative inputs from rebuildable projections. Authoritative: picks, frozen Pick Sheets, Pool Rulesets, membership history, Verified/Corrected Results. Projections: Weekly/Season Standings, Possible Remaining Points, Survivor eligibility/outcomes, used-team history, winners — published with Scoring Revisions (or labeled Projected Results for live awareness).
- Closed table inventory: `participants`; `pools`, `poolMemberships`, `poolInvites`, `returningParticipantInvites`, `poolAuditEvents`, `poolTemplates`; `poolWeeks`, `pickSheets`, `survivorPicks`, `confidencePickSets`; `scoringRevisions`, `weeklyStandings`, `seasonStandings`; `nflTeams`, `nflGames`, `nflGameObservations`; `operatorIncidents`, durable sync claim/orchestration docs, abuse-report docs.
- Uniqueness via index-guarded mutations on natural compound keys. Invites store hashed credentials only after creation. Clients use a closed focused query catalog only — no general get-by-id for competitive documents.

### Provider normalization and sync

- TheSportsDB Single Developer ($90/year) is the sole feed: ~two-minute best-effort data, application-confirmed finality, correction polling, normalized-fact licensing limits, no fallback provider.
- Adapter alone understands provider IDs/status codes/payloads. Stable NFL Team and NFL Game identities are provider-independent; clients never call TheSportsDB.
- Lifecycle (scheduled/in-progress/interrupted/postponed/canceled/terminal/unknown) is separate from result authority (none/Projected/confirmation pending/Verified/correction candidate).
- First `FT`/`AOT`/`CANC` is provisional; matching status+score through 15- and 60-minute lookups verifies. Corrections independently re-confirm. Convex server receipt time is the trusted clock.
- Meaningful normalized revisions emit idempotent semantic triggers (lock reconciliation, Projected Results, scoring, disruption/exception). Consumers are at-least-once and revision-ordered per game.

### Sync schedule and cost controls

- Production on Convex Starter. One one-minute cron dispatcher mutation claims due work and schedules fetch actions; no provider I/O in the dispatcher.
- Phase-aware schedule cadence; league-live every two minutes in active windows; confirmation lookups at +15/+60 minutes; correction lookups daily for seven days; pre-completion verification pass before Pool Completed.
- Coalesce by surface/scope with leases. Retries, 429 quiet period, 401/403 circuit. Provider admission ≤60 req/min with confirmation and operator reserves. Routine work cannot starve correctness paths.

### Scoring and recovery

- Atomic per-Verified-Result publish within a Pool Week; Season Standings advance only when a week fully resolves. Immutable Scoring Revisions; identical input fingerprint is no-op; stale attempts cannot overwrite newer revisions.
- Only Production Operator may audited resync/replay; Pool roles get status only. No maintenance lock — valid picking continues against last official revision.
- Survivor eligibility and downstream outcomes replay in Pool Week order even if games verify out of order.

### Pool rules (settled summaries)

- Pools are immediately Active; complete from verified rule outcomes; support non-pausing reversible archival; regular-season only through Week 18; optional templates without rollover.
- Membership closes at Start Week’s first kickoff; Owner-led auditable authority; exactly-one-Owner continuity; departure/removal never rewrite accepted history.
- Survivor: fixed single-elimination, one-use-per-participant, win-only, Thursday eligible, chronological provisional resolution, sole or joint winners, no strikes/revivals.
- Confidence: season-ceiling high-to-low default ranking, automatic home set for untouched weeks, per-pick scoring, final-game weekly tiebreaker, cumulative season points, sole or joint winners.
- Pick Locks: Game Kickoff Lock (default) or Weekly Cutoff Lock; autosave; Hidden until lock; confidence uniqueness client+server.

### Security and trust

- Adult dual verification; deny-by-default; protected invites; Hidden Picks; transparent audits; bounded contact exposure; quotas (≤10 owned / ≤50 memberships per season / ≤100 per Pool); tiered abuse; history-preserving recovery; no money surface.
- Best-effort live Sundays; Operator Incidents + Sentry; relaxed single-operator response times; quiet-when-healthy participant UI; production-only trust scope; no custom backups; one allowlisted Production Operator.

### UI contract

- Hard shell switch at 900px. My Pools → Week Board primary; Standings/Pool secondary chips. Closed component inventory: `AppShell`, `MyPoolsList`, `PoolHeader`, `WeekSelector`, `GameCard`/`GameTableRow`, `TeamPickControl`, `ConfidenceValueControl`, `SaveTrust`, `StandingsTable`, `PoolPanel`, `StatusBanner`, `EmptyState`/`LoadingBlock`.
- Only Pools tokens into shadcn theme. Won/lost never color-only. Single incident banner. Scoped queries — ordinary views do not load entire-season picks.

### Environments and release

- Convex Production + Dev only. Vercel Production → Convex Production; Preview/local → Convex Dev. Separated Clerk/Sentry/secrets; CI fails Preview if Production secrets present.
- Season Bootstrap by Production Operator to Available. Sync Gate ON in Production after bootstrap, OFF by default in Dev with short TTL when enabled.
- Convex-first releases; additive schema; no game-window first cutover; Vercel/Convex function rollback; Sync Gate for sync misconfig — never reopen locks.

### Acceptance gate

- Closed catalog of 52 scenarios in [Define the implementation acceptance contract](./issues/13-define-implementation-acceptance-contract.md) is the MVP acceptance gate. Plan-complete requires a verification method per scenario; ship-ready requires demonstration on Production or Production-parity after go-live. Automation required for authz, Pick Lock rejection, scoring/replay idempotency, and Hidden Picks non-leak.

## Testing Decisions

### What makes a good test

- Test external behavior through settled seams: setup, actor action, observable outcome. Do not assert internal table layouts, private helper structure, or React component trees unless exercising the UI smoke seam.
- Prefer the highest seam that can observe the behavior. Fixture provider responses at the adapter boundary; never call live TheSportsDB in automated CI.
- Assert glossary outcomes (Verified Result, Hidden Pick, Scoring Revision, Sync Gate) rather than provider status strings leaking past the adapter.

### Primary seam (approved)

- **Convex public mutations and queries** are the primary acceptance boundary. Exercise the 52 catalog scenarios through Convex’s public API (`convex-test` / integration) with Clerk identity mocked at the auth edge.
- This seam owns membership, invites, roles, locks, Hidden Picks visibility, scoring/replay idempotency, Sync Gate behavior, Operator Incidents, deny-by-default authz, and Pool lifecycle.

### Narrow adapter seams (approved)

1. **TheSportsDB → normalized NFL facts** — pure fixture-driven adapter tests so provider shapes never cross into domain modules.
2. **UI shell smoke** — scripted manual and selective Playwright against My Pools → Week Board → Standings/Pool for scenarios 45–48 (navigation, keyboard/touch, SaveTrust/live regions, scoped loads). Not exhaustive component unit tests.

### Modules under test

- Convex domain mutations/queries (primary).
- Provider adapter normalization and confirmation evidence mapping.
- Dispatcher claim/coalesce/retry behavior as observable through durable work records and public operator/freshness surfaces where catalogued.
- Production UI shell flows via smoke.

### Prior art

- None in-repo yet (no test runner or Convex modules exist). Establish `convex-test` (or equivalent) patterns alongside the first Convex modules; map each of the 52 scenarios to automated, scripted smoke, or Production Operator checklist per the acceptance contract.

### Automation bar

- Must automate: deny-by-default authorization, Pick Lock rejection, scoring/replay idempotency, Hidden Picks non-leak.
- May use scripted manual smoke plus selective automation: UI shell, responsiveness, accessibility.
- Performance only as scenario observables (interactive board under live updates, scoped loads, non-blocking autosave) — no invented numeric SLAs.

## Out of Scope

- Phase 2 from the brief: reminders, email recaps, chat, commissioner notes, playoff-specific formats, spread-based play, advanced tiebreakers, public leaderboards, exports, historical archives, mobile apps, odds integration, manual result overrides, advanced admin tooling.
- Billing, paid plans, buy-ins, prizes, wagering, payouts, wallets, payment processing, Stripe.
- Public pools, custom branding, push notifications.
- SportsDataIO production contract (retired; $600/year rejected).
- Fallback NFL data provider; custom backup/restore; multi-operator pager rotation; formal WCAG certification audit; numeric freshness/uptime SLAs.
- Promoting the throwaway `/prototype/game-day-flows` markup as production components.

## Further Notes

- Decision map status: destination reached — all in-scope tickets resolved; this spec is the implementation-planning handoff artifact.
- Refer to map tickets by linked title, not bare numbers. Settled answers live under `.scratch/nfl-pool-mvp-specification/issues/`.
- Implementation should optimize for trustworthy live NFL Sundays, simple social participation, clear incident communication, and operator-controlled recovery.
- First Production go-live sequence and the 52-scenario catalog are binding; anything outside the catalog is not an MVP acceptance gate.
