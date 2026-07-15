# 13 — Surface Operator Incidents and recovery

**What to build:** Operator Incidents open for Provider Exception, Stale-in-window, scoring delayed more than ten minutes after a Verified Result, quarantine past confirmation, and Convex capacity. Participants see one top StatusBanner for those cases and none when healthy. Only the allowlisted Production Operator may acknowledge and run audited resync/replay with step-up; Pool roles get status only. Valid picking continues against the last official Scoring Revision during repair. Sentry is wired as the MVP exception channel.

**Blocked by:** 07 — Sync live games through Verified Results

**Status:** ready-for-agent

- [ ] Incident triggers match the settled catalog; Late alone does not open an incident or banner
- [ ] Single top banner for participant-visible cases; clears on resolve; no last-updated chrome when healthy
- [ ] Only allowlisted Production Operator; recovery mutations need step-up + audit; cannot edit authoritative inputs or reopen locks
- [ ] No Pool-wide maintenance lock during repair
- [ ] Sentry receives application/sync/scoring exceptions and incident open/escalate signals
- [ ] Preview/Dev never page production
- [ ] Acceptance scenarios 34–35, 42–44 covered
