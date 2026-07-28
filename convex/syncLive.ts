/**
 * Sync observation mutations + one-minute dispatcher.
 *
 * Pipeline: cron → dispatchSyncWork (mutation, no I/O) → claim under Sync Gate
 * + budget → schedule internal fetch actions → apply*Observation mutations.
 *
 * Tests inject normalized observations directly (no live HTTP).
 */

import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { applyKickoffScheduleChange } from "./lib/pickLock";
import { deriveFreshness } from "./lib/freshness";
import { LIVE_INGESTION_WATCHDOG } from "./lib/liveIngestionWatchdog";
import { recordScoringDependencyEvent } from "./lib/scoringHolds";
import {
  admitProviderFetch,
  emptyBudgetUsage,
  recordAdmission,
  type BudgetPriority,
  type BudgetUsage,
} from "./lib/providerBudget";
import { API_SPORTS_RECOVERY_SCOPE_KEY } from "./lib/providerReliabilityPolicy";
import { providerDiagnosticExpiry } from "./lib/providerEvidencePolicy";
import { createLogger } from "./lib/log";
import { captureException } from "./lib/sentry";
import { canClaimProviderFetch } from "./lib/syncGate";
import { isCompetitiveProviderSyncAuthorized } from "./providerQualification";
import { enqueueSentryDelivery } from "./sentry";
import {
  LEASE_MS,
  scheduleObservationValidator,
} from "./lib/syncObservations";
import {
  recordNflGameSchedule,
} from "./providers/sportsData/identityStore";
import { isLivePollingActive } from "./providers/sportsData/liveSyncPolicy";

const log = createLogger("syncLive");

const SYNC_GATE_KEY = "deployment" as const;
const BUDGET_WINDOW_MS = 60_000;

async function loadSyncGateEnabled(
  ctx: QueryCtx | MutationCtx,
): Promise<boolean> {
  const gate = await ctx.db
    .query("syncGate")
    .withIndex("by_key", (q) => q.eq("key", SYNC_GATE_KEY))
    .unique();
  return gate?.enabled ?? false;
}

/**
 * Apply a schedule observation (kickoff / lifecycle from schedule surface).
 * Unreached Pick Locks move with authoritative kickoff; reached locks latch.
 */
export const applyScheduleObservation = internalMutation({
  args: {
    observation: scheduleObservationValidator,
  },
  handler: async (ctx, args) => {
    const { observation } = args;
    const game = await ctx.db.get(observation.gameId);
    if (!game) {
      throw new Error(`NFL Game not found: ${observation.gameId}`);
    }
    const schedule = applyKickoffScheduleChange({
      priorScheduledKickoffMs: game.scheduledKickoffMs,
      newScheduledKickoffMs: observation.scheduledKickoffMs,
      nowMs: observation.observedAtMs,
      priorLifecycle: game.lifecycle,
      kickoffLockReachedAtMs: game.kickoffLockReachedAtMs ?? null,
    });
    const revision = (game.revision ?? 0) + 1;
    await ctx.db.patch(game._id, {
      scheduledKickoffMs: schedule.scheduledKickoffMs,
      lifecycle: observation.lifecycle,
      kickoffLockReachedAtMs: schedule.kickoffLockReachedAtMs ?? undefined,
      lastObservedAtMs: observation.observedAtMs,
      revision,
    });
    if (
      schedule.scheduledKickoffMs !== game.scheduledKickoffMs ||
      observation.lifecycle !== game.lifecycle ||
      schedule.kickoffLockReachedAtMs !==
        (game.kickoffLockReachedAtMs ?? null)
    ) {
      await recordScoringDependencyEvent(
        ctx,
        game.seasonId,
        game.week,
      );
    }
    await recordNflGameSchedule(ctx, {
      nflGameId: game._id,
      seasonId: game.seasonId,
      week: game.week,
      homeTeamId: game.homeTeamId,
      awayTeamId: game.awayTeamId,
      scheduledKickoffMs: schedule.scheduledKickoffMs,
      observedAtMs: observation.observedAtMs,
    });
    return {
      gameId: game._id,
      revision,
      kickoffLockReachedAtMs: schedule.kickoffLockReachedAtMs,
    };
  },
});

