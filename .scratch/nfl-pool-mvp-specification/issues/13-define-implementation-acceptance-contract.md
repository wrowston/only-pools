Type: grilling
Status: resolved
Blocked by: 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12, 16, 18, 19, 20, 21

# Define the implementation acceptance contract

## Question

What scenario-based functional, authorization, timing, scoring, synchronization, recovery, accessibility, responsiveness, performance, and operational criteria must an implementation plan preserve for the MVP specification to be considered complete and trustworthy?

## Comments

- The acceptance contract is a closed catalog of named, scenario-based observables. An implementation plan (and later the build) must be able to demonstrate each one. Scenarios state setup, actor action, and observable outcome, and point at settled decisions rather than restating the rulebook. Anything outside the catalog is not an MVP acceptance gate.
- Catalog coverage is trust-critical boundaries once, not an exhaustive combinatorial matrix. Include a scenario when failure would break competitive fairness, privacy/authorization, lock timing, official scoring integrity, sync/recovery honesty, or the settled game-day UX shell. Prefer one sharp scenario per settled rule family over every pool-type × lock-mode × disruption cross-product.
- Demonstration has two bars. Plan complete: every scenario maps to a verification method (automated test, scripted smoke, or Production Operator checklist). Ship ready: every scenario has been demonstrated at least once on Production or a Production-parity path after the settled go-live sequence. MVP requires automation for server-authoritative boundaries (authz, Pick Lock rejection, scoring/replay idempotency, Hidden Picks non-leak); UI shell, responsiveness, and accessibility may use scripted manual smoke plus selective automation.
- Performance criteria are scenario observables only — no invented numeric SLAs. Include Week Board remaining interactive under live updates, scoped queries (no whole-season loads for ordinary views), and non-blocking autosave feedback. Do not add hard latency or “scores within N minutes” budgets in this contract.
- Accessibility and responsiveness bind to the settled UI contract as scenarios, not a WCAG certification gate. Prove the 900px shell switch, keyboard-complete flows, touch targets, focus, reduced motion, non-color-only won/lost, and limited live regions. No formal WCAG audit is required for MVP ship.
- The catalog is organized into exactly twelve sections: (1) Identity, membership, invites, and roles; (2) Pool / season lifecycle and Season Bootstrap; (3) Survivor outcomes; (4) Confidence scoring and standings; (5) Pick submission, locking, and visibility; (6) Disrupted and corrected games; (7) Provider sync, freshness, and budget guards; (8) Scoring Revisions, replay, and recovery authority; (9) Security, privacy, and abuse boundary; (10) Operator Incidents and participant failure communication; (11) UI shell, accessibility, responsiveness, and performance observables; (12) Environments, Sync Gate, release, and go-live. No Phase 2 or billing sections.

## Answer

### Contract shape

- The MVP acceptance contract is a **closed catalog of 52 named scenarios**. Each scenario states setup, actor action, and observable outcome, and points at settled map decisions rather than restating the rulebook.
- An implementation plan is complete only when every catalog scenario maps to a verification method (automated test, scripted smoke, or Production Operator checklist).
- The build is ship-ready only when every scenario has been demonstrated at least once on Production or a Production-parity path after the go-live sequence in [Define production deployment, bootstrap, and release sequencing](./21-define-production-deployment-bootstrap-release.md).
- MVP requires automation for server-authoritative boundaries: deny-by-default authorization, Pick Lock rejection, scoring/replay idempotency, and Hidden Picks non-leak. UI shell, responsiveness, and accessibility may use scripted manual smoke plus selective automation.
- Anything outside this catalog is not an MVP acceptance gate. Coverage is trust-critical boundaries once — not an exhaustive combinatorial matrix.
- Performance appears only as scenario observables — no invented numeric latency or freshness SLAs. Accessibility binds to the settled UI contract as scenarios — no formal WCAG certification gate.

### Closed catalog

#### 1. Identity, membership, invites, and roles

1. **Adult dual verification** — Sign-in without verified email+phone and age confirmation is refused; both required again on next sign-in if either lapses mid-session.
2. **Invite join** — Opening invite URL alone does not enroll; authenticated accept creates exactly one membership; repeat accept is idempotent.
3. **Membership cutoff** — After Start Week’s first scheduled kickoff, invite accept is refused and never reopens.
4. **Owner continuity** — Ownership transfer to a current Admin requires step-up + explicit accept; roles swap atomically; Owner cannot leave/delete while sole Owner.
5. **Removal preserves history** — Removed Member loses access and contact visibility; picks/standings remain attributed; ordinary invite cannot reinstate — only audited Owner reinstatement at Member authority.
6. **Audit visibility** — Role/membership/invite/archive actions produce sanitized Pool Audit Events visible to current participants without raw invite credentials.

#### 2. Pool / season lifecycle and Season Bootstrap

7. **Create requires Available Season** — Before Season Bootstrap succeeds, Create Pool is disabled with empty state; after Available, create yields immediately Active Pool.
8. **Immutable identity** — Pool Type and Pool Season cannot change after create.
9. **Rules freeze** — Start Week / ruleset editable until first accepted competitive edit or first Pick Lock; then immutable.
10. **Archive overlay** — Archive hides from normal My Pools, is read-only for joins/picks/rules, but locks/sync/scoring continue; restore does not undo missed locks.
11. **Template no history copy** — Pool Template prefills setup and optional Returning Participant Invites; never copies memberships, picks, standings, or audit history.

#### 3. Survivor outcomes

12. **Win-only advance** — Verified win keeps Alive; verified loss/tie/missing required pick eliminates; no strikes/revivals.
13. **One-use team** — Accepted/provisional pick reserves team; change of unlocked pick releases; elimination invalidates later provisionals without consuming their teams.
14. **Terminal winners** — Sole Alive after a settled week → Winner + Completed; all Alive eliminated in a week → joint winners that cohort; multiple Alive after final week → joint winners.

