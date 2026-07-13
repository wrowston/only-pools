Label: wayfinder:map

# NFL Pool MVP Decision Map

## Destination

A decision-complete specification for a production-ready, free, private-pool MVP that can be handed off for implementation planning. It must settle product rules, domain language, architecture boundaries, game-day operations, user experience expectations, and observable acceptance criteria without fixing a launch date.

## Notes

- The [NFL Pool Web App Architecture Brief](./brief.md) is the locked baseline. Its explicit technology choices, product defaults, MVP boundaries, and exclusions are constraints rather than questions to reopen.
- This map produces decisions, not implementation deliverables. Do not write application code while working it.
- Use the repository's [domain glossary](../../CONTEXT.md) and consult the `grilling` and `domain-modeling` skills in every decision session. Use `research` or `prototype` when the ticket type calls for it.
- Refer to the map and every ticket by its linked title, never by a bare local number.
- Optimize every decision for trustworthy live NFL Sundays, simple social participation, and commissioner-friendly recovery.

## Decisions so far

<!-- Resolved tickets are indexed here by linked title and a one-line gist. -->

- [Research the SportsDataIO NFL data contract](./issues/06-research-sportsdataio-contract.md) — SportsDataIO covers the required NFL lifecycle, but live production access requires a commercial agreement whose price, product choice, and app-specific storage/display rights are not public.
- [Define the pool and season lifecycle](./issues/01-define-pool-season-lifecycle.md) — Pools are immediately Active, complete from verified rule outcomes, support non-pausing reversible archival, regular-season-only pick windows including advance Survivor picks, and optional prior-season templates without rollover.
- [Settle membership, roles, and invitations](./issues/02-settle-membership-roles-invitations.md) — Membership closes at the Start Week's first kickoff, authority is Owner-led and auditable, exactly-one-Owner continuity is enforced, and departure or removal never rewrites accepted competitive history.
- [Settle survivor rules and participant state](./issues/03-settle-survivor-rules-participant-state.md) — Survivor is fixed single-elimination: one-use-per-participant, win-only advancement, Thursday eligibility, chronological provisional-pick resolution, and deterministic sole or joint winners without strikes or revivals.
- [Settle confidence rules and scoring semantics](./issues/04-settle-confidence-rules-scoring.md) — Confidence uses a season-ceiling high-to-low default ranking, automatic home-team picks for untouched weeks, per-pick scoring, a final-game weekly tiebreaker, cumulative season points, and sole or joint winners.
- [Define pick submission, locking, and visibility](./issues/05-define-pick-submission-locking-visibility.md) — Autosaved, server-authoritative per-game or Sunday-cutoff locks keep unlocked choices private, reveal locked provenance, auto-fill only untouched Confidence Pick Sets, and enforce confidence-value uniqueness in both client and server.
- [Define disrupted and corrected game policy](./issues/07-define-disrupted-corrected-game-policy.md) — Only verified closed results settle Pools; frozen games survive disruption without reopened locks, cancellations use explicit Survivor and Confidence outcomes, and authoritative corrections replay downstream results with visible projections and audit.

## Not yet specified

- The exact Convex persistence model, indexes, aggregate boundaries, and focused query surface. The domain and scoring decisions must first reveal the invariants and access patterns this design must preserve.
- The precise scheduled-job topology, polling cadence, retry windows, and cost controls. SportsDataIO's real contract and the provider-normalization decision must first bound this question.
- Component-level responsive interactions and visual system details. The game-day flow prototype must first establish which interactions need fidelity.
- Deployment environments, seed/bootstrap mechanics, and release sequencing. The production trust standard must first reveal the required operational boundary.

## Out of scope

- Phase 2 features identified in the source brief, including reminders, email recaps, chat, commissioner notes, playoff-specific pool formats, spread-based play, advanced tiebreakers, public leaderboards, exports, historical archives, mobile apps, odds integration, manual result overrides, and advanced admin tooling.
- Billing, paid plans, buy-ins, prizes, wagering, payouts, wallets, payment processing, and Stripe.
- Public pools, custom branding, and push notifications.