/**
 * Upsert sync surface health and optionally record a Provider Exception.
 */
export const recordSyncSurfaceHealth = internalMutation({
  args: {
    surface: v.string(),
    scopeKey: v.string(),
    success: v.boolean(),
    nowMs: v.number(),
    providerException: v.optional(v.boolean()),
    exceptionMessage: v.optional(v.string()),
    gameId: v.optional(v.id("nflGames")),
    expectedNextRefreshAtMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("syncSurfaceHealth")
      .withIndex("by_surface_and_scopeKey", (q) =>
        q.eq("surface", args.surface).eq("scopeKey", args.scopeKey),
      )
      .unique();

    const providerException = args.providerException ?? false;
    const previousLastSuccessAtMs =
      existing?.lastSuccessAtMs ?? null;
    const acceptsSuccessfulIngestion =
      args.success &&
      (previousLastSuccessAtMs === null ||
        args.nowMs > previousLastSuccessAtMs);
    if (args.success && !acceptsSuccessfulIngestion) {
      return deriveFreshness({
        surface: args.surface === "schedule" ? "schedule" : "league_live",
        lastSuccessAtMs: previousLastSuccessAtMs,
        nowMs: Math.max(args.nowMs, existing?.updatedAtMs ?? args.nowMs),
        providerException: existing?.providerException ?? false,
      });
    }
    const fields = {
      surface: args.surface,
      scopeKey: args.scopeKey,
      lastAttemptAtMs: args.nowMs,
      lastSuccessAtMs: args.success
        ? args.nowMs
        : (previousLastSuccessAtMs ?? undefined),
      expectedNextRefreshAtMs: args.expectedNextRefreshAtMs,
      consecutiveFailures: args.success
        ? 0
        : (existing?.consecutiveFailures ?? 0) + 1,
      providerException,
      updatedAtMs: args.nowMs,
    };

    if (existing) {
      await ctx.db.patch(existing._id, fields);
    } else {
      await ctx.db.insert("syncSurfaceHealth", fields);
    }

    if (providerException) {
      log.error("sync_provider_exception", {
        surface: args.surface,
        scopeKey: args.scopeKey,
        gameId: args.gameId ?? null,
        failureCode: "provider_sync_failed",
        consecutiveFailures: fields.consecutiveFailures,
      });
      await ctx.db.insert("providerExceptions", {
        kind: "sync_failure",
        gameId: args.gameId,
        scopeKey: args.scopeKey,
        message:
          "Provider synchronization failed; inspect sanitized request diagnostics.",
        createdAtMs: args.nowMs,
        expiresAtMs: providerDiagnosticExpiry(args.nowMs),
      });
      await enqueueSentryDelivery(
        ctx,
        captureException("Provider synchronization failed", {
          tags: { channel: "sync", surface: args.surface },
          extra: { scopeKey: args.scopeKey },
        }),
      );
    } else {
      log.info("sync_surface_health", {
        surface: args.surface,
        scopeKey: args.scopeKey,
        success: args.success,
        consecutiveFailures: fields.consecutiveFailures,
        gameId: args.gameId ?? null,
      });
    }

    const freshness = deriveFreshness({
      surface: args.surface === "schedule" ? "schedule" : "league_live",
      lastSuccessAtMs: fields.lastSuccessAtMs ?? null,
      nowMs: args.nowMs,
      providerException,
    });

    // The global API-Sports live feed has a dedicated 90s/120s watchdog. Its
    // transport failures remain operator diagnostics and must not expose a
    // participant banner before the critical freshness threshold.
    const isGlobalApiSportsLive =
      args.surface === LIVE_INGESTION_WATCHDOG.surface &&
      args.scopeKey === LIVE_INGESTION_WATCHDOG.scopeKey;

    // Other surfaces retain the settled freshness incident behavior.
    const activeGameWindow =
      args.surface === "live" || args.surface === "league_live";
    if (!isGlobalApiSportsLive) {
      await ctx.runMutation(internal.incidents.evaluateAndOpenIncident, {
        trigger: {
          kind: "freshness",
          freshnessState: freshness.state,
          activeGameWindow,
        },
        surface: args.surface,
        scopeKey: args.scopeKey,
        nowMs: args.nowMs,
      });
    }

    // Heal: successful fresh refresh auto-resolves matching open incidents.
    if (
      acceptsSuccessfulIngestion &&
      !providerException &&
      freshness.state === "fresh"
    ) {
      if (isGlobalApiSportsLive) {
        await ctx.runMutation(
          internal.liveIngestionWatchdog
            .recordSuccessfulExpectedIngestion,
          { nowMs: args.nowMs },
        );
      } else {
        await ctx.runMutation(internal.incidents.autoResolveIncident, {
          type: "stale_in_window",
          surface: args.surface,
          scopeKey: args.scopeKey,
          nowMs: args.nowMs,
        });
        await ctx.runMutation(internal.incidents.autoResolveIncident, {
          type: "provider_exception",
          surface: args.surface,
          scopeKey: args.scopeKey,
          nowMs: args.nowMs,
        });
      }
    }

    return freshness;
  },
});

