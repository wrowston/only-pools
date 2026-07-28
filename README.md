# Only Pools

Private NFL Survivor and Confidence pools for verified adults.

**Product:** [tryonlypools.com](https://tryonlypools.com)

Create a pool, share one invite, make picks, and follow standings in one place. No buy-ins, prizes, or wagering—prediction competition only.

## Purpose

Only Pools is a focused Splash Sports alternative for private groups. Commissioners run Survivor or Confidence pools for the NFL regular season; participants autosave picks, locks close at kickoff or weekly cutoff, and standings update from verified results.

Participants must be 18+, with verified email and phone via Clerk.

## Business logic

Canonical vocabulary lives in [`CONTEXT.md`](./CONTEXT.md). User-facing guides live under [`content/guides/`](./content/guides/) and at `/guides` on the site.

### Pool types

| Type | Rules |
|------|--------|
| **Survivor** | One team per week. Win stays Alive; loss, tie, or missed pick eliminates. Each team usable once per pool. |
| **Confidence** | Pick every required game and assign unique confidence values. Points accumulate; weekly tiebreaker uses the last game’s combined score. |

Pool type is fixed at creation. Each pool has one Pool Season (NFL regular season only), one ruleset, and its own membership.

### Lifecycle (short version)

1. **Season Bootstrap** (Production Operator) seeds teams and schedule; season becomes Available.
2. **Create Pool** — choose type, Start Week, Pick Lock mode (`gameKickoff` or `weeklyCutoff`).
3. **Invite** — reusable bearer Pool Invite; join requires auth + contact disclosure acceptance.
4. **Picks** — autosave on the Week Board; Hidden until Pick Lock; other games stay open under per-game lock.
5. **Results & scoring** — Verified Results score immediately; projected/live scores are preview only. Corrections, Scoring Holds, and operator overrides exist for repair.
6. **Complete / Archive** — terminal scoring closes competition; archive is a reversible read-only overlay.

### Roles

- **Pool Owner** — rules (pre-freeze), invites, roles, archive/restore, ownership transfer
- **Pool Admin** — ordinary invites and member removal
- **Pool Member** — compete without admin authority
- **Production Operator** — allowlisted ops (bootstrap, sync gate, incidents, scoring holds); never edits picks

### Multi-entry

Memberships are seats; competitive units are **pool entries** (`maxEntriesPerUser` 1–10). Picks and standings key off `entryId`.

## Tech stack

| Layer | Choice | Where |
|-------|--------|--------|
| App | Next.js 16 (App Router), React 19 | [`app/`](./app/) |
| UI | Tailwind CSS 4, shadcn / Base UI | [`components/`](./components/), [`app/globals.css`](./app/globals.css) |
| Backend / DB | [Convex](https://convex.dev) | [`convex/`](./convex/), schema in [`convex/schema.ts`](./convex/schema.ts) |
| Auth | Clerk | [`proxy.ts`](./proxy.ts), [`lib/authRoutes.ts`](./lib/authRoutes.ts), [`convex/auth.config.ts`](./convex/auth.config.ts) |
| Effects / I/O | Effect 3.x | [`convex/effect/`](./convex/effect/), [`lib/effect/`](./lib/effect/) |
| Sports data | API-Sports (production) | [`convex/providers/apiSports/`](./convex/providers/apiSports/), [`convex/providers/sportsData/`](./convex/providers/sportsData/) |
| Analytics | PostHog | [`instrumentation-client.ts`](./instrumentation-client.ts) |
| Errors | Sentry | [`instrumentation.ts`](./instrumentation.ts), `sentry.*.config.ts` |
| Tests | Vitest, Playwright | `*.test.ts`, [`e2e/`](./e2e/) |
| Package manager | Bun | [`package.json`](./package.json), `bun.lock` |

Agent conventions for Next.js, Convex, and Effect: [`AGENTS.md`](./AGENTS.md).

## Repository map

```
app/
  (marketing)/     Landing, guides, Clerk sign-in/up
  (app)/           Authenticated shell: my-pools, pools, join, operator
components/        Pool UI, landing, operator panels, shadcn primitives
content/guides/    MDX product guides
convex/            Schema, queries, mutations, actions, crons, providers
  lib/             Domain helpers (rules, locks, scoring, auth)
  providers/       Sports-data adapters (API-Sports, in-memory for tests)
  effect/          Effect workflows for provider I/O
docs/              Operator runbooks + agent docs
lib/               Shared Next helpers (auth routes, guides, Effect runtime)
e2e/               Playwright end-to-end tests
CONTEXT.md         Domain glossary (source of truth for product language)
```

### Important app routes

| Route | Purpose |
|-------|---------|
| `/` | Marketing |
| `/guides` | Help docs |
| `/my-pools` | Post-auth home |
| `/join/[token]` | Accept Pool Invite |
| `/pools/[poolId]/…` | Board, standings, pool admin |
| `/operator` | Production Operator console |

### Important Convex modules

| Area | Files |
|------|--------|
| Pools / membership | `pools.ts`, `participants.ts`, `invites.ts`, `membershipAdmin.ts`, `poolTemplates.ts` |
| Picks | `survivorPicks.ts`, `confidencePicks.ts` |
| Scoring | `survivorScoring.ts`, `confidenceScoring.ts`, `scoringHolds.ts`, `resultOverrides.ts` |
| Season / sync | `bootstrap.ts`, `sync*.ts`, `crons.ts`, `liveIngestionWatchdog.ts` |
| Ops | `incidents.ts`, `providerReliability.ts`, `cutoverVerification.ts` |

## Local development

Requires Bun, a Convex project, and Clerk (plus API-Sports for live schedule sync).

```bash
bun install
bun run dev          # Next.js
npx convex dev       # Convex (separate terminal if not already running)
```

Useful scripts:

```bash
bun run test         # Vitest
bun run test:e2e     # Playwright (pushes Convex once, then e2e)
bun run typecheck
bun run lint
```

Environment variables are loaded from `.env.local` (not committed). Typical needs include Clerk, Convex, PostHog, Sentry, and `API_SPORTS_KEY` / `SPORTS_DATA_PROVIDER` for production-like sync.

## Documentation

| Doc | Contents |
|-----|----------|
| [`CONTEXT.md`](./CONTEXT.md) | Domain glossary and business rules |
| [`content/guides/`](./content/guides/) | Participant / commissioner guides |
| [`docs/api-sports-cutover-runbook.md`](./docs/api-sports-cutover-runbook.md) | Provider cutover |
| [`docs/api-sports-live-watchdog.md`](./docs/api-sports-live-watchdog.md) | Live ingestion watchdog |
| [`docs/agents/`](./docs/agents/) | Issue tracker, triage labels, domain pointers |
| [`AGENTS.md`](./AGENTS.md) | Coding conventions for agents |

## License

Private. All rights reserved.
