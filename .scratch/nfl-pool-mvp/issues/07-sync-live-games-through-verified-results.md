# 07 — Sync live games through Verified Results

**What to build:** A one-minute Convex dispatcher drives phase-aware schedule, live, confirmation, and correction work into normalized mutations. The Week Board shows live and Projected Results clearly labeled as non-official. First FT/AOT remains provisional; matching confirmation through 15- and 60-minute lookups produces a Verified Result. Freshness Late vs Stale and Provider Exception behave as settled; routine work cannot starve confirmation or operator reserves.

**Blocked by:** 02 — Bootstrap an Available Season; 03 — Create an Active Pool and open the Week Board

**Status:** ready-for-agent

- [ ] No frontend provider calls; fetches go through dispatcher-claimed actions into normalized mutations
- [ ] Confirmation clock verifies matching terminal evidence; contradiction restarts; failure leaves Pending + retry
- [ ] Provisional finals drive projections only — never official elimination, points, or completion
- [ ] Late alone raises no participant banner; Stale-in-window / Provider Exception are distinguishable for later incident wiring
- [ ] Budget non-starvation: confirmation/operator reserves protected
- [ ] Acceptance scenarios 24, 28–31 covered with fixture-driven sync tests
