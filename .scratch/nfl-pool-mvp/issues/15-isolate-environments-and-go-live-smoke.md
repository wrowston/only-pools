# 15 — Isolate environments and run go-live smoke

**What to build:** Production and Dev Convex deployments are isolated: Vercel Production targets Convex Production only; Preview and local target Dev only; CI fails Preview if Production secrets are present. Sync Gate defaults and Season Bootstrap follow the settled release sequence. Convex schema/functions deploy before frontend that needs them. After Available Season, run the ordered go-live smoke (sign-in, My Pools, throwaway Pool, invite join, unlocked pick, lock/scoring wiring) before real participants. No first cutover during an active game window.

**Blocked by:** 02 — Bootstrap an Available Season; 10 — Handle disrupted and corrected games; 13 — Surface Operator Incidents and recovery; 14 — Finish the responsive game-day shell

**Status:** blocked-on-human — production env isolation, Vercel/Clerk/Convex Production wiring, paid SportsDB key, go-live smoke. Local/Dev implementation of tickets 01–14 is complete; leave this ticket for the operator.

- [ ] Env isolation: Preview/local → Convex Dev only; Production secrets absent from Preview (CI fails otherwise)
- [ ] Sync Gate: Production ON after bootstrap; Dev OFF by default with short TTL when enabled for testing
- [ ] Convex-first release sequencing documented and followed; no game-window Production cutover for first go-live
- [ ] Go-live smoke completed after Available Season before real participants
- [ ] Acceptance scenarios 49–52 demonstrated on Production or Production-parity path
