/**
 * Sync observation mutations + one-minute dispatcher.
 *
 * Pipeline: cron → dispatchSyncWork (mutation, no I/O) → claim under Sync Gate
 * + budget → schedule internal fetch actions → apply*Observation mutations.
 *
 * Tests inject normalized observations directly (no live HTTP).
 */

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
} from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  applyConfirmationObservation,
  emptyConfirmationState,
  type ConfirmationObservation,
  type ConfirmationState,
  type ResultAuthority,
  type TerminalStatus,
} from "./lib/confirmationPolicy";
import { applyKickoffScheduleChange } from "./lib/pickLock";
import { deriveFreshness } from "./lib/freshness";
import { SCORING_DELAY_THRESHOLD_MS } from "./lib/incidents";
import {
  admitProviderFetch,
  emptyBudgetUsage,
  recordAdmission,
  type BudgetPriority,
  type BudgetUsage,
} from "./lib/providerBudget";
import { captureException } from "./lib/sentry";
import { canClaimProviderFetch } from "./lib/syncGate";
import { enqueueSentryDelivery } from "./sentry";
import {
  CONFIRMATION_15_MS,
  CONFIRMATION_60_MS,
  confirmationObservationValidator,
  confirmationScopeKey,
  LEASE_MS,
  liveObservationValidator,
  scheduleObservationValidator,
} from "./lib/syncObservations";

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

function gameConfirmationState(game: {
  resultAuthority?: ResultAuthority;
  provisionalTerminalAtMs?: number;
  confirmationObservations?: ConfirmationObservation[];
  verifiedResult?: {
    homeScore: number;
    awayScore: number;
    verifiedAtMs: number;
    status: TerminalStatus;
  };
  priorVerifiedResult?: {
    homeScore: number;
    awayScore: number;
    verifiedAtMs: number;
    status: TerminalStatus;
    supersededAtMs?: number;
  };
}): ConfirmationState {
  const prior = game.priorVerifiedResult;
  return {
    resultAuthority: game.resultAuthority ?? "none",
    provisionalTerminalAtMs: game.provisionalTerminalAtMs ?? null,
    observations: game.confirmationObservations ?? [],
    verifiedResult: game.verifiedResult ?? null,
    priorVerifiedResult: prior
      ? {
          homeScore: prior.homeScore,
          awayScore: prior.awayScore,
          verifiedAtMs: prior.verifiedAtMs,
          status: prior.status,
        }
      : null,
    pendingRetry: false,
  };
}

/**
 * Apply a live / provisional observation. Updates projected scores and
 * lifecycle. First terminal becomes confirmation_pending — never verified.
 */
