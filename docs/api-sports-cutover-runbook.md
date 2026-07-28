# API-Sports cutover and rehearsal runbook

This runbook is intentionally fail-closed. Run the destructive rehearsal only
against an identified **development** Convex deployment. Do not pass `--prod`,
do not delete production data, and do not enable the production Sync Gate.

Production activation remains prohibited until a Production Operator has
completed a human-observed preseason qualification window and the current
dataset has a passing, non-stale qualification decision.

## Release identities and operator record

The contraction is a two-schema deployment:

1. `dde9364` — compatibility schema, writer lock, bounded legacy migration,
   and the live-qualified nullable-placeholder decoder.
2. `d877e06` — strict provider-neutral schema and runtime.
3. `a85f30b` — the same strict tree with the base compatibility migration
   recorded as ancestry.

Use `a85f30b` rather than `d877e06` for the strict rehearsal unless release
engineering explicitly needs the unmerged strict commit. Before starting,
record the approved ticket-48 release SHA that descends from `a85f30b`.

```sh
export TICKET_48_RELEASE_SHA='<approved-pr-head-sha>'
git merge-base --is-ancestor d6493c9 a85f30b
git diff --quiet d877e06 a85f30b
git merge-base --is-ancestor a85f30b "$TICKET_48_RELEASE_SHA"
git merge-base --is-ancestor dde9364 "$TICKET_48_RELEASE_SHA"
```

All three commands must exit zero. Record:

- development deployment reference;
- season year;
- compatibility, strict, and ticket-48 SHAs;
- Production Operator Clerk user id;
- UTC start time;
- rehearsal snapshot path;
- stage id, activation request id, and final verification report.

## Hard preflight

Set shell variables to explicit, reviewed values. `DEV_DEPLOYMENT` must name a
development deployment and must never be `prod` or a production deployment
reference.

```sh
export DEV_DEPLOYMENT='<reviewed-development-deployment>'
export SEASON_YEAR='2026'
export TICKET_48_RELEASE_SHA='<approved-pr-head-sha>'
export CUTOVER_OPERATOR_IDENTITY_JSON='<authenticated-operator-identity-json>'
```

The identity JSON is used only for authenticated CLI reads and bounded
migration calls. Keep it out of source control and terminal transcripts.

Confirm the target and current gate before any deployment:

```sh
bunx convex env get DEPLOYMENT_KIND --deployment "$DEV_DEPLOYMENT"
bunx convex run --deployment "$DEV_DEPLOYMENT" --inline-query \
  'const gate = await ctx.db.query("syncGate").withIndex("by_key", q => q.eq("key", "deployment")).unique(); return { enabled: gate?.enabled ?? false };'
```

The first command must print `development`; the second must return
`{"enabled":false}`. Stop on any other result.

Export a recoverable development snapshot before the clean activation:

```sh
bunx convex export \
  --deployment "$DEV_DEPLOYMENT" \
  --include-file-storage \
  --path '<approved-rehearsal-snapshot.zip>'
```

Run local release gates from a clean worktree:

```sh
bun install --frozen-lockfile
bunx convex codegen
bun run test
bun run test:e2e
bun run lint
bun run typecheck
bun run build
git diff --check
```

Do not continue if any gate fails or if generated/stale framework artifacts
make typechecking untrustworthy.

## Install configuration without exposing the API key

Install the API-Sports credential interactively. Omitting the value keeps it
out of shell history and this runbook:

```sh
bunx convex env set API_SPORTS_KEY --deployment "$DEV_DEPLOYMENT"
```

Set the non-secret deployment controls:

```sh
bunx convex env set SPORTS_DATA_PROVIDER api-sports --deployment "$DEV_DEPLOYMENT"
bunx convex env set DEPLOYMENT_KIND development --deployment "$DEV_DEPLOYMENT"
bunx convex env set CLEAN_ACTIVATION_DEPLOYMENT_ID only-pools-development --deployment "$DEV_DEPLOYMENT"
bunx convex env set SENTRY_INCIDENT_EMAIL_ENABLED false --deployment "$DEV_DEPLOYMENT"
```

