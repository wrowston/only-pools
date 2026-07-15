Type: grilling
Status: resolved
Blocked by: 11, 12, 18

# Define production deployment, bootstrap, and release sequencing

## Question

What production and non-production environments, secret and provider-key separation, season seed and bootstrap mechanics, migration and release sequencing, preview isolation rules, and rollback expectations should implement the settled production-only trust boundary without endangering live Pools?

## Answer

### Environments and routing

- Exactly two durable Convex deployments: **Production** and **Dev**.
- **Vercel Production** targets Convex Production only.
- **Vercel Preview** (PR/branch deploys) and **local Next.js** target Convex Dev only.
- Preview never receives Production Convex URLs, deploy keys, or other Production secrets. CI must fail a Preview deploy if Production secret names are present in its environment.

### Secrets and identity isolation

- **Clerk:** separate Production and Development applications (or Clerk’s production vs development instances). Preview and local use Development; Production never shares session cookies, webhook secrets, or allowlists with Dev.
- **TheSportsDB:** separate API keys when the plan allows. If only one account key exists, it may be configured on both Convex deployments **only if** Dev synchronization remains gated off by default so Dev cannot consume Production’s request budget or open the provider auth circuit during a live Sunday.
- All other secrets — Convex deploy keys, Sentry DSNs, invite encryption keys, Production Operator allowlists — are per-environment and are never copied from Production into Preview or local env files.

### Season Bootstrap

- An NFL **Pool Season** enters a deployment only through an audited **Season Bootstrap** performed by the Production Operator in Production (and the same action in Dev for testing).
- Bootstrap selects league and season year, seeds NFL Teams if missing, enqueues the authoritative full-season schedule sync, and marks the season **Available** only after that sync succeeds with at least one usable Start Week slate.
- There is no calendar-driven automatic “create next season” for MVP. Participants and Pool roles cannot bootstrap.
- Until a season is Available, Create Pool stays disabled with a clear empty state — not an error or incident banner.
- Re-running bootstrap for an already Available season is a no-op seed plus priority schedule resync, not a second season identity.

### Release sequencing

1. Deploy **Convex schema and functions** to Production first. Changes must be backward-compatible: additive schema; dual-read or feature-flagged new writes.
2. Verify dispatcher, crons, bootstrap path, and health on Production before shipping the web app.
3. Deploy the **Next.js** app on Vercel Production second.
4. Never ship a frontend that requires a Convex mutation or query that is not already live.
5. Breaking schema or query renames require a two-step compatibility window — never a single cutover on a game day.
6. Prefer **no Production deploys during an active game window** (kickoff, live, or confirmation work due) unless fixing an open Operator Incident.

### Rollback

- **Next.js / Vercel:** rollback to the previous Production deployment is the primary undo for UI and client bugs.
- **Convex functions:** redeploy the last known-good function bundle. Do not use Convex “pause deployment” as normal rollback — it blocks the whole app and skips crons.
- **Schema / data:** no automated down-migration for MVP. Production schema stays additive. A bad write path is disabled by redeploy or flag and repaired with audited resync or replay — not a database restore. Custom backup/restore remains out of MVP per [Define the production trust and recovery standard](./11-define-production-trust-recovery-standard.md).
- **Provider / sync misconfig:** turn the Production Sync Gate off, fix credentials or configuration, then audited priority resync. Never reopen Pick Locks or invent results.
- Rollback success means prior healthy UI and functions restored, the last consistent official Scoring Revision held, and the Operator Incident updated — not rewinding participant picks.

### Production Sync Gate

- Production has an application-level **Sync Gate**, default **ON** after successful Season Bootstrap.
- Only the allowlisted Production Operator may turn it OFF or ON, with step-up verification and an audited reason (same class as recovery mutations).
- While OFF: the dispatcher claims no new provider fetch work; Pick Locks, ordinary queries, and scoring of already-Verified Results continue; participant banners follow the settled Stale / Provider Exception rules if freshness breaks.
- Turning ON resumes ordinary cadence and may optionally enqueue a coalesced priority schedule or live resync.
- This gate is the normal incident control — not pausing the Convex deployment.

### Dev and Preview isolation

- Dev **Sync Gate defaults OFF**. Enabling sync is a manual Dev-only action for testing; it auto-disables after a short TTL (about two hours) or on deploy reset so idle Preview cannot poll TheSportsDB overnight.
- Dev never opens production Operator Incidents or pages the production Sentry alert channel. Dev may use a separate Sentry project or environment with alerts muted or low-priority only.
- Dev data is disposable: wipe and reset are allowed anytime; there is no durability promise and no copying of Production Pool data into Dev.
- Production Operator allowlist and recovery mutations exist only against Production Convex. Dev may use a stub operator path to exercise banners and resync UX without production audit retention commitments.

### First Production go-live

Production opens to real participants only after this ordered cutover:

1. Clerk Production, Convex Production, Vercel Production, Sentry Production, and TheSportsDB Production key are provisioned and separated from Dev.
2. Convex functions and schema are deployed; the Production Operator allowlist is set.
3. Production Sync Gate is ON; Season Bootstrap has completed and the season is Available.
4. Next.js Production is verified against that Convex deployment (sign-in, empty My Pools, Create Pool enabled).
5. Smoke: create a throwaway Owner Pool, invite join, submit a pick against an unlocked slate, and confirm lock and scoring paths are wired (archive or discard afterward).
6. Only then share access with real participants.

No soft-launch half-state where Create Pool is up before the season is Available. The very first Production cutover does not occur during an active NFL game window.