export const applyLiveObservation = internalMutation({
  args: {
    observation: liveObservationValidator,
  },
  handler: async (ctx, args) => {
    const { observation } = args;
    const game = await ctx.db.get(observation.gameId);
    if (!game) {
      throw new Error(`NFL Game not found: ${observation.gameId}`);
    }

    const revision = (game.revision ?? 0) + 1;
    const patch: Record<string, unknown> = {
      lifecycle: observation.lifecycle,
      homeScore: observation.homeScore,
      awayScore: observation.awayScore,
      lastObservedAtMs: observation.observedAtMs,
      revision,
    };

    const isTerminalLifecycle =
      observation.lifecycle === "terminal" ||
      observation.lifecycle === "canceled";
    const terminalStatus = observation.terminalStatus;

    if (isTerminalLifecycle && terminalStatus && observation.homeScore !== null && observation.awayScore !== null) {
      // Already verified — do not regress via live path.
      if (game.resultAuthority === "verified") {
        await ctx.db.patch(game._id, patch);
        return {
          gameId: game._id,
          resultAuthority: "verified" as const,
          scheduledConfirmationLookups: [] as string[],
        };
      }

      const prior =
        game.resultAuthority === "confirmation_pending" ||
        game.resultAuthority === "correction_candidate"
          ? gameConfirmationState(game)
          : emptyConfirmationState();

      const outcome = applyConfirmationObservation({
        prior,
        observation: {
          observedAtMs: observation.observedAtMs,
          homeScore: observation.homeScore,
          awayScore: observation.awayScore,
          status: terminalStatus,
        },
      });

      patch.resultAuthority = outcome.resultAuthority;
      patch.provisionalTerminalAtMs =
        outcome.provisionalTerminalAtMs ?? undefined;
      patch.confirmationObservations = outcome.observations;
      if (outcome.verifiedResult) {
        patch.verifiedResult = outcome.verifiedResult;
      }
      if (outcome.priorVerifiedResult) {
        patch.priorVerifiedResult = {
          ...outcome.priorVerifiedResult,
          supersededAtMs: outcome.justCorrected
            ? observation.observedAtMs
            : (game.priorVerifiedResult?.supersededAtMs ??
              observation.observedAtMs),
        };
      }

      await ctx.db.patch(game._id, patch);

      if (outcome.justVerified) {
        if (terminalStatus === "CANC") {
          await ctx.scheduler.runAfter(
            0,
            internal.survivorScoring.handleVerifiedCancellation,
            { gameId: game._id, nowMs: observation.observedAtMs },
          );
        }
        await ctx.scheduler.runAfter(
          0,
          internal.survivorScoring.scoreSurvivorPoolsForVerifiedGame,
          { gameId: game._id, nowMs: observation.observedAtMs },
        );
        await ctx.scheduler.runAfter(
          0,
          internal.confidenceScoring.scoreConfidencePoolsForVerifiedGame,
          { gameId: game._id, nowMs: observation.observedAtMs },
        );
        await ctx.scheduler.runAfter(
          SCORING_DELAY_THRESHOLD_MS + 1_000,
          internal.incidents.checkScoringDelayForGame,
          {
            gameId: game._id,
            verifiedAtMs:
              outcome.verifiedResult?.verifiedAtMs ??
              observation.observedAtMs,
          },
        );
      }

      const scheduled: string[] = [];
      // Schedule 15- and 60-minute confirmation lookups on first provisional
      // or when a correction candidate restarts the clock.
      if (
        (outcome.resultAuthority === "confirmation_pending" ||
          outcome.resultAuthority === "correction_candidate") &&
        outcome.provisionalTerminalAtMs !== null &&
        (prior.provisionalTerminalAtMs === null || outcome.restarted)
      ) {
        for (const purpose of ["confirmation_15", "confirmation_60"] as const) {
          const dueOffset =
            purpose === "confirmation_15"
              ? CONFIRMATION_15_MS
              : CONFIRMATION_60_MS;
          const scopeKey = confirmationScopeKey(game._id, purpose);
          const existing = await ctx.db
            .query("syncWorkItems")
            .withIndex("by_scopeKey", (q) => q.eq("scopeKey", scopeKey))
            .unique();
          const dueAtMs = outcome.provisionalTerminalAtMs + dueOffset;
          if (existing) {
            await ctx.db.patch(existing._id, {
              status: "due",
              dueAtMs,
              attemptCount: existing.attemptCount,
              claimedAtMs: undefined,
              leaseExpiresAtMs: undefined,
            });
          } else {
            await ctx.db.insert("syncWorkItems", {
              surface: "confirmation",
              scopeKey,
              priority: "confirmation",
              status: "due",
              dueAtMs,
              attemptCount: 0,
              gameId: game._id,
              seasonId: game.seasonId,
              purpose,
            });
          }
          scheduled.push(purpose);
        }
      }

      return {
        gameId: game._id,
        resultAuthority: outcome.resultAuthority,
        scheduledConfirmationLookups: scheduled,
      };
    }

    // Non-terminal live → Projected Result only.
    if (game.resultAuthority !== "verified") {
      patch.resultAuthority = "projected";
    }
    await ctx.db.patch(game._id, patch);
    return {
      gameId: game._id,
      resultAuthority: (patch.resultAuthority as ResultAuthority) ?? game.resultAuthority ?? "projected",
      scheduledConfirmationLookups: [] as string[],
    };
  },
});

/**
 * Apply a targeted confirmation lookup observation.
 */
