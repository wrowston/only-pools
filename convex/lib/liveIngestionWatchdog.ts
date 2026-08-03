/** Provider-free policy for detecting missed expected live ingestions. */

export const LIVE_INGESTION_WARNING_MS = 90_000;
export const LIVE_INGESTION_CRITICAL_MS = 120_000;
export const LIVE_INGESTION_WATCHDOG = {
  provider: "api-sports",
  surface: "league_live",
  scopeKey: "live:nfl",
  incidentType: "stale_in_window",
  dedupeKey: "stale_in_window:league_live:live:nfl",
} as const;

export type LiveIngestionWatchdogDecision = Readonly<{
  state: "healthy" | "warning" | "critical";
  elapsedMs: number;
  referenceAtMs: number;
}>;

export function evaluateLiveIngestionWatchdog(input: {
  activeWindowStartedAtMs: number;
  lastSuccessfulIngestionAtMs: number | null;
  nowMs: number;
}): LiveIngestionWatchdogDecision {
  const referenceAtMs = Math.max(
    input.activeWindowStartedAtMs,
    input.lastSuccessfulIngestionAtMs ?? input.activeWindowStartedAtMs,
  );
  const elapsedMs = Math.max(0, input.nowMs - referenceAtMs);

  if (elapsedMs >= LIVE_INGESTION_CRITICAL_MS) {
    return { state: "critical", elapsedMs, referenceAtMs };
  }
  if (elapsedMs >= LIVE_INGESTION_WARNING_MS) {
    return { state: "warning", elapsedMs, referenceAtMs };
  }
  return { state: "healthy", elapsedMs, referenceAtMs };
}
