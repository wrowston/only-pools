/**
 * Structured server-side logging for the Next.js runtime (proxy / RSC /
 * Server Actions). Output goes to the host process logs (e.g. Vercel
 * Runtime Logs) — never to the browser.
 *
 * Prefer `@/convex/lib/log` from Convex functions. Keep Hidden Pick values,
 * invite credentials, and API keys out of fields.
 */

export {
  createLogger,
  errorMessage,
  redactProviderUrl,
  sanitizeLogFields,
  shouldLog,
  type LogFields,
  type LogLevel,
  type Logger,
} from "@/convex/lib/log";