Install the Production Operator allowlist interactively as well:

```sh
bunx convex env set PRODUCTION_OPERATOR_CLERK_USER_ID --deployment "$DEV_DEPLOYMENT"
```

Verify names and non-secret values. Use `--names-only`; never save `env list`
output because it includes secret values.

```sh
bunx convex env list --names-only --deployment "$DEV_DEPLOYMENT"
bunx convex env get SPORTS_DATA_PROVIDER --deployment "$DEV_DEPLOYMENT"
bunx convex env get DEPLOYMENT_KIND --deployment "$DEV_DEPLOYMENT"
bunx convex env get CLEAN_ACTIVATION_DEPLOYMENT_ID --deployment "$DEV_DEPLOYMENT"
bunx convex env get SENTRY_INCIDENT_EMAIL_ENABLED --deployment "$DEV_DEPLOYMENT"
```

## Verify Sentry email routing

The Sentry alert rule must match:

- `channel=operator_incident`;
- `incident_type=stale_in_window`;
- `notification_channel=email`;
- `signal` in `opened`, `escalated`, or `resolved`.

Use Sentry's **Send test notification** control for the Production Operator
email integration. Record the UTC send time, UTC receipt time, recipient
integration, and alert-rule link. Do not simulate a production incident and do
not paste a DSN into a command or issue. Keep the deployment flag false until
the email is received. Only then set it true:

```sh
bunx convex env set SENTRY_INCIDENT_EMAIL_ENABLED true --deployment "$DEV_DEPLOYMENT"
```

If the test email is not received, leave the flag false and stop.

## Deploy compatibility code and perform clean development activation

Create a detached worktree so the exact compatibility source is reviewable:

```sh
git worktree add --detach '<compatibility-worktree>' dde9364
```

From that worktree, point an env file containing only the reviewed
`CONVEX_DEPLOYMENT` reference at the development deployment, then push once:

```sh
bunx convex dev \
  --once \
  --typecheck enable \
  --tail-logs disable \
  --env-file '<development-deployment-env-file>'
```

Open `/operator` on the matching development application:

1. Fetch and stage the selected season through API-Sports.
2. Require a valid report with exactly 32 teams, 272 regular-season games,
   Weeks 1–18, 32 team aliases, 272 game aliases, and zero failures.
3. Complete Clerk reverification and Production Operator Step-up Verification.
4. Request the separate, deployment-bound clean activation confirmation.
5. Compare its deletion, rebuild, and preserved-category plan to the durable
   report.
6. Type the generated confirmation text exactly and activate once.
7. Save the durable stage and activation report JSON.

The authorized rebuild counts are one Pool Season, 32 NFL Teams, 272 NFL
Games, 32 current API-Sports team aliases, 272 current API-Sports game aliases,
and 272 schedule-history rows. The deletion report may contain only tables
whose policy is `delete`; the preserved list must include the Sync Gate,
Production Operator audit history, external authentication/operator
configuration, checked-in NFL catalog, staging history, provider reliability,
and provider evidence/recent diagnostics.

Immediately verify that activation did not turn the gate on:

```sh
bunx convex run --deployment "$DEV_DEPLOYMENT" --inline-query \
  'const gate = await ctx.db.query("syncGate").withIndex("by_key", q => q.eq("key", "deployment")).unique(); return { rowPresent: gate !== null, enabled: gate?.enabled ?? false };'
```

## Lock writers and drain compatibility residue

Refresh Step-up Verification in `/operator`, then run bounded batches. Each
batch is capped at 50 rows and 4 MiB read:

```sh
bunx convex run legacyContractionMigration:runBatch \
  '{"batchSize":50}' \
  --deployment "$DEV_DEPLOYMENT" \
  --identity "$CUTOVER_OPERATOR_IDENTITY_JSON"
```

Repeat until the response has `readyToComplete:true`. If Step-up Verification
expires, refresh it in the same Clerk session and continue. Then complete once:

```sh
bunx convex run legacyContractionMigration:complete \
  '{}' \
  --deployment "$DEV_DEPLOYMENT" \
  --identity "$CUTOVER_OPERATOR_IDENTITY_JSON"
```

