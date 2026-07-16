# 02 — Bootstrap an Available Season

**What to build:** The allowlisted Production Operator can run Season Bootstrap on a Convex deployment so NFL Teams and the regular-season schedule are seeded from TheSportsDB through a normalized adapter. When bootstrap succeeds with at least one usable Start Week slate, the Pool Season becomes Available and Create Pool enables. Sync Gate defaults respect Production ON / Dev OFF. Clients never call the provider.

**Blocked by:** 01 — Authenticate adults into My Pools

**Status:** done

- [x] TheSportsDB shapes stop at the adapter; NFL Team and NFL Game identities are provider-independent
- [x] Season Bootstrap is audited, operator-only, and marks the season Available only after a successful schedule sync with a usable Start Week
- [x] Before Available, Create Pool stays disabled with a clear empty state (not an incident banner)
- [x] Sync Gate stops new provider fetch claims when OFF; locks and ordinary queries continue
- [x] Fixture-driven adapter tests cover normalization; no live provider calls in CI (acceptance scenarios 7, 28, 50)

## How to run Season Bootstrap (local / Dev)

1. Set operator allowlist on the Convex deployment (your Clerk `user_…` id or full `tokenIdentifier`):

```bash
bunx convex env set PRODUCTION_OPERATOR_CLERK_USER_ID user_XXXX
# or:
# bunx convex env set PRODUCTION_OPERATOR_TOKEN_IDENTIFIER "https://….clerk.accounts.dev|user_XXXX"
```

2. Env already set on Dev for this ticket:
   - `THESPORTSDB_API_KEY=123` (free tier)
   - `DEPLOYMENT_KIND=development` (Sync Gate defaults OFF after bootstrap)

3. Run live bootstrap via CLI (uses deploy credentials + operator env for audit actor):

```bash
bunx convex run bootstrap:runSeasonBootstrapCli '{"seasonLabel":"2025"}'
```

Authenticated operators can also call public `bootstrap:runSeasonBootstrap` from a signed-in session. Fixture path for tests: `runSeasonBootstrapNormalized`.

### Browse-ready Dev seed (no SportsDB)

Free-tier SportsDB often returns only preseason events, so Create Pool stays disabled. For local browsing without the provider:

1. Sign into the app once (creates your `participants` row).
2. Run:

```bash
bunx convex run seedDemo:seedDemoWorld '{"ownerClerkUserId":"user_XXXX"}'
```

This seeds an Available Season, NFL slate, fake members, and pools you own. Dev-only (`DEPLOYMENT_KIND=production` refuses).