export const applyConfirmationObservationMutation = internalMutation({
  args: {
    observation: confirmationObservationValidator,
  },
  handler: async (ctx, args) => {
    const { observation } = args;
    const game = await ctx.db.get(observation.gameId);
    if (!game) {
      throw new Error(`NFL Game not found: ${observation.gameId}`);
    }

    const prior = gameConfirmationState(game);
    const outcome = applyConfirmationObservation({
      prior,
      observation: {
        observedAtMs: observation.observedAtMs,
        homeScore: observation.homeScore,
        awayScore: observation.awayScore,
        status: observation.status,
      },
      lookupFailed: observation.lookupFailed,
    });

    const revision = (game.revision ?? 0) + 1;
    const patch: Record<string, unknown> = {
      resultAuthority: outcome.resultAuthority,
      provisionalTerminalAtMs: outcome.provisionalTerminalAtMs ?? undefined,
      confirmationObservations: outcome.observations,
      lastObservedAtMs: observation.observedAtMs,
      revision,
      homeScore: observation.lookupFailed
        ? game.homeScore
        : observation.homeScore,
      awayScore: observation.lookupFailed
        ? game.awayScore
        : observation.awayScore,
      lifecycle:
        observation.lookupFailed
          ? game.lifecycle
          : observation.status === "CANC"
            ? "canceled"
            : "terminal",
    };
    if (outcome.verifiedResult) {
      patch.verifiedResult = outcome.verifiedResult;
    }
    if (outcome.priorVerifiedResult) {
      patch.priorVerifiedResult = {
        ...outcome.priorVerifiedResult,
        supersededAtMs: outcome.justCorrected
          ? observation.observedAtMs
          : (game.priorVerifiedResult?.supersededAtMs ??
            observation.observedAtMs),
      };
    }

    await ctx.db.patch(game._id, patch);

    // Verified / Corrected Result → schedule Scoring Revisions for affected pools.
    if (outcome.justVerified) {
      if (
        !observation.lookupFailed &&
        observation.status === "CANC"
      ) {
        await ctx.scheduler.runAfter(
          0,
          internal.survivorScoring.handleVerifiedCancellation,
          { gameId: game._id, nowMs: observation.observedAtMs },
        );
      }
      await ctx.scheduler.runAfter(
        0,
        internal.survivorScoring.scoreSurvivorPoolsForVerifiedGame,
        { gameId: game._id, nowMs: observation.observedAtMs },
      );
      await ctx.scheduler.runAfter(
        0,
        internal.confidenceScoring.scoreConfidencePoolsForVerifiedGame,
        { gameId: game._id, nowMs: observation.observedAtMs },
      );
      await ctx.scheduler.runAfter(
        SCORING_DELAY_THRESHOLD_MS + 1_000,
        internal.incidents.checkScoringDelayForGame,
        {
          gameId: game._id,
          verifiedAtMs:
            outcome.verifiedResult?.verifiedAtMs ?? observation.observedAtMs,
        },
      );
    }

    // On restart (including correction candidates), reschedule confirmation lookups.
    if (
      outcome.restarted &&
      outcome.provisionalTerminalAtMs !== null &&
      !observation.lookupFailed
    ) {
      for (const purpose of ["confirmation_15", "confirmation_60"] as const) {
        const dueOffset =
          purpose === "confirmation_15" ? CONFIRMATION_15_MS : CONFIRMATION_60_MS;
        const scopeKey = confirmationScopeKey(game._id, purpose);
        const existing = await ctx.db
          .query("syncWorkItems")
          .withIndex("by_scopeKey", (q) => q.eq("scopeKey", scopeKey))
          .unique();
        const dueAtMs = outcome.provisionalTerminalAtMs + dueOffset;
        if (existing) {
          await ctx.db.patch(existing._id, {
            status: "due",
            dueAtMs,
            claimedAtMs: undefined,
            leaseExpiresAtMs: undefined,
          });
        } else {
          await ctx.db.insert("syncWorkItems", {
            surface: "confirmation",
            scopeKey,
            priority: "confirmation",
            status: "due",
            dueAtMs,
            attemptCount: 0,
            gameId: game._id,
            seasonId: game.seasonId,
            purpose,
          });
        }
      }
    }

    // Failed lookup → retry via ordinary path (re-due same purpose if known).
    if (observation.lookupFailed && outcome.pendingRetry) {
      const items = await ctx.db
        .query("syncWorkItems")
        .withIndex("by_gameId", (q) => q.eq("gameId", game._id))
        .collect();
      for (const item of items) {
        if (item.surface === "confirmation" && item.status === "claimed") {
          await ctx.db.patch(item._id, {
            status: "due",
            dueAtMs: observation.observedAtMs + 60_000,
            attemptCount: item.attemptCount + 1,
            claimedAtMs: undefined,
            leaseExpiresAtMs: undefined,
          });
        }
      }
    }

    // Quarantine / contradiction past confirmation window → Operator Incident.
    if (
      !outcome.justVerified &&
      (outcome.resultAuthority === "confirmation_pending" ||
        outcome.resultAuthority === "correction_candidate") &&
      outcome.provisionalTerminalAtMs !== null
    ) {
      const windowEnds =
        outcome.provisionalTerminalAtMs + CONFIRMATION_60_MS;
      if (observation.observedAtMs > windowEnds) {
        await ctx.runMutation(
          internal.incidents.checkQuarantinePastConfirmation,
          {
            gameId: game._id,
            confirmationWindowEndsAtMs: windowEnds,
            verificationBlocked: true,
            nowMs: observation.observedAtMs,
          },
        );
      }
    }

    return {
      gameId: game._id,
      resultAuthority: outcome.resultAuthority,
      justVerified: outcome.justVerified,
      justCorrected: outcome.justCorrected,
      restarted: outcome.restarted,
      pendingRetry: outcome.pendingRetry,
      verifiedResult: outcome.verifiedResult,
    };
  },
});

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
    const fields = {
      surface: args.surface,
      scopeKey: args.scopeKey,
      lastAttemptAtMs: args.nowMs,
      lastSuccessAtMs: args.success
        ? args.nowMs
        : (existing?.lastSuccessAtMs ?? undefined),
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
      await ctx.db.insert("providerExceptions", {
        kind: "sync_failure",
        gameId: args.gameId,
        scopeKey: args.scopeKey,
        message: args.exceptionMessage ?? "Provider Exception",
        createdAtMs: args.nowMs,
      });
      await enqueueSentryDelivery(
        ctx,
        captureException(args.exceptionMessage ?? "Provider Exception", {
          tags: { channel: "sync", surface: args.surface },
          extra: { scopeKey: args.scopeKey },
        }),
      );
    }

    const freshness = deriveFreshness({
      surface:
        args.surface === "confirmation"
          ? "confirmation"
          : args.surface === "schedule"
            ? "schedule"
            : "league_live",
      lastSuccessAtMs: fields.lastSuccessAtMs ?? null,
      nowMs: args.nowMs,
      dueAtMs: args.expectedNextRefreshAtMs ?? null,
      providerException,
    });

    // Operator Incidents: Provider Exception / Stale-in-window open; Late alone
    // does not. Active game window = live or confirmation surfaces.
    const activeGameWindow =
      args.surface === "live" || args.surface === "confirmation";
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

    // Heal: successful fresh refresh auto-resolves matching open incidents.
    if (args.success && !providerException && freshness.state === "fresh") {
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
      v.literal("confirmation"),
      v.literal("correction"),
      v.literal("operator"),
    ),
    scopeKey: v.string(),
    priority: v.union(
      v.literal("routine"),
      v.literal("confirmation"),
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
    .withIndex("by_claimedAtMs", (q) => q.gte("claimedAtMs", since))
    .collect();

  let usage = emptyBudgetUsage();
  for (const claim of claims) {
    if (claim.status !== "claimed") continue;
    if (claim.claimedAtMs < since) continue;
    const priority = claim.priority ?? "routine";
    usage = recordAdmission(usage, priority);
  }
  return usage;
}

