# 08 — Score Survivor weeks and declare winners

**What to build:** Each Verified Result publishes an atomic Scoring Revision for affected Survivor Pool Weeks: pick outcomes, eligibility, and used-team projections move together. Verified win keeps Alive; verified loss, tie, or missing required pick eliminates with no strikes or revivals. Sole or joint winners complete the Pool only from settled verified weeks. Participants see Survivor Standings (alive/eliminated) as a secondary destination from the Week Board.

**Blocked by:** 05 — Submit and lock Survivor picks; 07 — Sync live games through Verified Results

**Status:** ready-for-agent

- [ ] Win-only advance and permanent elimination behave as settled
- [ ] Earlier elimination invalidates later provisionals without consuming their teams
- [ ] Sole Alive → Winner + Completed; all Alive eliminated in a week → joint winners; multiple Alive after final week → joint winners
- [ ] Atomic week publish or prior revision remains; identical fingerprint is no-op; stale attempt cannot overwrite newer revision
- [ ] Standings page shows alive/eliminated with week context
- [ ] Automated scoring/replay idempotency tests (acceptance scenarios 12–14, 32–33)
