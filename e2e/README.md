# Critical-path E2E tests

The Playwright suite exercises the authenticated Survivor journey through the
real UI:

1. A verified owner creates an active Pool.
2. The owner copies an invite link.
3. A second verified participant accepts the invite.
4. The owner saves a pick and the member sees only its hidden state.
5. Kickoff locks and reveals the pick.
6. A verified final result scores the pick.
7. Standings show the winning pick and alive count.

## Run locally

The suite requires the development values already used by the app:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `CONVEX_DEPLOYMENT`
- `NEXT_PUBLIC_CONVEX_URL`

Install Chromium once, then run the suite:

```sh
bunx playwright install chromium
bun run test:e2e
```

Use `bun run test:e2e:headed` to watch the browser or
`bun run test:e2e:ui` for Playwright UI mode.

The setup project creates or reuses two Clerk test users, signs them in, saves
their browser state under the ignored `e2e/.auth/` directory, and seeds an
available NFL slate in the configured Convex development deployment. The
production backend refuses the seed mutation, and Clerk's test helper refuses
production keys.

The seed reset removes disposable demo Pools whose names begin with `Seed ·`.
Do not point this suite at shared or production data.

## CI

Provide the four development secrets above and install Chromium before running
`bun run test:e2e`. The default reporter writes an HTML report to the ignored
`playwright-report/` directory and retains traces, screenshots, and video on
failure.
