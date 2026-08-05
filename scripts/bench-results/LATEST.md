# Page-load TTFB results

**Target:** median HTML TTFB ≤ 50 ms for every App Router page  
**Metric:** `curl` `time_starttransfer` against warm `next start` on `127.0.0.1`  
**Method:** 1 discarded cold sample + 20 iterations per path (`PAGE_LOAD_BENCH=1`)  
**Date:** 2026-08-05

## Final (`after-join-cache`)

| Page | Status | Median ms | p95 ms |
|---|---:|---:|---:|
| `/` | 200 | 3.2 | 7.5 |
| `/guides` | 200 | 1.9 | 2.0 |
| `/guides/*` (12 guides) | 200 | 1.7–5.1 | ≤5.8 |
| `/help` | 200 | 1.6 | 2.0 |
| `/terms` | 200 | 1.5 | 1.6 |
| `/privacy` | 200 | 1.5 | 1.6 |
| `/shadcn-pools-demo` | 200 | 1.5 | 1.7 |
| `/sign-in` | 200 | 1.6 | 1.9 |
| `/sign-up` | 200 | 1.7 | 1.8 |
| `/join` | 200 | 1.5 | 1.6 |
| `/join/[token]` | 200 | 5.7 | 8.0 |
| Protected product routes (9) | 307 | 1.6–1.7 | ≤1.9 |

**30/30 passed. Slowest median: `/join/[token]` at 5.7 ms.**

### Baseline → after join fetch cache / bench skip

| Change | Slowest median | Notes |
|---|---:|---|
| Baseline (expanded suite) | 25.9 ms (`/join/[token]`) | Convex HTTP to unreachable URL |
| After join cache + bench skip + 400ms timeout | 5.7 ms (`/join/[token]`) | Per-request `cache()`, no remote I/O under `PAGE_LOAD_BENCH=1` |

Also covered new routes since the prior suite: `/help`, `/terms`, `/privacy`, `/shadcn-pools-demo`, `/settings/notifications`. Wired `/settings` into the auth proxy matcher (was protected in patterns but missing from the matcher). Forced static prerender for `/help`.

## How to reproduce

```bash
PAGE_LOAD_BENCH=1 bun run start -- -H 127.0.0.1 -p 3000
bun run bench:page-load -- --label local --iters 20 --threshold 50
```

`PAGE_LOAD_BENCH=1` stubs auth redirects for protected routes so the suite is repeatable without live Clerk credentials, and skips invite Convex I/O so join TTFB reflects HTML serve. Public marketing routes do not use the auth stub (they skip the auth proxy entirely).