const LIVE_LEAD_MS = 15 * 60 * 1000;
const LIVE_CADENCE_MS = 2 * 60 * 1000;

/**
 * Enqueue league-live (and light schedule) work when any NFL Game is in an
 * active window: within 15 minutes of kickoff, in progress, or confirmation-pending.
 */
async function enqueuePhaseAwareWork(
  ctx: MutationCtx,
  nowMs: number,
): Promise<void> {
  const seasons = await ctx.db
    .query("poolSeasons")
    .withIndex("by_status", (q) => q.eq("status", "available"))
    .collect();

  for (const season of seasons) {
    const games = await ctx.db
      .query("nflGames")
      .withIndex("by_seasonId", (q) => q.eq("seasonId", season._id))
      .collect();

    const needsLive = games.some((g) => {
      if (
        g.lifecycle === "in_progress" ||
        g.lifecycle === "interrupted" ||
        g.resultAuthority === "confirmation_pending"
      ) {
        return true;
      }
      const untilKickoff = g.scheduledKickoffMs - nowMs;
      const sinceKickoff = nowMs - g.scheduledKickoffMs;
      // Approaching kickoff or recently kicked off without terminal.
      if (untilKickoff >= 0 && untilKickoff <= LIVE_LEAD_MS) return true;
      if (
        sinceKickoff >= 0 &&
        sinceKickoff <= 4 * 60 * 60 * 1000 &&
        g.lifecycle === "scheduled"
      ) {
        return true;
      }
      return false;
    });

    if (!needsLive) continue;

    const scopeKey = `live:${season._id}`;
    const existing = await ctx.db
      .query("syncWorkItems")
      .withIndex("by_scopeKey", (q) => q.eq("scopeKey", scopeKey))
      .unique();

    if (existing) {
      if (existing.status === "due" || existing.status === "claimed") {
        // Coalesce — leave existing claim/due item.
        continue;
      }
      // Reschedule completed live poll on cadence.
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
        priority: "routine",
        status: "due",
        dueAtMs: nowMs,
        attemptCount: 0,
        seasonId: season._id,
        purpose: "league_live",
      });
    }
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

    if (!gateEnabled) {
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
        denied: "sync_gate_off" as const,
      };
    }

    // Phase-aware enqueue: league-live while any game is in the active window.
    await enqueuePhaseAwareWork(ctx, nowMs);

    // Return expired leases to due.
    const claimedItems = await ctx.db
      .query("syncWorkItems")
      .withIndex("by_status_and_dueAtMs", (q) => q.eq("status", "claimed"))
      .collect();
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

    const dueItems = await ctx.db
      .query("syncWorkItems")
      .withIndex("by_status_and_dueAtMs", (q) => q.eq("status", "due"))
      .collect();

    // Priority order: confirmation → operator → routine (by due time within).
    const priorityRank = (p: BudgetPriority) =>
      p === "confirmation" ? 0 : p === "operator" ? 1 : 2;
    dueItems.sort((a, b) => {
      const pr = priorityRank(a.priority) - priorityRank(b.priority);
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
        item.surface === "correction" || item.surface === "operator"
          ? "confirmation"
          : item.surface === "schedule" ||
              item.surface === "live" ||
              item.surface === "confirmation"
            ? item.surface
            : "live";

      const gateDecision = canClaimProviderFetch(
        { enabled: true },
        surfaceForGate as "schedule" | "live" | "confirmation" | "bootstrap",
      );
      if (!gateDecision.ok) continue;

      const budgetDecision = admitProviderFetch(usage, item.priority);
      if (!budgetDecision.ok) {
        // Try next item — confirmation/operator may still fit when routine can't.
        continue;
      }

      await ctx.db.patch(item._id, {
        status: "claimed",
        claimedAtMs: nowMs,
        leaseExpiresAtMs: nowMs + LEASE_MS,
        attemptCount: item.attemptCount + 1,
      });

      const claimId = await ctx.db.insert("providerFetchClaims", {
        surface: item.surface,
        status: "claimed",
        claimedAtMs: nowMs,
        priority: item.priority,
        workItemId: item._id,
      });
      void claimId;

      usage = recordAdmission(usage, item.priority);
      claimed.push({
        workItemId: item._id,
        surface: item.surface,
        priority: item.priority,
        scopeKey: item.scopeKey,
        gameId: item.gameId,
        purpose: item.purpose,
      });

      // Schedule fetch action — no provider I/O inside this mutation.
      await ctx.scheduler.runAfter(0, internal.syncLive.runClaimedFetch, {
        workItemId: item._id,
        surface: item.surface,
        gameId: item.gameId,
        purpose: item.purpose,
      });
    }

    return { gateEnabled: true, claimed, denied: null };
  },
});

