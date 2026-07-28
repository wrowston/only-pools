/**
 * Global API-Sports live-ingestion watchdog.
 *
 * The 30-second cron is deliberately DB-only: it reads expected NFL Game
 * windows and freshness state, then updates one deduplicated incident. It does
 * not enqueue work, claim budget, or call the provider.
 */

import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import {
  LIVE_INGESTION_CRITICAL_MS,
  LIVE_INGESTION_WATCHDOG,
  LIVE_INGESTION_WARNING_MS,
  evaluateLiveIngestionWatchdog,
} from "./lib/liveIngestionWatchdog";
import {
  isLivePollingActive,
  LIVE_LEAD_MS,
  SCHEDULED_LIVE_GRACE_MS,
} from "./providers/sportsData/liveSyncPolicy";
import { captureIncidentSignal } from "./lib/sentry";
import { enqueueSentryDelivery } from "./sentry";

const WATCHDOG_KEY = LIVE_INGESTION_WATCHDOG.scopeKey;
const SURFACE = LIVE_INGESTION_WATCHDOG.surface;
const DEDUPE_KEY = LIVE_INGESTION_WATCHDOG.dedupeKey;
const OPEN_STATUSES = ["open", "acknowledged", "in_progress"] as const;
const MAX_AVAILABLE_SEASONS = 4;

type EpisodeIncident = Doc<"operatorIncidents">;

async function findOpenEpisode(
  ctx: MutationCtx,
): Promise<EpisodeIncident | null> {
  for (const status of OPEN_STATUSES) {
    const row = await ctx.db
      .query("operatorIncidents")
      .withIndex("by_dedupeKey_and_status", (q) =>
        q.eq("dedupeKey", DEDUPE_KEY).eq("status", status),
      )
      .unique();
    if (row) return row;
  }
  return null;
}

async function loadState(ctx: MutationCtx) {
  return await ctx.db
    .query("liveIngestionWatchdogState")
    .withIndex("by_key", (q) => q.eq("key", WATCHDOG_KEY))
    .unique();
}

async function activeWindow(ctx: MutationCtx, nowMs: number) {
  const seasons = await ctx.db
    .query("poolSeasons")
    .withIndex("by_status", (q) => q.eq("status", "available"))
    .order("desc")
    .take(MAX_AVAILABLE_SEASONS);
  let scheduledAnchorAtMs: number | null = null;
  let hasInProgress = false;

  for (const season of seasons) {
    const [scheduled, inProgress, interrupted] = await Promise.all([
      ctx.db
        .query("nflGames")
        .withIndex(
          "by_seasonId_and_lifecycle_and_scheduledKickoffMs",
          (q) =>
            q
              .eq("seasonId", season._id)
              .eq("lifecycle", "scheduled")
              .gte(
                "scheduledKickoffMs",
                nowMs - SCHEDULED_LIVE_GRACE_MS,
              )
              .lte("scheduledKickoffMs", nowMs + LIVE_LEAD_MS),
        )
        .take(1),
      ctx.db
        .query("nflGames")
        .withIndex(
          "by_seasonId_and_lifecycle_and_scheduledKickoffMs",
          (q) =>
            q
              .eq("seasonId", season._id)
              .eq("lifecycle", "in_progress"),
        )
        .take(1),
      ctx.db
        .query("nflGames")
        .withIndex(
          "by_seasonId_and_lifecycle_and_scheduledKickoffMs",
          (q) =>
            q
              .eq("seasonId", season._id)
              .eq("lifecycle", "interrupted"),
        )
        .take(1),
    ]);
    const games = [...scheduled, ...inProgress, ...interrupted];
    for (const game of games) {
      if (!isLivePollingActive(game, nowMs)) continue;
      if (game.lifecycle === "scheduled") {
        const anchor = game.scheduledKickoffMs - LIVE_LEAD_MS;
        scheduledAnchorAtMs =
          scheduledAnchorAtMs === null
            ? anchor
            : Math.min(scheduledAnchorAtMs, anchor);
      } else {
        hasInProgress = true;
      }
    }
  }

  return {
    active: scheduledAnchorAtMs !== null || hasInProgress,
    scheduledAnchorAtMs,
  };
}

