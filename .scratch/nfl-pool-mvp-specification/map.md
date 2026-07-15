Label: wayfinder:map

# NFL Pool MVP Decision Map

## Destination

A decision-complete specification for a production-ready, free, private-pool MVP that can be handed off for implementation planning. It must settle product rules, domain language, architecture boundaries, game-day operations, user experience expectations, and observable acceptance criteria without fixing a launch date.

## Notes

- The [NFL Pool Web App Architecture Brief](./brief.md) is the locked baseline. Its original SportsDataIO selection has been superseded by TheSportsDB in [Select the production NFL data provider](./issues/16-select-production-nfl-data-provider.md); its other explicit technology choices, product defaults, MVP boundaries, and exclusions remain constraints rather than questions to reopen.
- This map produces decisions, not implementation deliverables. Do not write application code while working it.
- Use the repository's [domain glossary](../../CONTEXT.md) and consult the `grilling` and `domain-modeling` skills in every decision session. Use `research` or `prototype` when the ticket type calls for it.
- Refer to the map and every ticket by its linked title, never by a bare local number.
- Optimize every decision for trustworthy live NFL Sundays, simple social participation, clear incident communication, and operator-controlled recovery.
- Production observability uses Sentry together with in-product Operator Incidents, as settled in [Define the production trust and recovery standard](./issues/11-define-production-trust-recovery-standard.md).

## Decisions so far

<!-- Resolved tickets are indexed here by linked title and a one-line gist. -->