/**
 * Enqueue or coalesce a sync work item (fixture / operator / live helpers).
 */
export const enqueueSyncWork = internalMutation({
  args: {
    surface: v.union(
      v.literal("schedule"),
      v.literal("live"),
      v.literal("correction"),
      v.literal("operator"),
    ),
    scopeKey: v.string(),
    priority: v.union(
      v.literal("routine"),
      v.literal("recovery"),
      v.literal("operator"),
    ),
    dueAtMs: v.number(),
    gameId: v.optional(v.id("nflGames")),
    seasonId: v.optional(v.id("poolSeasons")),
    purpose: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("syncWorkItems")
      .withIndex("by_scopeKey", (q) => q.eq("scopeKey", args.scopeKey))
      .unique();
    if (existing) {
      const dueAtMs = Math.min(existing.dueAtMs, args.dueAtMs);
      await ctx.db.patch(existing._id, {
        dueAtMs,
        status: existing.status === "done" ? "due" : existing.status,
        priority: args.priority,
      });
      return existing._id;
    }
    return await ctx.db.insert("syncWorkItems", {
      surface: args.surface,
      scopeKey: args.scopeKey,
      priority: args.priority,
      status: "due",
      dueAtMs: args.dueAtMs,
      attemptCount: 0,
      gameId: args.gameId,
      seasonId: args.seasonId,
      purpose: args.purpose,
    });
  },
});

async function budgetUsageInWindow(
  ctx: MutationCtx,
  nowMs: number,
): Promise<BudgetUsage> {
  const since = nowMs - BUDGET_WINDOW_MS;
  const claims = await ctx.db
    .query("providerFetchClaims")
    .withIndex("by_status_and_claimedAtMs", (q) =>
      q.eq("status", "claimed").gte("claimedAtMs", since),
    )
    .take(61);

  let usage = emptyBudgetUsage();
  for (const claim of claims) {
    if (claim.status !== "claimed") continue;
    if (claim.claimedAtMs < since) continue;
    const priority = claim.priority ?? "routine";
    usage = recordAdmission(usage, priority);
  }
  return usage;
}

// Clean activation produces one Available Season. Four is bounded defensive
// headroom; 400 similarly exceeds the validated 272-game regular season.
const MAX_AVAILABLE_SEASONS_PER_DISPATCH = 4;
const MAX_NFL_GAMES_PER_SEASON = 400;

/**
 * Enqueue league-live (and light schedule) work when any NFL Game is in an
 * active window: within 15 minutes of kickoff or in progress.
 */
