# Page-load TTFB results

**Target:** median HTML TTFB ≤ 50 ms for every App Router page  
**Metric:** `curl` `time_starttransfer` against warm `next start` on `127.0.0.1`  
**Method:** 1 discarded cold sample + 20 iterations per path (`PAGE_LOAD_BENCH=1`)  
**Date:** 2026-07-18

## Final (`after-layout-split`)

| Page | Status | Median ms | p95 ms |
|---|---:|---:|---:|
| `/` | 200 | 2.2 | 3.0 |
| `/guides` | 200 | 1.7 | 1.8 |
| `/guides/*` (12 guides) | 200 | 1.6–1.8 | ≤2.1 |
| `/sign-in` | 200 | 1.6 | 1.8 |
| `/sign-up` | 200 | 1.6 | 4.1 |
| Protected product routes (9) | 307 | 1.5–1.7 | ≤2.4 |

**25/25 passed. Slowest median: `/` at 2.2 ms.**

## How to reproduce

```bash
PAGE_LOAD_BENCH=1 bun run start -- -H 127.0.0.1 -p 3000
bun run bench:page-load -- --label local --iters 20 --threshold 50
```

`PAGE_LOAD_BENCH=1` stubs auth redirects for protected routes so the suite is repeatable without live Clerk credentials. Public routes do not use the stub (they skip the auth proxy entirely).
