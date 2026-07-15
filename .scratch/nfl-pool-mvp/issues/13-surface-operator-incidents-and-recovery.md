# 13 — Surface Operator Incidents and recovery

**What to build:** Operator Incidents open for Provider Exception, Stale-in-window, scoring delayed more than ten minutes after a Verified Result, quarantine past confirmation, and Convex capacity. Participants see one top StatusBanner for those cases and none when healthy. Only the allowlisted Production Operator may acknowledge and run audited resync/replay with step-up; Pool roles get status only. Valid picking continues against the last official Scoring Revision during repair. Sentry is wired as the MVP exception channel.

**Blocked by:** 07 — Sync live games through Verified Results

**Status:** done

- [x] Incident triggers match the settled catalog; Late alone does not open an incident or banner
- [x] Single top banner for participant-visible cases; clears on resolve; no last-updated chrome when healthy
- [x] Only allowlisted Production Operator; recovery mutations need step-up + audit; cannot edit authoritative inputs or reopen locks
- [x] No Pool-wide maintenance lock during repair
- [x] Sentry receives application/sync/scoring exceptions and incident open/escalate signals
- [x] Preview/Dev never page production
- [x] Acceptance scenarios 34–35, 42–44 covered

## Notes

### Locally verified
- Pure `shouldOpenIncident` catalog + Convex `operatorIncidents` table/API
- `getParticipantStatusBanner` → single top `StatusBanner` in app shell; healthy → null
- Operator acknowledge / resolve / audited resync / audited replay require allowlist + step-up + `operatorAuditEvents`
- Picking (`autosaveSurvivorPick`) continues with open incident; `maintenanceLock` always false
- Sync freshness path opens Stale / Provider Exception incidents; Late alone does not
- Scoring-delay check scheduled after Verified Result; quarantine check past confirmation window
- 225 tests + typecheck green

### Human follow-up (production)
- Set production `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` and optionally install `@sentry/nextjs` / `@sentry/node` SDK — current sink is a no-op recorder when DSN unset, and Dev/Preview never sets `pagesProduction`
- Set production `DEPLOYMENT_KIND=production` so paging eligibility can apply
- Convex capacity meter → `evaluateAndOpenIncident({ kind: "convex_capacity", ... })` when usage telemetry is available
