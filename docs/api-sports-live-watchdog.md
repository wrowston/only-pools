# API-Sports live-ingestion watchdog alerts

The production watchdog emits Sentry events through the existing Convex
delivery seam. Configure one Sentry alert rule for events with:

- `channel=operator_incident`
- `incident_type=stale_in_window`
- `notification_channel=email`
- `signal` in `opened`, `escalated`, or `resolved`

Route the rule to the Production Operator email integration. Keep all three
signals in the rule: warning openings use Sentry `warning`, direct critical
openings and escalations use `error`, and healthy recovery uses `info`.

Set `SENTRY_INCIDENT_EMAIL_ENABLED=true` in production after the Sentry rule
and email integration are ready. The application adds
`notification_channel=email` only when that flag is exactly `true`,
`DEPLOYMENT_KIND=production`, and a Sentry DSN is configured. A production DSN
without the explicit flag still captures and delivers ordinary Sentry events,
but does not opt incident signals into the email rule. Development and preview
captures remain available to local tests and logs, but are not scheduled for
production delivery even if the flag and DSN are present. The delivery action
repeats the production environment check before any network request.