- [Research the SportsDataIO NFL data contract](./issues/06-research-sportsdataio-contract.md) — SportsDataIO covers the required NFL lifecycle, but live production access requires a commercial agreement whose price, product choice, and app-specific storage/display rights are not public.
- [Define the pool and season lifecycle](./issues/01-define-pool-season-lifecycle.md) — Pools are immediately Active, complete from verified rule outcomes, support non-pausing reversible archival, regular-season-only pick windows including advance Survivor picks, and optional prior-season templates without rollover.
- [Settle membership, roles, and invitations](./issues/02-settle-membership-roles-invitations.md) — Membership closes at the Start Week's first kickoff, authority is Owner-led and auditable, exactly-one-Owner continuity is enforced, and departure or removal never rewrites accepted competitive history.
- [Settle survivor rules and participant state](./issues/03-settle-survivor-rules-participant-state.md) — Survivor is fixed single-elimination: one-use-per-participant, win-only advancement, Thursday eligibility, chronological provisional-pick resolution, and deterministic sole or joint winners without strikes or revivals.
- [Settle confidence rules and scoring semantics](./issues/04-settle-confidence-rules-scoring.md) — Confidence uses a season-ceiling high-to-low default ranking, automatic home-team picks for untouched weeks, per-pick scoring, a final-game weekly tiebreaker, cumulative season points, and sole or joint winners.
- [Define pick submission, locking, and visibility](./issues/05-define-pick-submission-locking-visibility.md) — Autosaved, server-authoritative per-game or Sunday-cutoff locks keep unlocked choices private, reveal locked provenance, auto-fill only untouched Confidence Pick Sets, and enforce confidence-value uniqueness in both client and server.
- [Define disrupted and corrected game policy](./issues/07-define-disrupted-corrected-game-policy.md) — Only Verified Results that meet the selected provider's confirmation policy settle Pools; frozen games survive disruption without reopened locks, cancellations use explicit Survivor and Confidence outcomes, and authoritative corrections replay downstream results with visible projections and audit.
- [Define the security, privacy, and abuse boundary](./issues/12-define-security-privacy-abuse-boundary.md) — Verified adult identities, deny-by-default authorization, protected invites and Hidden Picks, transparent audits, bounded contact exposure, tiered abuse controls, and history-preserving recovery define the free private service's trust boundary.
- [Obtain SportsDataIO production proposals](./issues/14-obtain-sportsdataio-production-proposals.md) — SportsDataIO quoted production access at $600 per year, which the project owner rejected as too expensive for the free MVP.
- [Select the production NFL data provider](./issues/16-select-production-nfl-data-provider.md) — TheSportsDB's $90 annual plan is the sole MVP feed, with two-minute best-effort NFL data and application-confirmed finality, correction polling, normalized-fact licensing limits, and no fallback provider.
- [Design the provider normalization and synchronization contract](./issues/08-design-provider-normalization-sync-contract.md) — A Convex-only pipeline isolates TheSportsDB behind stable NFL Team and NFL Game identities, normalized evidence, guarded finality and corrections, freshness states, and versioned idempotent triggers.
- [Define scoring, standings, and recalculation guarantees](./issues/09-define-scoring-standings-recalculation.md) — Verified Results publish progressive atomic Weekly Standings, completed weeks advance Season Standings, immutable Scoring Revisions make replay deterministic, and recovery remains automatic or Production Operator-controlled.
- [Prototype participant and Pool Owner game-day flows](./issues/10-prototype-game-day-flows.md) — A mobile-first Week Board, expanded into a Firecrawl-like desktop shell with Only Pools colors, keeps picks, save/lock/result trust, standings, and Owner readiness in one responsive hierarchy that must be rebuilt as production React components.
- [Research Convex scheduling and provider constraints](./issues/17-research-convex-scheduling-provider-constraints.md) — Convex requires mutation-owned durable orchestration around at-most-once fetch actions; TheSportsDB capacity is ample but has no freshness SLA, and production plan, retry, cadence, observability, and budget choices remain explicit.
- [Define the Convex synchronization schedule and cost controls](./issues/18-define-convex-sync-schedule-cost-controls.md) — A one-minute Convex dispatcher drives phase-aware schedule, live, confirmation, and correction work with coalesced retries, explicit freshness states, audited operator recovery, and protected Starter/provider budgets.
- [Define the production trust and recovery standard](./issues/11-define-production-trust-recovery-standard.md) — Best-effort live Sundays with Operator Incidents plus Sentry, relaxed single-operator response times, quiet-when-healthy participant banners, production-only scope, no custom backups, and one allowlisted Production Operator.
- [Design the Convex persistence and query model](./issues/19-design-convex-persistence-query-model.md) — Separate authoritative and projection tables, participant-week pick docs, Scoring Revision–published standing rows, NFL identity plus evidence, hashed invites, index-guarded uniqueness, and a closed role-filtered query catalog.
- [Define the responsive component and visual interaction contract](./issues/20-define-responsive-component-visual-contract.md) — My Pools → Week Board with secondary Standings/Pool pages, 900px shadcn shell, closed component inventory, inherited Only Pools tokens/states, and quiet degradation via a single incident banner.
- [Define production deployment, bootstrap, and release sequencing](./issues/21-define-production-deployment-bootstrap-release.md) — Convex Production and Dev with Preview on Dev only, separated secrets, operator Season Bootstrap to Available, Convex-first releases, Sync Gate controls, and ordered go-live without game-window cutover.
- [Define the implementation acceptance contract](./issues/13-define-implementation-acceptance-contract.md) — A closed catalog of 52 trust-critical scenarios across twelve sections, with plan-complete and ship-ready demonstration bars, is the MVP acceptance gate; nothing outside the catalog is required.

## Not yet specified

<!-- Destination reached: no open tickets and no remaining in-scope fog. The way is clear for implementation-planning handoff. -->

## Out of scope

- Phase 2 features identified in the source brief, including reminders, email recaps, chat, commissioner notes, playoff-specific pool formats, spread-based play, advanced tiebreakers, public leaderboards, exports, historical archives, mobile apps, odds integration, manual result overrides, and advanced admin tooling.
- Billing, paid plans, buy-ins, prizes, wagering, payouts, wallets, payment processing, and Stripe.
- Public pools, custom branding, and push notifications.
- [Choose the SportsDataIO production contract](./issues/15-choose-sportsdataio-production-contract.md) — SportsDataIO-specific selection was retired because its $600 annual production price exceeds the acceptable cost for this free MVP.
