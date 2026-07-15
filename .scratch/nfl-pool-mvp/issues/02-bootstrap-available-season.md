# 02 — Bootstrap an Available Season

**What to build:** The allowlisted Production Operator can run Season Bootstrap on a Convex deployment so NFL Teams and the regular-season schedule are seeded from TheSportsDB through a normalized adapter. When bootstrap succeeds with at least one usable Start Week slate, the Pool Season becomes Available and Create Pool enables. Sync Gate defaults respect Production ON / Dev OFF. Clients never call the provider.

**Blocked by:** 01 — Authenticate adults into My Pools

**Status:** ready-for-agent

- [ ] TheSportsDB shapes stop at the adapter; NFL Team and NFL Game identities are provider-independent
- [ ] Season Bootstrap is audited, operator-only, and marks the season Available only after a successful schedule sync with a usable Start Week
- [ ] Before Available, Create Pool stays disabled with a clear empty state (not an incident banner)
- [ ] Sync Gate stops new provider fetch claims when OFF; locks and ordinary queries continue
- [ ] Fixture-driven adapter tests cover normalization; no live provider calls in CI (acceptance scenarios 7, 28, 50)
