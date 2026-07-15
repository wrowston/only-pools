# 09 — Score Confidence weeks and standings

**What to build:** Verified Results publish progressive official Weekly Standings; Season Standings advance only when a week fully resolves. Correct picks earn assigned unique values; incorrect and locked omissions earn zero. Weekly tiebreaker breaks weekly ties when usable. Possible Remaining Points stay official-only. Participants see Weekly/Season Standings pages and, on desktop, the context-rail peek.

**Blocked by:** 06 — Submit and lock Confidence picks; 07 — Sync live games through Verified Results

**Status:** ready-for-agent

- [ ] Unique values score correctly; values never redistribute
- [ ] Official Weekly Standing updates per Verified Result; Season Standing only after fully resolved weeks; projections labeled non-official
- [ ] Weekly tiebreaker ranks as settled; canceled/unusable share → shared rank
- [ ] Atomic publish, idempotent Scoring Revision fingerprint, and stale-guard hold
- [ ] Standings page + desktop rail peek (top 5 + current user + full link) without Hidden Picks or operator chrome
- [ ] Automated scoring/replay idempotency tests (acceptance scenarios 15–18, 32–33)
