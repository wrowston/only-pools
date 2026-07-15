# 09 — Score Confidence weeks and standings

**What to build:** Verified Results publish progressive official Weekly Standings; Season Standings advance only when a week fully resolves. Correct picks earn assigned unique values; incorrect and locked omissions earn zero. Weekly tiebreaker breaks weekly ties when usable. Possible Remaining Points stay official-only. Participants see Weekly/Season Standings pages and, on desktop, the context-rail peek.

**Blocked by:** 06 — Submit and lock Confidence picks; 07 — Sync live games through Verified Results

**Status:** done

- [x] Unique values score correctly; values never redistribute
- [x] Official Weekly Standing updates per Verified Result; Season Standing only after fully resolved weeks; projections labeled non-official
- [x] Weekly tiebreaker ranks as settled; canceled/unusable share → shared rank
- [x] Atomic publish, idempotent Scoring Revision fingerprint, and stale-guard hold
- [x] Standings page + desktop rail peek (top 5 + current user + full link) without Hidden Picks or operator chrome
- [x] Automated scoring/replay idempotency tests (acceptance scenarios 15–18, 32–33)
