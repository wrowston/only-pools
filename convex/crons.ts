import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * One-minute dispatcher cron (settled schedule/cost controls).
 * Invokes a short mutation that claims due sync work under Sync Gate + budget.
 * The dispatcher performs no provider I/O; fetch actions are scheduled separately
 * when claims succeed (or tests inject observations directly).
 *
 * Enablement: Sync Gate must be ON (Production default after Season Bootstrap;
 * Dev defaults OFF). Set DEPLOYMENT_KIND=production for prod gate default.
 * Production provider fetches require SPORTS_DATA_PROVIDER=api-sports and
 * API_SPORTS_KEY. Schedule and live claims have no fallback provider.
 */
const crons = cronJobs();

crons.interval(
  "dispatch-sync-work",
  { minutes: 1 },
  internal.syncLive.dispatchSyncWork,
  {},
);

crons.interval(
  "watch-api-sports-live-ingestion",
  { seconds: 30 },
  internal.liveIngestionWatchdog.evaluate,
  {},
);

crons.interval(
  "cleanup-provider-diagnostics",
  { hours: 6 },
  internal.providerEvidence.cleanupExpiredDiagnostics,
  {},
);

crons.interval(
  "purge-expired-help-data",
  { hours: 1 },
  internal.helpRetention.purgeExpiredHelpDataCron,
  {},
);

/**
 * Keep pick-reminder jobs aligned with current earliest kickoffs.
 * Delivery ledger prevents double-sends after reschedule.
 */
crons.interval(
  "ensure-pick-reminders",
  { hours: 1 },
  internal.notificationPickReminders.ensureUpcomingPickReminders,
  {},
);

/**
 * Tuesday 14:00 UTC ≈ 10:00 America/New_York during EDT.
 * EST (UTC−5) lands at 9:00 a.m. — accepted for v1.
 */
crons.cron(
  "weekly-notification-summary",
  "0 14 * * 2",
  internal.notificationWeeklySummary.sendWeeklySummaries,
  {},
);

export default crons;
