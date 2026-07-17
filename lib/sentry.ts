/**
 * Shared Sentry types / Convex sink re-exports for Next.js call sites that
 * need the same capture shape as Convex (tests, operator signals).
 *
 * Prefer `@sentry/nextjs` (`Sentry.captureException`) for App Router errors —
 * the SDK is initialized in `instrumentation-client.ts` / `sentry.*.config.ts`.
 * Production DSN: `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN`.
 */

export {
  captureException,
  captureIncidentSignal,
  mayPageProduction,
  sentrySink,
  type SentryCapture,
  type SentryLevel,
} from "@/convex/lib/sentry";
