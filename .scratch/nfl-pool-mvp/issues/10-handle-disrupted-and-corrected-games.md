# 10 — Handle disrupted and corrected games

**What to build:** Postponement and reschedule never reopen a reached Pick Lock. Confirmed cancellations follow Survivor and Confidence paths (pre-lock replace; post-lock No-Contest Advance consuming team; post-freeze Confidence slot stays, scores 0, no renumber). Authoritative Corrected Results supersede prior Verified Results, replay downstream in Pool Week order, and may return Completed→Active. No Pool role can invent or suppress results.

**Blocked by:** 07 — Sync live games through Verified Results; 08 — Score Survivor weeks and declare winners; 09 — Score Confidence weeks and standings

**Status:** ready-for-agent

- [ ] Reached Pick Lock never reopens; unreached lock may move with authoritative kickoff change
- [ ] Survivor and Confidence cancellation outcomes match the settled policy
- [ ] Corrected Result replay is deterministic, expands to safe dependency scope, and may reopen Completed→Active
- [ ] Pool roles cannot invent, suppress, or force results
- [ ] Acceptance scenarios 25–27 covered with automated replay tests where server-authoritative