async function resolveEpisode(
  ctx: MutationCtx,
  incident: EpisodeIncident,
  nowMs: number,
  cause: "healthy_ingestion" | "window_ended",
) {
  await ctx.db.patch(incident._id, {
    status: "resolved",
    resolvedAtMs: nowMs,
    resolvedAutomatically: true,
    resolutionCause: cause,
    resolutionNote:
      cause === "healthy_ingestion"
        ? "Expected live ingestion recovered"
        : "Expected live window ended",
  });
  if (cause === "healthy_ingestion") {
    await enqueueSentryDelivery(
      ctx,
      captureIncidentSignal({
        signal: "resolved",
        incidentType: incident.type,
        severity: incident.severity ?? "warning",
        dedupeKey: incident.dedupeKey,
        summary: incident.summary,
        resolutionCause: cause,
      }),
    );
  }
}

async function openEpisode(
  ctx: MutationCtx,
  args: {
    severity: "warning" | "critical";
    lastSuccessfulIngestionAtMs: number | null;
    referenceAtMs: number;
    nowMs: number;
  },
) {
  const participantVisible = args.severity === "critical";
  const summary = participantVisible
    ? "Scores are delayed."
    : "Expected API-Sports live ingestion is delayed.";
  const incidentId = await ctx.db.insert("operatorIncidents", {
    type: LIVE_INGESTION_WATCHDOG.incidentType,
    status: "open",
    surface: SURFACE,
    scopeKey: WATCHDOG_KEY,
    dedupeKey: DEDUPE_KEY,
    participantVisible,
    severity: args.severity,
    summary,
    openedAtMs: args.nowMs,
    criticalAtMs:
      args.severity === "critical" ? args.nowMs : undefined,
    lastSuccessfulIngestionAtMs:
      args.lastSuccessfulIngestionAtMs ?? undefined,
    watchdogReferenceAtMs: args.referenceAtMs,
    maintenanceLock: false,
  });
  await enqueueSentryDelivery(
    ctx,
    captureIncidentSignal({
      signal: "opened",
      incidentType: LIVE_INGESTION_WATCHDOG.incidentType,
      severity: args.severity,
      dedupeKey: DEDUPE_KEY,
      summary,
    }),
  );
  return incidentId;
}

