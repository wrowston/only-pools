# 03 — Create an Active Pool and open the Week Board

**What to build:** A Pool Owner creates an immediately Active Survivor or Confidence Pool for the Available Season, choosing a valid Start Week and Pick Lock mode. The Pool appears on My Pools; opening it lands on the Week Board showing that week’s slate. Pool Type and Pool Season are immutable; Start Week and outcome-affecting rules remain editable until the first accepted competitive edit or Pick Lock.

**Blocked by:** 02 — Bootstrap an Available Season

**Status:** ready-for-agent

- [ ] Create yields an immediately Active Pool only when a season is Available
- [ ] Pool Type and Pool Season cannot change after create
- [ ] Start Week / ruleset / lock mode editable until first accepted competitive edit or first Pick Lock, then immutable
- [ ] My Pools lists the membership with next-action status; opening it enters the Week Board as the primary in-pool surface
- [ ] Week Board shows the published slate for the selected week (picks may still be read-only until later tickets)
- [ ] Acceptance scenarios 8–9 covered; navigation toward scenario 45 begun
