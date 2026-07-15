/**
 * Client/Next Sentry wiring for MVP exception channel.
 *
 * Production DSN is a human deploy follow-up (`SENTRY_DSN` /
 * `NEXT_PUBLIC_SENTRY_DSN`). Without a DSN this is a no-op recorder.
 * Preview/Dev never page production — see `convex/lib/sentry.ts`.
 */

export {
  captureException,
  captureIncidentSignal,
  mayPageProduction,
  sentrySink,
  type SentryCapture,
  type SentryLevel,
} from "@/convex/lib/sentry";