Require `phase:"complete"` and `completed:true`. Do not invoke `complete`
again: a later invocation deliberately starts a full re-audit. Save the latest
append-only progress row:

```sh
bunx convex run --deployment "$DEV_DEPLOYMENT" --inline-query \
  'return await ctx.db.query("operatorAuditEvents").withIndex("by_action_and_atMs", q => q.eq("action", "legacy_contract_migration_progress_v2")).order("desc").first();'
```

The first migration batch permanently forces the Sync Gate OFF and installs a
durable writer lock. Re-check the gate before strict deployment.

## Deploy strict code, then the ticket-48 release

Deploy `a85f30b` to the same development deployment with the same one-shot
command used above. Do not skip directly from pre-compatibility code to the
strict schema. Then deploy the approved ticket-48 release SHA, which must
descend from `a85f30b`.

After each deploy, run:

```sh
bunx convex run --deployment "$DEV_DEPLOYMENT" --inline-query \
  'const gate = await ctx.db.query("syncGate").withIndex("by_key", q => q.eq("key", "deployment")).unique(); return { enabled: gate?.enabled ?? false };'
```

Both results must remain `false`.

## Development smoke rehearsal

Use only the development deployment. A Production Operator may briefly enable
development competitive sync from the qualification panel, exercise the
provider-backed flows, and then disable it again. Never use this exception in
production.

Record durable evidence for each item:

1. Schedule refresh creates API-Sports schedule evidence.
2. Live refresh creates projected live evidence.
3. A coherent terminal observation becomes Verified immediately.
4. Changed terminal evidence records a Corrected Result candidate/application.
5. A downstream dependency creates and resolves a Scoring Hold.
6. A stepped-up operator pins and releases a result override.
7. Provider reliability records quota admission/outcome without exposing
   credentials.
8. Surface health records a successful freshness observation.
9. Diagnostic retention completes a bounded cleanup generation.

Disable development sync immediately after the smoke window. The final gate
must be OFF.

Run the authenticated, read-only, machine-readable verification and save its
JSON:

```sh
bunx convex run cutoverVerification:getOperatorCutoverVerification \
  "{\"seasonYear\":$SEASON_YEAR}" \
  --deployment "$DEV_DEPLOYMENT" \
  --identity "$CUTOVER_OPERATOR_IDENTITY_JSON"
```

Require:

- `status:"pass"` and `developmentCutoverReady:true`;
- `productionActivationAllowed:false`;
- 32 teams, 272 games, Weeks 1–18;
- exactly one unique current API-Sports alias per team and game;
- exactly one matching schedule-history row per game;
- Sync Gate OFF;
- preserved activation/audit/configuration evidence present;
- `incompatibleOperationalResidue:0`;
- all nine `smokeEvidence` entries observed after activation.

## Production hold point

Stop here. A successful development rehearsal does not authorize production.
Before any future production activation, a human must:

1. register the exact preseason test window in the qualification panel;
2. observe API-Sports score/final timing against an independent reference;
3. attest completeness and finalize the window;
4. obtain a current passing decision for the exact production Pool Season
   dataset and policy version;
5. obtain explicit release approval for production deletion and Sync Gate
   enablement.

Without all five, do not deploy the compatibility migration to production, do
not request clean production activation, do not delete production data, and do
not enable the production Sync Gate.

## Rollback boundary

- Before exact clean-activation confirmation: redeploying the prior SHA is a
  code rollback; no domain deletion has committed.
- After clean activation: the Convex mutation is atomic, but deleted
  development application data can be recovered only from the recorded export
  or by intentionally rebuilding the development deployment.
- After the migration lock: legacy provider writers are permanently disabled
  for that deployment. Do not roll code backward across the lock.
- After strict-schema deployment: rollback is forward-only to the last
  reviewed strict SHA. Restoring legacy code against contracted data is not
  supported.
- Any production rollback plan requires a separately approved production
  snapshot/restore exercise. This runbook authorizes no production mutation.
