# Game-day shell smoke — scenarios 45–48

Manual / selective automation checklist for ticket 14
([acceptance contract](../.scratch/nfl-pool-mvp-specification/issues/13-define-implementation-acceptance-contract.md)).

Automated seams already covered:

- `lib/gameDayShell.test.ts` — 900px chrome classes, nav hierarchy, back targets, live-region allowlist, 44px class
- `lib/pickPresentation.test.ts` — Pick won / Pick lost text + marks (not color-only)
- `convex/pools.test.ts` — Week Board scoped to one week; My Pools has no pick dump

## 45 — Navigation contract

- [ ] Sign in → **My Pools** is home (`/my-pools`)
- [ ] Open a membership → lands on **Week Board** (`/pools/{poolId}`)
- [ ] Phone (&lt;900px): chips show **Board · Standings · Pool** (not equal-weight bottom tabs)
- [ ] Desktop (≥900px): same hierarchy in left sidebar; Week Board shows context rail
- [ ] Standings / Pool back control returns to Week Board; Board back returns to My Pools
- [ ] Pool picker in shell chrome switches memberships (preserves Board / Standings / Pool); All pools still returns to My Pools

## 46 — Keyboard & touch

- [ ] Tab / Shift+Tab / Enter / Space complete Board, Standings, and Pool flows
- [ ] Team pick targets and nav chips are ≥44×44px (`min-h-11` / `min-w-11`)
- [ ] Focus ring visible (ink plum) on interactive controls
- [ ] With `prefers-reduced-motion: reduce`, shell has no required motion to understand state
- [ ] Settled picks show **Pick won** / **Pick lost** text + mark, not color alone

## 47 — SaveTrust + live regions

- [ ] Successful autosave shows quiet inline **Saved** (no toast)
- [ ] Failed save shows inline error + retry path on the control
- [ ] `aria-live="polite"` only on SaveTrust and StatusBanner (`data-live-region`)
- [ ] Live score ticks do **not** announce via aria-live

## 48 — Scoped loads / interactivity

- [ ] My Pools / Week Board / Standings remain usable without loading entire-season picks
- [ ] While projected scores update, pick controls stay interactive (no full-page blocking overlay)

## Selective automation hints

```bash
bun run test lib/gameDayShell.test.ts lib/pickPresentation.test.ts
bun run test convex/pools.test.ts
# Optional Playwright: resize viewport across 899/900, assert
# [data-shell-breakpoint="900"], [data-shell-chrome="mobile-chips"],
# [data-shell-chrome="context-rail"], [data-live-region]
```