/**
 * Scheduled after a successful claim. Fetches provider data in an action
 * (never from clients). Tests skip this path and inject observations.
 *
 * Free-tier livescore / lookup may be empty; failures record health + retry.
 */
export const runClaimedFetch = internalAction({
  args: {
    workItemId: v.id("syncWorkItems"),
    surface: v.string(),
    gameId: v.optional(v.id("nflGames")),
    purpose: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Production path: fetch via TheSportsDB adapter, then apply mutations.
    // Intentionally no HTTP in the default test path — fixture tests call
    // applyLiveObservation / applyConfirmationObservationMutation directly.
    // When a live key is present, confirmation lookups use fetchEventLookup.
    const { fetchEventLookup, sportsDbApiKey } = await import(
      "./providers/thesportsdb/client"
    );
    const { mapProviderStatusToLifecycle } = await import(
      "./providers/thesportsdb/adapter"
    );

    if (
      args.surface === "confirmation" &&
      args.gameId !== undefined
    ) {
      const game = await ctx.runQuery(internal.syncLive.getGameSyncProjection, {
        gameId: args.gameId,
      });
      if (!game) {
        await ctx.runMutation(internal.syncLive.completeSyncWork, {
          workItemId: args.workItemId,
        });
        return { ok: false as const, reason: "game_missing" };
      }

      // Resolve SportsDB event id from a thin internal query.
      const eventMeta = await ctx.runQuery(internal.syncLive.getGameProviderAlias, {
        gameId: args.gameId,
      });
      if (!eventMeta) {
        await ctx.runMutation(internal.syncLive.applyConfirmationObservationMutation, {
          observation: {
            gameId: args.gameId,
            observedAtMs: Date.now(),
            homeScore: 0,
            awayScore: 0,
            status: "FT",
            lookupFailed: true,
          },
        });
        return { ok: false as const, reason: "alias_missing" };
      }

      try {
        const raw = await fetchEventLookup(
          eventMeta.sportsDbEventId,
          sportsDbApiKey(),
        );
        const nowMs = Date.now();
        if (!raw) {
          await ctx.runMutation(
            internal.syncLive.applyConfirmationObservationMutation,
            {
              observation: {
                gameId: args.gameId,
                observedAtMs: nowMs,
                homeScore: 0,
                awayScore: 0,
                status: "FT",
                lookupFailed: true,
              },
            },
          );
          await ctx.runMutation(internal.syncLive.completeSyncWork, {
            workItemId: args.workItemId,
          });
          return { ok: false as const, reason: "lookup_empty" };
        }

        const lifecycle = mapProviderStatusToLifecycle(raw.strStatus);
        const homeScore =
          raw.intHomeScore === null || raw.intHomeScore === undefined
            ? null
            : Number(raw.intHomeScore);
        const awayScore =
          raw.intAwayScore === null || raw.intAwayScore === undefined
            ? null
            : Number(raw.intAwayScore);
        const statusUpper = (raw.strStatus ?? "").toUpperCase();
        const terminalStatus =
          statusUpper === "FT" || statusUpper === "AOT" || statusUpper === "CANC"
            ? (statusUpper as "FT" | "AOT" | "CANC")
            : null;

        if (
          terminalStatus &&
          homeScore !== null &&
          awayScore !== null &&
          Number.isFinite(homeScore) &&
          Number.isFinite(awayScore)
        ) {
          await ctx.runMutation(
            internal.syncLive.applyConfirmationObservationMutation,
            {
              observation: {
                gameId: args.gameId,
                observedAtMs: nowMs,
                homeScore,
                awayScore,
                status: terminalStatus,
              },
            },
          );
        } else if (lifecycle === "in_progress" || lifecycle === "scheduled") {
          await ctx.runMutation(internal.syncLive.applyLiveObservation, {
            observation: {
              gameId: args.gameId,
              observedAtMs: nowMs,
              lifecycle,
              homeScore: Number.isFinite(homeScore as number)
                ? homeScore
                : null,
              awayScore: Number.isFinite(awayScore as number)
                ? awayScore
                : null,
            },
          });
        } else {
          await ctx.runMutation(
            internal.syncLive.applyConfirmationObservationMutation,
            {
              observation: {
                gameId: args.gameId,
                observedAtMs: nowMs,
                homeScore: 0,
                awayScore: 0,
                status: "FT",
                lookupFailed: true,
              },
            },
          );
        }

        await ctx.runMutation(internal.syncLive.completeSyncWork, {
          workItemId: args.workItemId,
        });
        return { ok: true as const };
      } catch {
        await ctx.runMutation(
          internal.syncLive.applyConfirmationObservationMutation,
          {
            observation: {
              gameId: args.gameId,
              observedAtMs: Date.now(),
              homeScore: 0,
              awayScore: 0,
              status: "FT",
              lookupFailed: true,
            },
          },
        );
        await ctx.runMutation(internal.syncLive.recordSyncSurfaceHealth, {
          surface: "confirmation",
          scopeKey: `confirmation:${args.gameId}`,
          success: false,
          nowMs: Date.now(),
          providerException: true,
          exceptionMessage: "confirmation_fetch_failed",
          gameId: args.gameId,
        });
        return { ok: false as const, reason: "fetch_failed" };
      }
    }

    // League-live / schedule surfaces — fetch then apply normalized observations.
    if (args.surface === "live" || args.surface === "schedule") {
      const { fetchLeagueLivescore, fetchSeasonEvents, sportsDbApiKey } =
        await import("./providers/thesportsdb/client");
      const {
        mapProviderStatusToLifecycle,
        normalizeSeasonEvents,
      } = await import("./providers/thesportsdb/adapter");

      const workMeta = await ctx.runQuery(internal.syncLive.getWorkItemMeta, {
        workItemId: args.workItemId,
      });
      if (!workMeta?.seasonId) {
        await ctx.runMutation(internal.syncLive.completeSyncWork, {
          workItemId: args.workItemId,
        });
        return { ok: false as const, reason: "missing_season" };
      }

      const nowMs = Date.now();
      try {
        if (args.surface === "live") {
          const raw = await fetchLeagueLivescore(sportsDbApiKey());
          let applied = 0;
          for (const event of raw) {
            const gameId = await ctx.runQuery(
              internal.syncLive.findGameBySportsDbEventId,
              { sportsDbEventId: event.idEvent },
            );
            if (!gameId) continue;
            const lifecycle = mapProviderStatusToLifecycle(event.strStatus);
            const homeScore =
              event.intHomeScore === null || event.intHomeScore === undefined
                ? null
                : Number(event.intHomeScore);
            const awayScore =
              event.intAwayScore === null || event.intAwayScore === undefined
                ? null
                : Number(event.intAwayScore);
            const statusUpper = (event.strStatus ?? "").toUpperCase();
            const terminalStatus =
              statusUpper === "FT" ||
              statusUpper === "AOT" ||
              statusUpper === "CANC"
                ? (statusUpper as "FT" | "AOT" | "CANC")
                : undefined;
            await ctx.runMutation(internal.syncLive.applyLiveObservation, {
              observation: {
                gameId,
                observedAtMs: nowMs,
                lifecycle,
                homeScore: Number.isFinite(homeScore as number)
                  ? homeScore
                  : null,
                awayScore: Number.isFinite(awayScore as number)
                  ? awayScore
                  : null,
                terminalStatus,
              },
            });
            applied += 1;
          }
          await ctx.runMutation(internal.syncLive.recordSyncSurfaceHealth, {
            surface: "league_live",
            scopeKey: `live:${workMeta.seasonId}`,
            success: true,
            nowMs,
            expectedNextRefreshAtMs: nowMs + LIVE_CADENCE_MS,
          });
          await ctx.runMutation(internal.syncLive.completeSyncWork, {
            workItemId: args.workItemId,
          });
          return { ok: true as const, applied };
        }

        // Schedule surface — refresh kickoffs from season events.
        const seasonLabel = await ctx.runQuery(
          internal.syncLive.getSeasonLabel,
          { seasonId: workMeta.seasonId },
        );
        if (!seasonLabel) {
          await ctx.runMutation(internal.syncLive.completeSyncWork, {
            workItemId: args.workItemId,
          });
          return { ok: false as const, reason: "season_missing" };
        }
        const rawEvents = await fetchSeasonEvents(
          seasonLabel,
          sportsDbApiKey(),
        );
        const normalized = normalizeSeasonEvents(rawEvents, seasonLabel);
        let applied = 0;
        for (const game of normalized) {
          const gameId = await ctx.runQuery(
            internal.syncLive.findGameBySportsDbEventId,
            { sportsDbEventId: game.aliases.sportsDbEventId },
          );
          if (!gameId) continue;
          await ctx.runMutation(internal.syncLive.applyScheduleObservation, {
            observation: {
              gameId,
              observedAtMs: nowMs,
              scheduledKickoffMs: game.scheduledKickoffMs,
              lifecycle: game.lifecycle,
            },
          });
          applied += 1;
        }
        await ctx.runMutation(internal.syncLive.recordSyncSurfaceHealth, {
          surface: "schedule",
          scopeKey: `schedule:${workMeta.seasonId}`,
          success: true,
          nowMs,
        });
        await ctx.runMutation(internal.syncLive.completeSyncWork, {
          workItemId: args.workItemId,
        });
        return { ok: true as const, applied };
      } catch {
        await ctx.runMutation(internal.syncLive.recordSyncSurfaceHealth, {
          surface: args.surface === "live" ? "league_live" : "schedule",
          scopeKey: `${args.surface}:${workMeta.seasonId}`,
          success: false,
          nowMs,
          providerException: true,
          exceptionMessage: `${args.surface}_fetch_failed`,
        });
        // Leave work due for retry rather than marking done.
        await ctx.runMutation(internal.syncLive.requeueFailedWork, {
          workItemId: args.workItemId,
          dueAtMs: nowMs + 60_000,
        });
        return { ok: false as const, reason: "fetch_failed" };
      }
    }

    await ctx.runMutation(internal.syncLive.completeSyncWork, {
      workItemId: args.workItemId,
    });
    return { ok: true as const };
  },
});

