# 11 — Administer roles, removal, archive, and audit

**What to build:** Exactly-one-Owner continuity with step-up transfer to a current Admin who must explicitly accept. Pool Admins manage ordinary invites and remove Members within limits. Voluntary leave and administrative removal preserve competitive history; ordinary invites cannot reinstate a removed Member. Archive is a reversible read-only overlay that does not pause locks/sync/scoring. Sanitized Pool Audit Events are visible to current participants. Quotas and Abuse Report intake exist; no money surface.

**Blocked by:** 04 — Invite and join a Pool

**Status:** ready-for-agent

- [ ] Ownership transfer requires step-up + explicit accept; roles swap atomically; sole Owner cannot leave/delete while owning
- [ ] Removal preserves attributed picks/standings; contact visibility ends; reinstatement is audited Owner-only at Member authority
- [ ] Archive hides from normal My Pools, blocks joins/picks/rules edits, continues locks/sync/scoring; restore does not undo missed locks
- [ ] Sanitized audit events for role/membership/invite/archive/restore without raw invite credentials
- [ ] Quotas enforced (≤10 owned / ≤50 memberships per season / ≤100 per Pool); Abuse Report creates no automatic penalty and never copies Hidden Picks or raw invites
- [ ] No buy-in/prize/payout/wager fields or workflows
- [ ] Acceptance scenarios 4–6, 10, 39–41 covered
