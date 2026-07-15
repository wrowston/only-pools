# 04 — Invite and join a Pool

**What to build:** A Pool Owner (or Admin, where allowed) creates one reusable ordinary Pool Invite, retrieves or rotates it after step-up, and shares the link. An authenticated verified adult opens the URL, acknowledges Owner/Admin contact visibility, and accepts to create exactly one membership. Opening the URL alone does not enroll. After the Start Week’s first scheduled kickoff, accept is refused and never reopens. The Pool panel lists members with role-appropriate contact visibility.

**Blocked by:** 03 — Create an Active Pool and open the Week Board

**Status:** ready-for-agent

- [ ] Invite URL alone does not enroll; authenticated accept creates exactly one membership; repeat accept is idempotent
- [ ] Contact-visibility disclosure is required before accept
- [ ] Membership cutoff at Start Week’s first scheduled kickoff never reopens on reschedule
- [ ] Retrieve/rotate invite requires step-up; raw credentials never appear in logs, audit, or analytics
- [ ] Invalid/expired/probing attempts get generic errors and progressive throttle without auto-rotating a valid invite
- [ ] Acceptance scenarios 2–3, 38 covered; Pool panel member visibility matches settled privacy rules