export const getWorkItemMeta = internalQuery({
  args: { workItemId: v.id("syncWorkItems") },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.workItemId);
    if (!item) return null;
    return {
      seasonId: item.seasonId ?? null,
      gameId: item.gameId ?? null,
      surface: item.surface,
      purpose: item.purpose ?? null,
    };
  },
});

export const findGameBySportsDbEventId = internalQuery({
  args: { sportsDbEventId: v.string() },
  handler: async (ctx, args) => {
    const game = await ctx.db
      .query("nflGames")
      .withIndex("by_sportsDbEventId", (q) =>
        q.eq("sportsDbEventId", args.sportsDbEventId),
      )
      .unique();
    return game?._id ?? null;
  },
});

export const getSeasonLabel = internalQuery({
  args: { seasonId: v.id("poolSeasons") },
  handler: async (ctx, args) => {
    const season = await ctx.db.get(args.seasonId);
    return season?.label ?? null;
  },
});

export const requeueFailedWork = internalMutation({
  args: {
    workItemId: v.id("syncWorkItems"),
    dueAtMs: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.workItemId, {
      status: "due",
      dueAtMs: args.dueAtMs,
      claimedAtMs: undefined,
      leaseExpiresAtMs: undefined,
    });
  },
});

export const getGameProviderAlias = internalQuery({
  args: { gameId: v.id("nflGames") },
  handler: async (ctx, args) => {
    const game = await ctx.db.get(args.gameId);
    if (!game) return null;
    return { sportsDbEventId: game.sportsDbEventId, seasonId: game.seasonId };
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
    });
  },
});