/** Run by cron and deterministic tests. No provider or budget calls. */
export const evaluate = internalMutation({
  args: { nowMs: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const nowMs = args.nowMs ?? Date.now();
    const [window, state, health] = await Promise.all([
      activeWindow(ctx, nowMs),
      loadState(ctx),
      ctx.db
        .query("syncSurfaceHealth")
        .withIndex("by_surface_and_scopeKey", (q) =>
          q.eq("surface", SURFACE).eq("scopeKey", WATCHDOG_KEY),
        )
        .unique(),
    ]);
    const existing = await findOpenEpisode(ctx);

    if (!window.active) {
      if (state) {
        await ctx.db.patch(state._id, {
          active: false,
          activeWindowStartedAtMs: undefined,
          lastEvaluatedAtMs: nowMs,
          updatedAtMs: nowMs,
        });
      } else {
        await ctx.db.insert("liveIngestionWatchdogState", {
          key: WATCHDOG_KEY,
          active: false,
          lastEvaluatedAtMs: nowMs,
          updatedAtMs: nowMs,
        });
      }
      if (existing) {
        await resolveEpisode(ctx, existing, nowMs, "window_ended");
      }
      return {
        state: "inactive" as const,
        resolved: existing !== null,
      };
    }

    const startsNewEpisode = state === null || !state.active;
    if (startsNewEpisode && existing) {
      await resolveEpisode(ctx, existing, nowMs, "window_ended");
    }
    const activeWindowStartedAtMs = startsNewEpisode
      ? (window.scheduledAnchorAtMs ?? nowMs)
      : Math.min(
          state.activeWindowStartedAtMs ?? nowMs,
          window.scheduledAnchorAtMs ?? Number.POSITIVE_INFINITY,
        );
    const lastSuccessfulIngestionAtMs =
      health?.lastSuccessAtMs ??
      state?.lastSuccessfulExpectedIngestionAtMs ??
      null;

    if (state) {
      await ctx.db.patch(state._id, {
        active: true,
        activeWindowStartedAtMs,
        lastSuccessfulExpectedIngestionAtMs:
          lastSuccessfulIngestionAtMs ?? undefined,
        lastEvaluatedAtMs: nowMs,
        updatedAtMs: nowMs,
      });
    } else {
      await ctx.db.insert("liveIngestionWatchdogState", {
        key: WATCHDOG_KEY,
        active: true,
        activeWindowStartedAtMs,
        lastSuccessfulExpectedIngestionAtMs:
          lastSuccessfulIngestionAtMs ?? undefined,
        lastEvaluatedAtMs: nowMs,
        updatedAtMs: nowMs,
      });
    }

    const decision = evaluateLiveIngestionWatchdog({
      activeWindowStartedAtMs,
      lastSuccessfulIngestionAtMs,
      nowMs,
    });
    const episode = startsNewEpisode ? null : existing;

    if (decision.state === "healthy") {
      if (episode) {
        await resolveEpisode(
          ctx,
          episode,
          nowMs,
          lastSuccessfulIngestionAtMs !== null &&
              lastSuccessfulIngestionAtMs >= activeWindowStartedAtMs
            ? "healthy_ingestion"
            : "window_ended",
        );
      }
      return {
        state: "healthy" as const,
        elapsedMs: decision.elapsedMs,
        resolved: episode !== null,
      };
    }

    if (!episode) {
      const incidentId = await openEpisode(ctx, {
        severity: decision.state,
        lastSuccessfulIngestionAtMs,
        referenceAtMs: decision.referenceAtMs,
        nowMs,
      });
      return {
        state: decision.state,
        opened: true as const,
        incidentId,
      };
    }

    if (
      decision.state === "critical" &&
      episode.severity !== "critical"
    ) {
      await ctx.db.patch(episode._id, {
        severity: "critical",
        participantVisible: true,
        summary: "Scores are delayed.",
        criticalAtMs: nowMs,
        lastSuccessfulIngestionAtMs:
          lastSuccessfulIngestionAtMs ?? undefined,
      });
      await enqueueSentryDelivery(
        ctx,
        captureIncidentSignal({
          signal: "escalated",
          incidentType: episode.type,
          severity: "critical",
          dedupeKey: episode.dedupeKey,
          summary: "Scores are delayed.",
        }),
      );
      return {
        state: "critical" as const,
        escalated: true as const,
        incidentId: episode._id,
      };
    }

    return {
      state: decision.state,
      opened: false as const,
      deduped: true as const,
      incidentId: episode._id,
    };
  },
});

/** Resolve immediately when the global expected live feed ingests successfully. */
export const recordSuccessfulExpectedIngestion = internalMutation({
  args: { nowMs: v.number() },
  handler: async (ctx, args) => {
    const state = await loadState(ctx);
    if (
      state?.lastSuccessfulExpectedIngestionAtMs !== undefined &&
      args.nowMs <= state.lastSuccessfulExpectedIngestionAtMs
    ) {
      return {
        resolved: false as const,
        stale: true as const,
        lastSuccessfulExpectedIngestionAtMs:
          state.lastSuccessfulExpectedIngestionAtMs,
      };
    }
    if (state) {
      await ctx.db.patch(state._id, {
        lastSuccessfulExpectedIngestionAtMs: args.nowMs,
        updatedAtMs: args.nowMs,
      });
    } else {
      await ctx.db.insert("liveIngestionWatchdogState", {
        key: WATCHDOG_KEY,
        active: false,
        lastSuccessfulExpectedIngestionAtMs: args.nowMs,
        lastEvaluatedAtMs: args.nowMs,
        updatedAtMs: args.nowMs,
      });
    }
    const incident = await findOpenEpisode(ctx);
    if (!incident) return { resolved: false as const };
    await resolveEpisode(
      ctx,
      incident,
      args.nowMs,
      "healthy_ingestion",
    );
    return { resolved: true as const, incidentId: incident._id };
  },
});

export {
  LIVE_INGESTION_CRITICAL_MS,
  LIVE_INGESTION_WARNING_MS,
};