async function enqueuePhaseAwareWork(
  ctx: MutationCtx,
  nowMs: number,
): Promise<void> {
  const seasons = await ctx.db
    .query("poolSeasons")
    .withIndex("by_status", (q) => q.eq("status", "available"))
    .order("desc")
    .take(MAX_AVAILABLE_SEASONS_PER_DISPATCH);
  let needsLeagueLive = false;

  for (const season of seasons) {
    const games = await ctx.db
      .query("nflGames")
      .withIndex("by_seasonId", (q) => q.eq("seasonId", season._id))
      .take(MAX_NFL_GAMES_PER_SEASON);

    const scheduleKey = `schedule:${season._id}`;
    const scheduleWork = await ctx.db
      .query("syncWorkItems")
      .withIndex("by_scopeKey", (q) => q.eq("scopeKey", scheduleKey))
      .unique();
    if (!scheduleWork) {
      await ctx.db.insert("syncWorkItems", {
        surface: "schedule",
        scopeKey: scheduleKey,
        priority: "routine",
        status: "due",
        dueAtMs: nowMs,
        attemptCount: 0,
        seasonId: season._id,
        purpose: "season_schedule",
      });
    } else if (
      scheduleWork.status === "done" ||
      scheduleWork.status === "failed"
    ) {
      await ctx.db.patch(scheduleWork._id, {
        status: "due",
        dueAtMs: nowMs,
        claimedAtMs: undefined,
        leaseExpiresAtMs: undefined,
      });
    }

    needsLeagueLive ||= games.some((game) =>
      isLivePollingActive(game, nowMs),
    );
  }

  const scopeKey = "live:nfl";
  const existing = await ctx.db
    .query("syncWorkItems")
    .withIndex("by_scopeKey", (q) => q.eq("scopeKey", scopeKey))
    .unique();
  if (!needsLeagueLive) {
    if (
      existing &&
      (existing.status !== "claimed" ||
        (existing.leaseExpiresAtMs !== undefined &&
          existing.leaseExpiresAtMs <= nowMs))
    ) {
      await ctx.db.patch(existing._id, {
        status: "done",
        claimedAtMs: undefined,
        leaseExpiresAtMs: undefined,
      });
    }
    return;
  }
  if (existing) {
    if (existing.priority !== "recovery") {
      await ctx.db.patch(existing._id, {
        priority: "recovery",
      });
    }
    if (existing.status === "due" || existing.status === "claimed") return;
    await ctx.db.patch(existing._id, {
      status: "due",
      dueAtMs: nowMs,
      claimedAtMs: undefined,
      leaseExpiresAtMs: undefined,
    });
  } else {
    await ctx.db.insert("syncWorkItems", {
      surface: "live",
      scopeKey,
      priority: "recovery",
      status: "due",
      dueAtMs: nowMs,
      attemptCount: 0,
      purpose: "league_live",
    });
  }
}

/**
 * One-minute dispatcher: claim due work under Sync Gate + budget.
 * Performs no provider I/O — returns claimed work for actions / tests.
 */