/**
 * Public-facing claim used by older Sync Gate tests — now also records priority.
 */
export const claimProviderFetchWithBudget = mutation({
  args: {
    surface: v.union(
      v.literal("schedule"),
      v.literal("live"),
      v.literal("confirmation"),
      v.literal("bootstrap"),
    ),
    priority: v.optional(
      v.union(
        v.literal("routine"),
        v.literal("confirmation"),
        v.literal("operator"),
      ),
    ),
    nowMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) {
      throw new Error("Unauthenticated");
    }
    const nowMs = args.nowMs ?? Date.now();
    const gateEnabled = await loadSyncGateEnabled(ctx);
    const priority: BudgetPriority =
      args.priority ??
      (args.surface === "confirmation"
        ? "confirmation"
        : args.surface === "bootstrap"
          ? "operator"
          : "routine");

    const gateDecision = canClaimProviderFetch(
      { enabled: gateEnabled },
      args.surface,
    );
    if (!gateDecision.ok) {
      await ctx.db.insert("providerFetchClaims", {
        surface: args.surface,
        status: "denied",
        reason: gateDecision.reason,
        claimedAtMs: nowMs,
        priority,
      });
      return { ok: false as const, reason: gateDecision.reason };
    }

    const usage = await budgetUsageInWindow(ctx, nowMs);
    const budgetDecision = admitProviderFetch(usage, priority);
    if (!budgetDecision.ok) {
      await ctx.db.insert("providerFetchClaims", {
        surface: args.surface,
        status: "denied",
        reason: budgetDecision.reason,
        claimedAtMs: nowMs,
        priority,
      });
      return { ok: false as const, reason: budgetDecision.reason };
    }

    await ctx.db.insert("providerFetchClaims", {
      surface: args.surface,
      status: "claimed",
      claimedAtMs: nowMs,
      priority,
    });
    return { ok: true as const, surface: args.surface, priority };
  },
});

export const getGameSyncProjection = internalQuery({
  args: { gameId: v.id("nflGames") },
  handler: async (ctx, args) => {
    const game = await ctx.db.get(args.gameId);
    if (!game) return null;
    const authority = game.resultAuthority ?? "none";
    const isOfficial = authority === "verified";
    return {
      gameId: game._id,
      lifecycle: game.lifecycle,
      resultAuthority: authority,
      projectedHomeScore: game.homeScore,
      projectedAwayScore: game.awayScore,
      isOfficial,
      verifiedResult: game.verifiedResult ?? null,
      provisionalTerminalAtMs: game.provisionalTerminalAtMs ?? null,
      lastObservedAtMs: game.lastObservedAtMs ?? null,
    };
  },
});