#### 4. Confidence scoring and standings

15. **Unique values score** — Correct pick earns assigned unique confidence value; incorrect/blank locked omission earns 0; values never redistribute.
16. **Automatic home set** — Untouched set at first required lock gets Automatic Confidence Pick Set (home + default ranking); origin retained after later edits.
17. **Progressive weekly / completed season** — Official Weekly Standing updates per Verified Result; Season Standing advances only when the week fully resolves; projections stay labeled non-official.
18. **Weekly tiebreaker** — Final-game tiebreaker breaks weekly ties when usable; canceled/unusable share → shared rank.

#### 5. Pick submission, locking, and visibility

19. **Autosave authority** — Each gesture mutates server-side; no Save button; failed units explained; partial Confidence multi-edit never silent.
20. **Game Kickoff Lock** — At scheduled kickoff or provider-started, mutation rejects; no grace; client clock irrelevant.
21. **Weekly Cutoff Lock** — Sunday 1:00 p.m. Eastern freezes remaining Survivor/Confidence components including tiebreaker.
22. **Hidden until lock** — Opponents/Owner/Admin cannot see choice values before lock; completion state only for admins; lock reveals provenance (authored / automatic / omission).
23. **Confidence uniqueness** — Client blocks duplicates; server rejects any uniqueness/range/locked-value violation independently.

#### 6. Disrupted and corrected games

24. **Provisional ≠ official** — First FT/AOT drives projections only; official elimination/points/completion require Verified Result.
25. **Lock irreversible** — Postponement/reschedule never reopens a reached Pick Lock; kickoff change may move an *unreached* lock.
26. **Cancellation paths** — Pre-lock Survivor cancel → replace pick; post-lock → No-Contest Advance consuming team; post-freeze Confidence cancel → slot stays, scores 0, no renumber.
27. **Corrected Result replay** — Authoritative correction supersedes prior Verified Result, replays downstream in Pool Week order, may return Completed→Active; no Pool role can invent/suppress results.

#### 7. Provider sync, freshness, and budget guards

28. **Convex-only pipeline** — No frontend provider calls; fetches via dispatcher-claimed actions into normalized mutations.
29. **Confirmation clock** — Matching terminal evidence through 15- and 60-minute lookups verifies; contradiction restarts; failure leaves Pending + retry.
30. **Stale vs Late** — Late alone: no participant banner; Stale in active window / Provider Exception: banner + Operator Incident path.
31. **Budget non-starvation** — Routine work cannot consume confirmation/operator reserves; correctness paths not shed merely to avoid Convex charges.

#### 8. Scoring Revisions, replay, and recovery authority

32. **Atomic week publish** — One Verified Result publishes pick outcomes, weekly rows/ranks, possible points, Survivor eligibility together — or prior revision remains with scoring-delayed.
33. **Idempotent revision** — Identical input fingerprint is no-op; stale attempt cannot overwrite newer Scoring Revision.
34. **Operator replay only** — Pool roles cannot resync/replay; Production Operator audited replay expands to safe dependency scope and cannot edit authoritative inputs.
35. **No maintenance lock** — During repair, valid picking continues against last official revision.

#### 9. Security, privacy, and abuse boundary

36. **Deny-by-default authz** — Unauthorized query/mutation returns nothing privileged; client-supplied roles ignored.
37. **Hidden Picks non-leak** — Logs/analytics/errors/audit never contain Hidden Pick values or raw invite credentials.
38. **Invite throttle** — Invalid/expired/probing invite attempts get generic errors + progressive throttle; never auto-rotate valid invite.
39. **Quotas** — Enforce ≤10 owned Pools / ≤50 memberships per season / ≤100 participants per Pool.
40. **Abuse Report** — Private report creates no automatic penalty and never copies Hidden Picks or raw invites.
41. **No money surface** — No buy-in/prize/payout/wager fields or workflows exist.

#### 10. Operator Incidents and participant failure communication

42. **Incident triggers** — Provider Exception, Stale-in-window, scoring delayed >10 min after Verified Result, quarantine past confirmation, Convex capacity → Operator Incident; Late alone does not.
43. **Single banner** — One top banner for those participant-visible cases; healthy UI has no last-updated chrome; banner clears on resolve.
44. **Single operator** — Only allowlisted Production Operator; recovery mutations need step-up + audit; Preview/Dev never page production.

#### 11. UI shell, accessibility, responsiveness, performance observables

45. **Navigation contract** — My Pools home → Week Board primary; Standings/Pool secondary chips; no equal-weight bottom tabs; desktop ≥900px expands same hierarchy.
46. **Keyboard & touch** — Board/Standings/Pool completable by keyboard; pick targets ≥44px; visible focus; reduced motion respected; won/lost not color-only.
47. **SaveTrust + live regions** — Quiet inline save trust; polite aria-live only for save-trust and incident banner.
48. **Scoped loads** — Ordinary My Pools / Week Board / standings views do not require loading entire-season picks; board stays interactive under live score updates.

#### 12. Environments, Sync Gate, release, and go-live

49. **Env isolation** — Vercel Preview/local → Convex Dev only; Production secrets absent from Preview (CI fails otherwise).
50. **Sync Gate** — Production ON after bootstrap; Dev OFF by default; OFF stops new fetch claims but keeps locks/queries/scoring of already-Verified Results.
51. **Convex-first release** — Functions/schema deploy before frontend needing them; no game-window Production cutover for first go-live.
52. **Go-live smoke** — After Available Season: sign-in, My Pools, create throwaway Pool, invite join, submit unlocked pick, confirm lock/scoring wiring — then real participants.
