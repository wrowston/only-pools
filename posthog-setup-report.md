# PostHog post-wizard report

The wizard has completed a full client-side PostHog integration for **only-pools**, an NFL Survivor and Confidence pool app built with Next.js 16 App Router, Convex, and Clerk auth.

**What was set up:**
- `posthog-js` installed and initialized in `instrumentation-client.ts` (alongside Sentry) via the Next.js 15.3+ instrumentation pattern.
- Reverse-proxy rewrites added to `next.config.ts` so PostHog calls route through `/ingest` to avoid ad-blockers.
- `PostHogUserContext` component created and mounted in `app/layout.tsx` — calls `posthog.identify()` with the Clerk user ID whenever a user is signed in, and `posthog.reset()` on sign-out.
- 14 events instrumented across 4 client components covering the full pool lifecycle: creation, invite sharing, joining, picking, admin actions, and churn.
- A PostHog dashboard with 5 insights created covering conversion funnels, pick volume, growth, and churn signals.

## Events instrumented

| Event name | Description | File |
|---|---|---|
| `pool_created` | User successfully created a new pool from scratch. | `components/CreatePoolForm.tsx` |
| `pool_created_from_template` | User successfully created a new pool using a prior pool as a template. | `components/CreatePoolForm.tsx` |
| `invite_link_copied` | User copied a pool invite link to their clipboard after creating a pool. | `components/CreatePoolForm.tsx` |
| `invite_accepted` | User accepted a pool invite and joined the pool. | `components/JoinInviteView.tsx` |
| `returning_invite_accepted` | Returning participant accepted a personal returning invite and rejoined the pool. | `components/JoinReturningInviteView.tsx` |
| `survivor_pick_saved` | User selected and autosaved their Survivor pick for the current week. | `components/WeekBoardView.tsx` |
| `confidence_pick_saved` | User selected a winner for a Confidence pick game. | `components/WeekBoardView.tsx` |
| `pool_invite_retrieved` | Pool admin retrieved or created the reusable pool invite link. | `components/PoolPanelView.tsx` |
| `pool_invite_rotated` | Pool admin rotated the pool invite link, invalidating the previous one. | `components/PoolPanelView.tsx` |
| `pool_invite_link_copied` | Pool admin copied the retrieved pool invite link to their clipboard. | `components/PoolPanelView.tsx` |
| `pool_archived` | Pool owner archived a pool, making it read-only. | `components/PoolPanelView.tsx` |
| `pool_restored` | Pool owner restored an archived pool. | `components/PoolPanelView.tsx` |
| `pool_left` | Member left a pool voluntarily. | `components/PoolPanelView.tsx` |
| `member_removed` | Admin removed a member from the pool. | `components/PoolPanelView.tsx` |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- **Dashboard**: [Analytics basics (wizard)](https://us.posthog.com/project/517178/dashboard/1865559)
- **Pool creation funnel** (pool_created → invite_link_copied): [View insight](https://us.posthog.com/project/517178/insights/aWch2iTj)
- **Join funnel** (invite_accepted → survivor_pick_saved): [View insight](https://us.posthog.com/project/517178/insights/6ietEpuo)
- **Picks per week** (survivor & confidence pick volume): [View insight](https://us.posthog.com/project/517178/insights/diYpQfGx)
- **Pool growth: created vs joined** (weekly pool creation and invite acceptance): [View insight](https://us.posthog.com/project/517178/insights/XBXbGjUR)
- **Churn signals** (pools left, members removed, pools archived): [View insight](https://us.posthog.com/project/517178/insights/ISmqH4rh)

## Verify before merging

- [ ] Run a full production build (the wizard only verified the files it touched) and fix any lint or type errors introduced by the generated code.
- [ ] Run the test suite — call sites that were rewritten or instrumented may need updated mocks or fixtures.
- [ ] Add `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` and `NEXT_PUBLIC_POSTHOG_HOST` to `.env.example` and any monorepo/bootstrap scripts so collaborators know what to set.
- [ ] Wire source-map upload (`posthog-cli sourcemap` or your bundler's upload step) into CI so production stack traces de-minify.
- [ ] Confirm the returning-visitor path also calls `identify` — the `PostHogUserContext` component calls `posthog.identify()` on every render where a Clerk user is loaded, which covers both fresh logins and returning sessions, but verify this is working correctly by checking that identified events appear in PostHog with the correct person.

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.