export const dispatchSyncWork = internalMutation({
  args: {
    nowMs: v.optional(v.number()),
    maxClaims: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const nowMs = args.nowMs ?? Date.now();
    const maxClaims = args.maxClaims ?? 20;
    const gateEnabled = await loadSyncGateEnabled(ctx);
    const effectiveAuthorized =
      gateEnabled && (await isCompetitiveProviderSyncAuthorized(ctx));

    if (!effectiveAuthorized) {
      const reason = gateEnabled
        ? "qualification_required"
        : "sync_gate_off";
      log.info("dispatch_skipped", { reason, nowMs });
      return {
        gateEnabled: false,
        claimed: [] as Array<{
          workItemId: Id<"syncWorkItems">;
          surface: string;
          priority: BudgetPriority;
          scopeKey: string;
          gameId?: Id<"nflGames">;
          purpose?: string;
        }>,
        denied: reason,
      };
    }

    // Phase-aware enqueue: league-live while any game is in the active window.
    await enqueuePhaseAwareWork(ctx, nowMs);

    // Return expired leases to due.
    const claimedItems = await ctx.db
      .query("syncWorkItems")
      .withIndex("by_status_and_leaseExpiresAtMs", (q) =>
        q
          .eq("status", "claimed")
          .gt("leaseExpiresAtMs", 0)
          .lte("leaseExpiresAtMs", nowMs),
      )
      .take(200);
    for (const item of claimedItems) {
      if (
        item.leaseExpiresAtMs !== undefined &&
        item.leaseExpiresAtMs <= nowMs
      ) {
        await ctx.db.patch(item._id, {
          status: "due",
          claimedAtMs: undefined,
          leaseExpiresAtMs: undefined,
        });
      }
    }

    const [recoveryDue, operatorDue, routineDue, recoveryWork] =
      await Promise.all([
        ctx.db
          .query("syncWorkItems")
          .withIndex(
            "by_status_and_priority_and_dueAtMs",
            (q) =>
              q
                .eq("status", "due")
                .eq("priority", "recovery"),
          )
          .take(200),
        ctx.db
          .query("syncWorkItems")
          .withIndex(
            "by_status_and_priority_and_dueAtMs",
            (q) =>
              q
                .eq("status", "due")
                .eq("priority", "operator"),
          )
          .take(200),
        ctx.db
          .query("syncWorkItems")
          .withIndex(
            "by_status_and_priority_and_dueAtMs",
            (q) =>
              q.eq("status", "due").eq("priority", "routine"),
          )
          .take(200),
        ctx.db
          .query("syncWorkItems")
          .withIndex("by_scopeKey", (q) =>
            q.eq("scopeKey", API_SPORTS_RECOVERY_SCOPE_KEY),
          )
          .unique(),
      ]);
    const dueById = new Map(
      [...recoveryDue, ...operatorDue, ...routineDue].map((item) => [
        item._id,
        item,
      ]),
    );
    let recoveryForDispatch = recoveryWork;
    if (
      recoveryWork?.status === "claimed" &&
      recoveryWork.leaseExpiresAtMs !== undefined &&
      recoveryWork.leaseExpiresAtMs <= nowMs
    ) {
      await ctx.db.patch(recoveryWork._id, {
        status: "due",
        claimedAtMs: undefined,
        leaseExpiresAtMs: undefined,
      });
      recoveryForDispatch = {
        ...recoveryWork,
        status: "due",
        claimedAtMs: undefined,
        leaseExpiresAtMs: undefined,
      };
    }
    if (recoveryForDispatch?.status === "due") {
      dueById.set(recoveryForDispatch._id, recoveryForDispatch);
    }
    const dueItems = [...dueById.values()];

    // Priority order: recovery → operator → routine (by due time within).
    const priorityRank = (item: (typeof dueItems)[number]) =>
      item.purpose === "provider_recovery_probe"
        ? -1
        : item.priority === "recovery"
          ? 0
          : item.priority === "operator"
            ? 1
            : 2;
    dueItems.sort((a, b) => {
      const pr = priorityRank(a) - priorityRank(b);
      if (pr !== 0) return pr;
      return a.dueAtMs - b.dueAtMs;
    });

    let usage = await budgetUsageInWindow(ctx, nowMs);
    const claimed: Array<{
      workItemId: Id<"syncWorkItems">;
      surface: string;
      priority: BudgetPriority;
      scopeKey: string;
      gameId?: Id<"nflGames">;
      purpose?: string;
    }> = [];

    for (const item of dueItems) {
      if (claimed.length >= maxClaims) break;
      if (item.dueAtMs > nowMs) continue;

      const surfaceForGate =
        item.surface === "schedule" ? "schedule" : "live";

      const gateDecision = canClaimProviderFetch(
        { enabled: true },
        surfaceForGate,
      );
      if (!gateDecision.ok) continue;

      const protectedLivePriority: BudgetPriority =
        item.surface === "live" ||
        item.surface === "correction" ||
        item.purpose === "provider_recovery_probe"
          ? item.purpose === "provider_recovery_probe"
            ? "operator"
            : "recovery"
          : item.priority;
      const budgetDecision = admitProviderFetch(
        usage,
        protectedLivePriority,
      );
      if (!budgetDecision.ok) {
        // Try next item — recovery/operator may still fit when routine cannot.
        continue;
      }

      await ctx.db.patch(item._id, {
        status: "claimed",
        claimedAtMs: nowMs,
        leaseExpiresAtMs: nowMs + LEASE_MS,
        attemptCount: item.attemptCount + 1,
        deferredReason: undefined,
        deferredAtMs: undefined,
        isProviderDeferred: undefined,
      });

      const claimId = await ctx.db.insert("providerFetchClaims", {
        surface: item.surface,
        status: "claimed",
        claimedAtMs: nowMs,
        priority: protectedLivePriority,
        workItemId: item._id,
        expiresAtMs: providerDiagnosticExpiry(nowMs),
      });
      void claimId;

      usage = recordAdmission(usage, protectedLivePriority);
      claimed.push({
        workItemId: item._id,
        surface: item.surface,
        priority: protectedLivePriority,
        scopeKey: item.scopeKey,
        gameId: item.gameId,
        purpose: item.purpose,
      });

      // Every work surface routes to an explicit API-Sports action.
      switch (item.surface) {
        case "operator": {
          if (item.purpose !== "provider_recovery_probe") {
            await ctx.db.patch(item._id, { status: "failed" });
            break;
          }
          await ctx.scheduler.runAfter(
            0,
            internal.providerReliability.runApiSportsRecoveryProbe,
            { workItemId: item._id },
          );
          break;
        }
        case "schedule": {
          if (item.seasonId === undefined) {
            await ctx.db.patch(item._id, { status: "failed" });
            break;
          }
          await ctx.scheduler.runAfter(
            0,
            internal.syncSchedule.runClaimedScheduleFetch,
            {
              workItemId: item._id,
              seasonId: item.seasonId,
            },
          );
          break;
        }
        case "live": {
          if (
            item.purpose === "targeted_live_recovery" &&
            item.gameId !== undefined
          ) {
            await ctx.scheduler.runAfter(
              0,
              internal.syncApiSportsLive.runClaimedTargetedRecovery,
              { workItemId: item._id, gameId: item.gameId },
            );
          } else {
            await ctx.scheduler.runAfter(
              0,
              internal.syncApiSportsLive.runClaimedLiveFetch,
              { workItemId: item._id },
            );
          }
          break;
        }
        case "correction": {
          if (item.gameId === undefined) {
            await ctx.db.patch(item._id, { status: "failed" });
            break;
          }
          await ctx.scheduler.runAfter(
            0,
            internal.syncApiSportsLive.runClaimedResultReconciliation,
            {
              workItemId: item._id,
              gameId: item.gameId,
              expectedPinnedOverrideId: item.pinnedResultOverrideId,
            },
          );
          break;
        }
      }
    }

    log.info("dispatch_complete", {
      nowMs,
      dueCount: dueItems.length,
      claimedCount: claimed.length,
      maxClaims,
    });

    return { gateEnabled: true, claimed, denied: null };
  },
});

