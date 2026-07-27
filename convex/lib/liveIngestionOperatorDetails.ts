import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import {
  LIVE_INGESTION_CRITICAL_MS,
  LIVE_INGESTION_WARNING_MS,
  LIVE_INGESTION_WATCHDOG,
} from "./liveIngestionWatchdog";
import { API_SPORTS_RELIABILITY_LIMITS } from "./providerReliabilityPolicy";

export async function loadLiveOperatorContext(ctx: QueryCtx) {
  const [reliability, exception] = await Promise.all([
    ctx.db
      .query("providerReliabilityState")
      .withIndex("by_key", (q) =>
        q.eq("key", LIVE_INGESTION_WATCHDOG.provider),
      )
      .unique(),
    ctx.db
      .query("providerExceptions")
      .withIndex("by_scopeKey_and_createdAtMs", (q) =>
        q.eq("scopeKey", LIVE_INGESTION_WATCHDOG.scopeKey),
      )
      .order("desc")
      .first(),
  ]);
  return { reliability, exception, nowMs: Date.now() };
}

export function withLiveOperatorDetails(
  incident: Doc<"operatorIncidents">,
  context: Awaited<ReturnType<typeof loadLiveOperatorContext>>,
) {
  return {
    ...incident,
    operatorDetails:
      incident.surface === LIVE_INGESTION_WATCHDOG.surface &&
      incident.scopeKey === LIVE_INGESTION_WATCHDOG.scopeKey
        ? {
            provider: LIVE_INGESTION_WATCHDOG.provider,
            lastSuccessfulIngestionAtMs:
              incident.lastSuccessfulIngestionAtMs ?? null,
            delayedForMs:
              incident.watchdogReferenceAtMs === undefined
                ? null
                : Math.max(
                    0,
                    context.nowMs - incident.watchdogReferenceAtMs,
                  ),
            thresholds: {
              warningMs: LIVE_INGESTION_WARNING_MS,
              criticalMs: LIVE_INGESTION_CRITICAL_MS,
            },
            quota: context.reliability
              ? {
                  dailyUsed: context.reliability.dailyUsed,
                  dailyLimit:
                    context.reliability.providerDailyLimit ??
                    API_SPORTS_RELIABILITY_LIMITS.daily,
                  dailyRemaining:
                    context.reliability.providerDailyRemaining ?? null,
                  minuteUsed: context.reliability.providerMinuteUsed,
                  minuteLimit:
                    context.reliability.providerMinuteLimit ??
                    API_SPORTS_RELIABILITY_LIMITS.minute,
                }
              : null,
            circuit: context.reliability
              ? {
                  status: context.reliability.circuitStatus,
                  consecutiveFailures:
                    context.reliability.consecutiveFailures,
                  lastFailureReason:
                    context.reliability.lastFailureReason ?? null,
                }
              : null,
            exception: context.exception,
          }
        : null,
  };
}
