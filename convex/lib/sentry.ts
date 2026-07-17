/**
 * Sentry sink for MVP exception + Operator Incident signals.
 *
 * Without SENTRY_DSN / NEXT_PUBLIC_SENTRY_DSN the sink is a no-op recorder
 * that tests can assert was called. Dev/Preview never page production —
 * delivery is gated by `pagesProduction` and flushed via
 * `enqueueSentryDelivery` in `convex/sentry.ts`.
 */

import { resolveDeploymentKind } from "./syncGate";

export type SentryLevel = "info" | "warning" | "error" | "fatal";

export type SentryCapture = {
  message: string;
  level: SentryLevel;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  /** True only when this capture would page the production alert channel. */
  pagesProduction: boolean;
  atMs: number;
};

type SentrySink = {
  captures: SentryCapture[];
  capture: (event: Omit<SentryCapture, "pagesProduction" | "atMs"> & {
    atMs?: number;
  }) => SentryCapture;
  reset: () => void;
};

function createSink(): SentrySink {
  const captures: SentryCapture[] = [];
  return {
    captures,
    capture(event) {
      const env = process.env as Record<string, string | undefined>;
      const kind = resolveDeploymentKind(env);
      const dsn = env.SENTRY_DSN?.trim() || env.NEXT_PUBLIC_SENTRY_DSN?.trim();
      const isProduction = kind === "production";
      // Dev/Preview must never page production — even if a DSN is present.
      const pagesProduction = isProduction && Boolean(dsn);

      const record: SentryCapture = {
        message: event.message,
        level: event.level,
        tags: {
          ...(event.tags ?? {}),
          deployment_kind: String(kind),
          ...(pagesProduction ? { alert_channel: "production" } : {}),
        },
        extra: event.extra,
        pagesProduction,
        atMs: event.atMs ?? Date.now(),
      };

      // Always record for tests / local observability.
      captures.push(record);

      return record;
    },
    reset() {
      captures.length = 0;
    },
  };
}

/** Process-wide sink (tests call reset between cases). */
export const sentrySink = createSink();

export function captureException(
  error: unknown,
  context?: { tags?: Record<string, string>; extra?: Record<string, unknown> },
): SentryCapture {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Unknown exception";
  return sentrySink.capture({
    message,
    level: "error",
    tags: { channel: "exception", ...(context?.tags ?? {}) },
    extra: context?.extra,
  });
}

export function captureIncidentSignal(args: {
  signal: "opened" | "escalated" | "resolved";
  incidentType: string;
  dedupeKey: string;
  summary?: string;
}): SentryCapture {
  return sentrySink.capture({
    message: `Operator Incident ${args.signal}: ${args.incidentType}`,
    level: args.signal === "resolved" ? "info" : "warning",
    tags: {
      channel: "operator_incident",
      signal: args.signal,
      incident_type: args.incidentType,
    },
    extra: {
      dedupeKey: args.dedupeKey,
      summary: args.summary,
    },
  });
}

/**
 * Whether this deployment may page the production Sentry alert channel.
 * False for Dev/Preview even when a DSN is set.
 */
export function mayPageProduction(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): boolean {
  const kind = resolveDeploymentKind(env);
  const dsn = env.SENTRY_DSN?.trim() || env.NEXT_PUBLIC_SENTRY_DSN?.trim();
  return kind === "production" && Boolean(dsn);
}