export const requeueFailedWork = internalMutation({
  args: {
    workItemId: v.id("syncWorkItems"),
    dueAtMs: v.number(),
    gameId: v.optional(v.id("nflGames")),
    expectedPinnedOverrideId: v.optional(
      v.id("nflGameResultOverrides"),
    ),
    deferredReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (
      args.gameId !== undefined &&
      args.expectedPinnedOverrideId !== undefined
    ) {
      const game = await ctx.db.get(args.gameId);
      if (
        !game ||
        game.pinnedResultOverrideId !== args.expectedPinnedOverrideId
      ) {
        await ctx.db.patch(args.workItemId, {
          status: "done",
          claimedAtMs: undefined,
          leaseExpiresAtMs: undefined,
        });
        return { requeued: false as const };
      }
    }
    await ctx.db.patch(args.workItemId, {
      status: "due",
      dueAtMs: args.dueAtMs,
      claimedAtMs: undefined,
      leaseExpiresAtMs: undefined,
      deferredReason: args.deferredReason,
      deferredAtMs:
        args.deferredReason === undefined ? undefined : Date.now(),
      isProviderDeferred:
        args.deferredReason === undefined ? undefined : true,
    });
    return { requeued: true as const };
  },
});

/**
 * Mark a claimed work item done (after fixture apply or successful fetch).
 */
export const completeSyncWork = internalMutation({
  args: {
    workItemId: v.id("syncWorkItems"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.workItemId, {
      status: "done",
      leaseExpiresAtMs: undefined,
      deferredReason: undefined,
      deferredAtMs: undefined,
      isProviderDeferred: undefined,
    });
  },
});
