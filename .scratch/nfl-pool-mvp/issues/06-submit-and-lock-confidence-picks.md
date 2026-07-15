# 06 — Submit and lock Confidence picks

**What to build:** When a Confidence Pick Window opens, every eligible participant gets the same frozen Pick Sheet and Default Confidence Ranking. Participants autosave winner predictions, unique confidence values, and the Weekly Tiebreaker Prediction. Client and server enforce uniqueness. An untouched set becomes an Automatic Confidence Pick Set at first required lock. Both Game Kickoff Lock and Weekly Cutoff Lock modes work. Hidden until lock; provenance after lock.

**Blocked by:** 03 — Create an Active Pool and open the Week Board

**Status:** done

- [x] Frozen Pick Sheet and default ranking are authoritative for every eligible participant when the window opens
- [x] Autosave covers predictions, atomic confidence reorders, and tiebreaker; partial multi-edit responses explain each unit
- [x] Client blocks duplicates; server independently rejects uniqueness, range, and locked-value violations
- [x] Untouched set at first required lock becomes Automatic Confidence Pick Set (home + default ranking) with retained origin
- [x] Weekly Cutoff Lock freezes remaining components including tiebreaker at Sunday 1:00 p.m. Eastern
- [x] Hidden until lock; provenance (authored / automatic / omission) after lock
- [x] Automated tests cover lock rejection, uniqueness, and Hidden Picks non-leak (acceptance scenarios 16, 19–23)
