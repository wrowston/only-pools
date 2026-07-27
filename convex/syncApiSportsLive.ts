/**
 * API-Sports league-wide live ingestion.
 *
 * Provider I/O is owned by action edges. Normalized observations cross one
 * mutation at a time so a malformed or unresolved row cannot roll back valid
 * siblings. The first coherent terminal observation becomes Verified here.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  env,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import type { ActionCtx, MutationCtx } from "./_generated/server";
import { runEffect } from "./effect/run";
import { SCORING_DELAY_THRESHOLD_MS } from "./lib/incidents";
import {
  computeWeeklyCutoffMs,
  isGameKickoffLocked,
} from "./lib/pickLock";
import { lifecycleValidator } from "./lib/syncObservations";
import { ApiSportsProvider } from "./providers/apiSports";
import type { ApiSportsGame } from "./providers/apiSports";
import { selectSportsDataProvider } from "./providers/sportsData/config";
import {
  correctionReconciliationSchedule,
  terminalEvidenceMatches,
} from "./providers/sportsData/correctionReconciliation";
import { resolveNflGameAlias } from "./providers/sportsData/identityStore";
import {
  LIVE_REFRESH_CADENCE_MS,
  advanceSuccessfulSlateMiss,
  classifyLiveObservation,
  isExpectedInSuccessfulLiveSlate,
  isLivePollingActive,
  liveObservationFingerprint,
} from "./providers/sportsData/liveSyncPolicy";
import { immediateVerifiedResult } from "./providers/sportsData/resultAuthority";

const providerStatusValidator = v.object({
  rawShort: v.string(),
  rawLong: v.string(),
  recognized: v.boolean(),
  terminal: v.boolean(),
});

const liveObservationValidator = v.object({
  externalId: v.string(),
  observedAtMs: v.number(),
  lifecycle: lifecycleValidator,
  homeScore: v.union(v.number(), v.null()),
  awayScore: v.union(v.number(), v.null()),
  providerStatus: providerStatusValidator,
});

type LiveObservation = {
  externalId: string;
  observedAtMs: number;
  lifecycle: Doc<"nflGames">["lifecycle"];
  homeScore: number | null;
  awayScore: number | null;
  providerStatus: {
    rawShort: string;
    rawLong: string;
    recognized: boolean;
    terminal: boolean;
  };
};

type ApplyResult = {
  status:
    | "unresolved"
    | "stale"
    | "duplicate"
    | "evidence_only"
    | "verified"
    | "incoherent_terminal"
    | "trusted_state"
    | "wrong_target"
    | "applied"
    | "failed";
  gameId: Id<"nflGames"> | null;
  incidentId: Id<"operatorIncidents"> | null;
};

type SuccessfulSlateBatchInput = {
  observations: LiveObservation[];
  nowMs: number;
};

type SuccessfulSlateBatchResult = {
  results: ApplyResult[];
  recoveryGameIds: Id<"nflGames">[];
};

async function openLiveIncident(
  ctx: MutationCtx,
  input: {
    scopeKey: string;
    summary: string;
    nowMs: number;
  },
): Promise<Id<"operatorIncidents">> {
  const dedupeKey = `provider_exception:live:${input.scopeKey}`;
  for (const status of ["open", "acknowledged", "in_progress"] as const) {
    const existing = await ctx.db
      .query("operatorIncidents")
      .withIndex("by_dedupeKey_and_status", (q) =>
        q.eq("dedupeKey", dedupeKey).eq("status", status),
      )
      .unique();
    if (existing) return existing._id;
  }
  return await ctx.db.insert("operatorIncidents", {
    type: "provider_exception",
    status: "open",
    surface: "live",
    scopeKey: input.scopeKey,
    dedupeKey,
    participantVisible: false,
    summary: input.summary,
    openedAtMs: input.nowMs,
    maintenanceLock: false,
  });
}

async function ingestionState(
  ctx: MutationCtx,
  gameId: Id<"nflGames">,
) {
  return await ctx.db
    .query("liveGameIngestionState")
    .withIndex("by_nflGameId", (q) => q.eq("nflGameId", gameId))
    .unique();
}

async function enqueueCorrectionReconciliation(
  ctx: MutationCtx,
  input: {
    gameId: Id<"nflGames">;
    seasonId: Id<"poolSeasons">;
    verifiedAtMs: number;
  },
): Promise<void> {
  for (const item of correctionReconciliationSchedule(input.verifiedAtMs)) {
    const scopeKey = `result-reconciliation:${input.gameId}:${item.purpose}`;
    const existing = await ctx.db
      .query("syncWorkItems")
      .withIndex("by_scopeKey", (q) => q.eq("scopeKey", scopeKey))
      .unique();
    if (existing) continue;
    await ctx.db.insert("syncWorkItems", {
      surface: "correction",
      scopeKey,
      priority: "confirmation",
      status: "due",
      dueAtMs: item.dueAtMs,
      attemptCount: 0,
      gameId: input.gameId,
      seasonId: input.seasonId,
      purpose: item.purpose,
    });
  }
}

async function hasLaterPoolWeekDependency(
  ctx: MutationCtx,
  game: Doc<"nflGames">,
  observedAtMs: number,
): Promise<boolean> {
  const pools = await ctx.db
    .query("pools")
    .withIndex("by_seasonId", (q) => q.eq("seasonId", game.seasonId))
    .take(201);
  if (pools.length > 200) return true;
  const seasonGames = await ctx.db
    .query("nflGames")
    .withIndex("by_seasonId", (q) => q.eq("seasonId", game.seasonId))
    .take(401);
  if (seasonGames.length > 400) return true;
  const laterGames = seasonGames.filter(
    (candidate) => candidate.week > game.week,
  );
  const laterGameLockReached = laterGames.some((candidate) =>
    isGameKickoffLocked(candidate, observedAtMs),
  );
  const laterWeeklyCutoffs = new Map<number, number>();
  for (const candidate of laterGames) {
    const current = laterWeeklyCutoffs.get(candidate.week);
    if (current === undefined || candidate.scheduledKickoffMs < current) {
      laterWeeklyCutoffs.set(candidate.week, candidate.scheduledKickoffMs);
    }
  }
  const laterWeeklyCutoffReached = [...laterWeeklyCutoffs.values()].some(
    (anchorMs) => observedAtMs >= computeWeeklyCutoffMs(anchorMs),
  );
  for (const pool of pools) {
    if (pool.startWeek > game.week) continue;
    if (laterGameLockReached) return true;
    if (
      pool.pickLockMode === "weeklyCutoff" &&
      laterWeeklyCutoffReached
    ) {
      return true;
    }
    const laterSettledPoolWeek = await ctx.db
      .query("poolWeeks")
      .withIndex("by_poolId_and_settled_and_week", (q) =>
        q
          .eq("poolId", pool._id)
          .eq("settled", true)
          .gt("week", game.week),
      )
      .first();
    if (laterSettledPoolWeek) return true;

    const laterSurvivorLock = await ctx.db
      .query("survivorPicks")
      .withIndex("by_poolId_and_locked_and_week", (q) =>
        q
          .eq("poolId", pool._id)
          .eq("locked", true)
          .gt("week", game.week),
      )
      .first();
    if (laterSurvivorLock) return true;

    const laterNonProvisionalSurvivorPick = await ctx.db
      .query("survivorPicks")
      .withIndex("by_poolId_and_provisional_and_week", (q) =>
        q
          .eq("poolId", pool._id)
          .eq("provisional", false)
          .gt("week", game.week),
      )
      .first();
    if (laterNonProvisionalSurvivorPick) return true;

    const laterConfidenceLock = await ctx.db
      .query("confidencePicks")
      .withIndex("by_poolId_and_locked_and_week", (q) =>
        q
          .eq("poolId", pool._id)
          .eq("locked", true)
          .gt("week", game.week),
      )
      .first();
    if (laterConfidenceLock) return true;
  }
  return false;
}

export const hasActiveWindow = internalQuery({
  args: { nowMs: v.number() },
  handler: async (ctx, args) => {
    const seasons = await ctx.db
      .query("poolSeasons")
      .withIndex("by_status", (q) => q.eq("status", "available"))
      .order("desc")
      .take(4);
    for (const season of seasons) {
      const games = await ctx.db
        .query("nflGames")
        .withIndex("by_seasonId", (q) => q.eq("seasonId", season._id))
        .take(400);
      if (games.some((game) => isLivePollingActive(game, args.nowMs))) {
        return true;
      }
    }
    return false;
  },
});

export const getApiSportsAlias = internalQuery({
  args: { gameId: v.id("nflGames") },
  handler: async (ctx, args) => {
    const aliases = await ctx.db
      .query("nflGameAliases")
      .withIndex("by_nflGameId_and_provider_and_isCurrent", (q) =>
        q
          .eq("nflGameId", args.gameId)
          .eq("provider", "api-sports")
          .eq("isCurrent", true),
      )
      .take(2);
    return aliases.length === 1 ? aliases[0]!.externalId : null;
  },
});

export const recordUnresolvedRecovery = internalMutation({
  args: {
    gameId: v.id("nflGames"),
    nowMs: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    return await openLiveIncident(ctx, {
      scopeKey: `recovery:${args.gameId}`,
      summary: `Targeted live-score recovery did not resolve (${args.reason}); the last trusted state was preserved.`,
      nowMs: args.nowMs,
    });
  },
});

export const recordCorrectionFailure = internalMutation({
  args: {
    gameId: v.id("nflGames"),
    nowMs: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    return await openLiveIncident(ctx, {
      scopeKey: `correction:${args.gameId}`,
      summary: `API-Sports result reconciliation failed (${args.reason}); the current Verified Result was preserved.`,
      nowMs: args.nowMs,
    });
  },
});

export const recordMalformedLiveRows = internalMutation({
  args: {
    nowMs: v.number(),
    failureCount: v.number(),
  },
  handler: async (ctx, args) => {
    if (args.failureCount <= 0) return null;
    return await openLiveIncident(ctx, {
      scopeKey: "malformed-live-slate-row",
      summary: `${args.failureCount} API-Sports live row(s) were quarantined; valid sibling rows continued and trusted game state was preserved.`,
      nowMs: args.nowMs,
    });
  },
});

export const applyObservation = internalMutation({
  args: {
    observation: liveObservationValidator,
    expectedGameId: v.optional(v.id("nflGames")),
  },
  handler: async (ctx, args) => {
    const observation: LiveObservation = args.observation;
    const ownership = await resolveNflGameAlias(ctx, {
      provider: "api-sports",
      externalId: observation.externalId,
    });
    if (ownership.kind !== "owned") {
      if (args.expectedGameId !== undefined) {
        return {
          status: "unresolved" as const,
          gameId: null,
          incidentId: null,
        };
      }
      const incidentId = await openLiveIncident(ctx, {
        scopeKey: `game-alias:${observation.externalId}`,
        summary:
          "A live NFL Game could not be matched; the last trusted state was preserved.",
        nowMs: observation.observedAtMs,
      });
      return {
        status: "unresolved" as const,
        gameId: null,
        incidentId,
      };
    }

    const gameId = ownership.ownerId;
    if (
      args.expectedGameId !== undefined &&
      gameId !== args.expectedGameId
    ) {
      return {
        status: "wrong_target" as const,
        gameId: null,
        incidentId: null,
      };
    }
    const game = await ctx.db.get(gameId);
    if (!game) {
      return { status: "unresolved" as const, gameId: null, incidentId: null };
    }
    const state = await ingestionState(ctx, gameId);
    const normalized = {
      provider: "api-sports",
      ...observation,
    };
    const fingerprint = liveObservationFingerprint(normalized);
    const decision = classifyLiveObservation({
      observation: normalized,
      lastAppliedObservedAtMs: state?.lastAppliedObservedAtMs,
      lastFingerprint: state?.lastFingerprint,
      hasVerifiedResult: game.resultAuthority === "verified",
    });

    if (decision === "stale") {
      return { status: "stale" as const, gameId, incidentId: null };
    }
    if (decision === "duplicate") {
      if (
        state &&
        observation.observedAtMs > (state.lastAppliedObservedAtMs ?? 0)
      ) {
        await ctx.db.patch(state._id, {
          lastAppliedObservedAtMs: observation.observedAtMs,
        });
      }
      return { status: "duplicate" as const, gameId, incidentId: null };
    }

    if (decision === "evidence_only") {
      const evidence = await ctx.db
        .query("sportsDataStatusEvidence")
        .withIndex(
          "by_provider_and_externalId_and_rawShort_and_rawLong",
          (q) =>
            q
              .eq("provider", "api-sports")
              .eq("externalId", observation.externalId)
              .eq("rawShort", observation.providerStatus.rawShort)
              .eq("rawLong", observation.providerStatus.rawLong),
        )
        .unique();
      if (evidence) {
        await ctx.db.patch(evidence._id, {
          lastObservedAtMs: observation.observedAtMs,
          observationCount: evidence.observationCount + 1,
        });
      } else {
        await ctx.db.insert("sportsDataStatusEvidence", {
          provider: "api-sports",
          externalId: observation.externalId,
          nflGameId: gameId,
          rawShort: observation.providerStatus.rawShort,
          rawLong: observation.providerStatus.rawLong,
          recognized: false,
          firstObservedAtMs: observation.observedAtMs,
          lastObservedAtMs: observation.observedAtMs,
          observationCount: 1,
        });
      }
    }

    if (!state) {
      await ctx.db.insert("liveGameIngestionState", {
        nflGameId: gameId,
        lastFingerprint: fingerprint,
        lastAppliedObservedAtMs: observation.observedAtMs,
        consecutiveSuccessfulSlateMisses: 0,
      });
    } else {
      await ctx.db.patch(state._id, {
        lastFingerprint: fingerprint,
        lastAppliedObservedAtMs: observation.observedAtMs,
        consecutiveSuccessfulSlateMisses: 0,
      });
    }

    if (decision === "apply_verified") {
      const terminal = immediateVerifiedResult(observation);
      if (!terminal.accepted) {
        const incidentId = await openLiveIncident(ctx, {
          scopeKey: `terminal:${observation.externalId}`,
          summary:
            "API-Sports terminal evidence was incoherent; the last trusted NFL Game state was preserved.",
          nowMs: observation.observedAtMs,
        });
        return {
          status: "incoherent_terminal" as const,
          gameId,
          incidentId,
        };
      }

      await ctx.db.patch(gameId, {
        lifecycle:
          terminal.result.status === "CANC" ? "canceled" : "terminal",
        homeScore: terminal.result.homeScore,
        awayScore: terminal.result.awayScore,
        resultAuthority: "verified",
        verifiedResult: terminal.result,
        provisionalTerminalAtMs: undefined,
        confirmationObservations: undefined,
        lastObservedAtMs: observation.observedAtMs,
        kickoffLockReachedAtMs:
          game.kickoffLockReachedAtMs ?? observation.observedAtMs,
        revision: (game.revision ?? 0) + 1,
      });
      await enqueueCorrectionReconciliation(ctx, {
        gameId,
        seasonId: game.seasonId,
        verifiedAtMs: terminal.result.verifiedAtMs,
      });
      if (terminal.result.status === "CANC") {
        await ctx.scheduler.runAfter(
          0,
          internal.survivorScoring.handleVerifiedCancellation,
          { gameId, nowMs: observation.observedAtMs },
        );
      } else {
        await ctx.scheduler.runAfter(
          0,
          internal.survivorScoring.scoreSurvivorPoolsForVerifiedGame,
          { gameId, nowMs: observation.observedAtMs },
        );
      }
      await ctx.scheduler.runAfter(
        0,
        internal.confidenceScoring.scoreConfidencePoolsForVerifiedGame,
        { gameId, nowMs: observation.observedAtMs },
      );
      await ctx.scheduler.runAfter(
        SCORING_DELAY_THRESHOLD_MS + 1_000,
        internal.incidents.checkScoringDelayForGame,
        {
          gameId,
          verifiedAtMs: terminal.result.verifiedAtMs,
        },
      );
      return { status: "verified" as const, gameId, incidentId: null };
    }

    if (decision !== "apply_projected") {
      return { status: decision, gameId, incidentId: null };
    }

    await ctx.db.patch(gameId, {
      lifecycle: observation.lifecycle,
      homeScore: observation.homeScore,
      awayScore: observation.awayScore,
      resultAuthority: "projected",
      lastObservedAtMs: observation.observedAtMs,
      kickoffLockReachedAtMs:
        game.kickoffLockReachedAtMs ??
        (observation.lifecycle === "in_progress" ||
        observation.lifecycle === "interrupted"
          ? observation.observedAtMs
          : undefined),
      revision: (game.revision ?? 0) + 1,
    });
    return { status: "applied" as const, gameId, incidentId: null };
  },
});

export const applyReconciliationObservation = internalMutation({
  args: {
    gameId: v.id("nflGames"),
    observation: liveObservationValidator,
  },
  handler: async (ctx, args) => {
    const game = await ctx.db.get(args.gameId);
    if (
      !game ||
      game.resultAuthority !== "verified" ||
      !game.verifiedResult
    ) {
      return { result: "not_verified" as const };
    }
    const terminal = immediateVerifiedResult(args.observation);
    if (!terminal.accepted) {
      return { result: "rejected" as const };
    }
    const evidence = {
      observedAtMs: args.observation.observedAtMs,
      homeScore: terminal.result.homeScore,
      awayScore: terminal.result.awayScore,
      status: terminal.result.status,
      matchesVerified: terminalEvidenceMatches(
        game.verifiedResult,
        terminal.result,
      ),
    };
    if (
      game.lastObservedAtMs !== undefined &&
      args.observation.observedAtMs < game.lastObservedAtMs
    ) {
      await ctx.db.insert("nflGameResultReconciliationObservations", {
        nflGameId: game._id,
        ...evidence,
        disposition: "stale",
      });
      return { result: "stale" as const };
    }

    if (evidence.matchesVerified) {
      await ctx.db.insert("nflGameResultReconciliationObservations", {
        nflGameId: game._id,
        ...evidence,
        disposition: "unchanged",
      });
      await ctx.db.patch(game._id, {
        correctionCandidate: undefined,
        lastObservedAtMs: args.observation.observedAtMs,
        revision: (game.revision ?? 0) + 1,
      });
      return { result: "unchanged" as const };
    }

    const candidate = {
      homeScore: terminal.result.homeScore,
      awayScore: terminal.result.awayScore,
      observedAtMs: args.observation.observedAtMs,
      status: terminal.result.status,
    };
    if (
      await hasLaterPoolWeekDependency(
        ctx,
        game,
        args.observation.observedAtMs,
      )
    ) {
      await ctx.db.insert("nflGameResultReconciliationObservations", {
        nflGameId: game._id,
        ...evidence,
        disposition: "candidate",
      });
      await ctx.db.patch(game._id, {
        correctionCandidate: candidate,
        lastObservedAtMs: args.observation.observedAtMs,
        revision: (game.revision ?? 0) + 1,
      });
      return { result: "candidate" as const };
    }

    await ctx.db.insert("nflGameResultHistory", {
      nflGameId: game._id,
      homeScore: game.verifiedResult.homeScore,
      awayScore: game.verifiedResult.awayScore,
      status: game.verifiedResult.status,
      verifiedAtMs: game.verifiedResult.verifiedAtMs,
      supersededAtMs: args.observation.observedAtMs,
    });
    await ctx.db.insert("nflGameResultReconciliationObservations", {
      nflGameId: game._id,
      ...evidence,
      disposition: "corrected",
    });
    await ctx.db.patch(game._id, {
      lifecycle:
        terminal.result.status === "CANC" ? "canceled" : "terminal",
      homeScore: terminal.result.homeScore,
      awayScore: terminal.result.awayScore,
      verifiedResult: terminal.result,
      priorVerifiedResult: {
        ...game.verifiedResult,
        supersededAtMs: args.observation.observedAtMs,
      },
      correctionCandidate: undefined,
      lastObservedAtMs: args.observation.observedAtMs,
      revision: (game.revision ?? 0) + 1,
    });
    if (terminal.result.status === "CANC") {
      await ctx.scheduler.runAfter(
        0,
        internal.survivorScoring.handleVerifiedCancellation,
        { gameId: game._id, nowMs: args.observation.observedAtMs },
      );
    } else {
      await ctx.scheduler.runAfter(
        0,
        internal.survivorScoring.scoreSurvivorPoolsForVerifiedGame,
        { gameId: game._id, nowMs: args.observation.observedAtMs },
      );
    }
    await ctx.scheduler.runAfter(
      0,
      internal.confidenceScoring.scoreConfidencePoolsForVerifiedGame,
      {
        gameId: game._id,
        nowMs: args.observation.observedAtMs,
        replayLaterWeeks: true,
      },
    );
    await ctx.scheduler.runAfter(
      SCORING_DELAY_THRESHOLD_MS + 1_000,
      internal.incidents.checkScoringDelayForGame,
      {
        gameId: game._id,
        verifiedAtMs: terminal.result.verifiedAtMs,
      },
    );
    return { result: "corrected" as const };
  },
});

export const reconcileSuccessfulSlate = internalMutation({
  args: {
    nowMs: v.number(),
    seenGameIds: v.array(v.id("nflGames")),
  },
  handler: async (ctx, args) => {
    const seen = new Set(args.seenGameIds);
    const seasons = await ctx.db
      .query("poolSeasons")
      .withIndex("by_status", (q) => q.eq("status", "available"))
      .order("desc")
      .take(4);
    const recoveryGameIds: Id<"nflGames">[] = [];

    for (const season of seasons) {
      const games = await ctx.db
        .query("nflGames")
        .withIndex("by_seasonId", (q) => q.eq("seasonId", season._id))
        .take(400);
      for (const game of games) {
        if (!isExpectedInSuccessfulLiveSlate(game, args.nowMs)) {
          continue;
        }
        const state = await ingestionState(ctx, game._id);
        const next = advanceSuccessfulSlateMiss({
          previousMisses: state?.consecutiveSuccessfulSlateMisses ?? 0,
          expected: true,
          present: seen.has(game._id),
        });
        if (!state) {
          await ctx.db.insert("liveGameIngestionState", {
            nflGameId: game._id,
            consecutiveSuccessfulSlateMisses: next.misses,
            lastSuccessfulSlateAtMs: args.nowMs,
          });
        } else {
          await ctx.db.patch(state._id, {
            consecutiveSuccessfulSlateMisses: next.misses,
            lastSuccessfulSlateAtMs: args.nowMs,
          });
        }
        if (!next.enqueueTargetedRecovery) continue;
        const scopeKey = `live-recovery:${game._id}`;
        const existing = await ctx.db
          .query("syncWorkItems")
          .withIndex("by_scopeKey", (q) => q.eq("scopeKey", scopeKey))
          .unique();
        if (existing) {
          if (existing.status !== "claimed") {
            await ctx.db.patch(existing._id, {
              status: "due",
              dueAtMs: args.nowMs,
              priority: "confirmation",
            });
          }
        } else {
          await ctx.db.insert("syncWorkItems", {
            surface: "live",
            scopeKey,
            priority: "confirmation",
            status: "due",
            dueAtMs: args.nowMs,
            attemptCount: 0,
            gameId: game._id,
            purpose: "targeted_live_recovery",
          });
        }
        recoveryGameIds.push(game._id);
      }
    }
    return { recoveryGameIds };
  },
});

async function applySuccessfulSlateBatchForCtx(
  ctx: ActionCtx,
  args: SuccessfulSlateBatchInput,
): Promise<SuccessfulSlateBatchResult> {
  const results: ApplyResult[] = [];
  const seenGameIds: Id<"nflGames">[] = [];
  for (const observation of args.observations) {
    try {
      const result: ApplyResult = await ctx.runMutation(
        internal.syncApiSportsLive.applyObservation,
        { observation },
      );
      results.push(result);
      if (result.gameId) seenGameIds.push(result.gameId);
    } catch {
      results.push({
        status: "failed" as const,
        gameId: null,
        incidentId: null,
      });
    }
  }
  const recovery: { recoveryGameIds: Id<"nflGames">[] } =
    await ctx.runMutation(
      internal.syncApiSportsLive.reconcileSuccessfulSlate,
      { nowMs: args.nowMs, seenGameIds },
    );
  return { results, ...recovery };
}

/**
 * Testable no-HTTP boundary. Production invokes the same ActionCtx helper
 * directly, without a same-runtime ctx.runAction hop.
 */
export const applySuccessfulSlateBatch = internalAction({
  args: {
    observations: v.array(liveObservationValidator),
    nowMs: v.number(),
  },
  handler: (ctx, args) => applySuccessfulSlateBatchForCtx(ctx, args),
});

function liveInput(game: ApiSportsGame): LiveObservation | null {
  const alias = game.providerAliases.find(
    (candidate) => candidate.provider === "api-sports",
  );
  if (!alias) return null;
  return {
    externalId: alias.id,
    observedAtMs: game.observedAtMs,
    lifecycle: game.lifecycle,
    homeScore: game.homeScore,
    awayScore: game.awayScore,
    providerStatus: game.providerStatus,
  };
}

function configuredProvider(): ApiSportsProvider {
  return selectSportsDataProvider({
    config: {
      provider: env.SPORTS_DATA_PROVIDER,
      apiSportsKey: env.API_SPORTS_KEY,
    },
    providers: {
      "api-sports": ({ apiKey }) => new ApiSportsProvider({ apiKey }),
    },
  }) as ApiSportsProvider;
}

/** Selected-provider action for the single global league-wide live request. */
export const runClaimedLiveFetch = internalAction({
  args: { workItemId: v.id("syncWorkItems") },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: boolean; applied?: number; reason?: string }> => {
    const nowMs = Date.now();
    const active: boolean = await ctx.runQuery(
      internal.syncApiSportsLive.hasActiveWindow,
      { nowMs },
    );
    if (!active) {
      await ctx.runMutation(internal.syncLive.completeSyncWork, {
        workItemId: args.workItemId,
      });
      return { ok: true, applied: 0, reason: "outside_live_window" };
    }

    try {
      const result = await runEffect(
        configuredProvider().listLiveGamesWithFailures(),
      );
      const observations = result.games
        .map(liveInput)
        .filter((item): item is LiveObservation => item !== null);
      if (result.failures.length > 0) {
        await ctx.runMutation(
          internal.syncApiSportsLive.recordMalformedLiveRows,
          {
            nowMs,
            failureCount: result.failures.length,
          },
        );
      }
      const batch = await applySuccessfulSlateBatchForCtx(ctx, {
        observations,
        nowMs,
      });
      await ctx.runMutation(internal.syncLive.recordSyncSurfaceHealth, {
        surface: "league_live",
        scopeKey: "live:nfl",
        success: true,
        nowMs,
        expectedNextRefreshAtMs: nowMs + 60_000,
      });
      await ctx.runMutation(internal.syncLive.completeSyncWork, {
        workItemId: args.workItemId,
      });
      return {
        ok: true,
        applied: batch.results.filter((item) => item.status === "applied")
          .length,
      };
    } catch {
      await ctx.runMutation(internal.syncLive.recordSyncSurfaceHealth, {
        surface: "league_live",
        scopeKey: "live:nfl",
        success: false,
        nowMs,
        providerException: true,
        exceptionMessage: "api_sports_live_fetch_failed",
      });
      await ctx.runMutation(internal.syncLive.requeueFailedWork, {
        workItemId: args.workItemId,
        dueAtMs: nowMs + 60_000,
      });
      return { ok: false, reason: "live_fetch_failed" };
    }
  },
});

async function failTargetedLookupForCtx(
  ctx: ActionCtx,
  input: {
    workItemId: Id<"syncWorkItems">;
    gameId: Id<"nflGames">;
    nowMs: number;
    reason: string;
  },
): Promise<{ ok: false; reason: string }> {
  await ctx.runMutation(
    internal.syncApiSportsLive.recordUnresolvedRecovery,
    {
      gameId: input.gameId,
      nowMs: input.nowMs,
      reason: input.reason,
    },
  );
  await ctx.runMutation(internal.syncLive.requeueFailedWork, {
    workItemId: input.workItemId,
    dueAtMs: input.nowMs + LIVE_REFRESH_CADENCE_MS,
  });
  return { ok: false, reason: input.reason };
}

async function applyTargetedLookupForCtx(
  ctx: ActionCtx,
  input: {
    workItemId: Id<"syncWorkItems">;
    gameId: Id<"nflGames">;
    requestedExternalId: string;
    observation: LiveObservation | null;
    nowMs: number;
  },
): Promise<{ ok: boolean; reason?: string }> {
  if (input.observation === null) {
    return await failTargetedLookupForCtx(ctx, {
      ...input,
      reason: "empty_lookup",
    });
  }
  if (input.observation.externalId !== input.requestedExternalId) {
    return await failTargetedLookupForCtx(ctx, {
      ...input,
      reason: "wrong_game_response",
    });
  }

  const result: ApplyResult = await ctx.runMutation(
    internal.syncApiSportsLive.applyObservation,
    {
      observation: input.observation,
      expectedGameId: input.gameId,
    },
  );
  if (result.gameId !== input.gameId) {
    return await failTargetedLookupForCtx(ctx, {
      ...input,
      reason:
        result.status === "wrong_target"
          ? "wrong_game_identity"
          : "unresolved_game_identity",
    });
  }

  await ctx.runMutation(internal.syncLive.completeSyncWork, {
    workItemId: input.workItemId,
  });
  return { ok: true };
}

/** Test boundary for provider-returned targeted lookup evidence. */
export const applyTargetedLookupResult = internalAction({
  args: {
    workItemId: v.id("syncWorkItems"),
    gameId: v.id("nflGames"),
    requestedExternalId: v.string(),
    observation: v.union(liveObservationValidator, v.null()),
    nowMs: v.number(),
  },
  handler: (ctx, args) => applyTargetedLookupForCtx(ctx, args),
});

async function failReconciliationForCtx(
  ctx: ActionCtx,
  input: {
    workItemId: Id<"syncWorkItems">;
    gameId: Id<"nflGames">;
    nowMs: number;
    reason: string;
  },
): Promise<{ ok: false; reason: string }> {
  await ctx.runMutation(
    internal.syncApiSportsLive.recordCorrectionFailure,
    {
      gameId: input.gameId,
      nowMs: input.nowMs,
      reason: input.reason,
    },
  );
  await ctx.runMutation(internal.syncLive.requeueFailedWork, {
    workItemId: input.workItemId,
    dueAtMs: input.nowMs + LIVE_REFRESH_CADENCE_MS,
  });
  return { ok: false, reason: input.reason };
}

async function applyReconciliationLookupForCtx(
  ctx: ActionCtx,
  input: {
    workItemId: Id<"syncWorkItems">;
    gameId: Id<"nflGames">;
    requestedExternalId: string;
    observation: LiveObservation | null;
    nowMs: number;
  },
): Promise<{
  ok: boolean;
  result?:
    | "unchanged"
    | "candidate"
    | "corrected"
    | "not_verified"
    | "stale";
  reason?: string;
}> {
  if (input.observation === null) {
    return await failReconciliationForCtx(ctx, {
      ...input,
      reason: "empty_lookup",
    });
  }
  if (input.observation.externalId !== input.requestedExternalId) {
    return await failReconciliationForCtx(ctx, {
      ...input,
      reason: "wrong_game_response",
    });
  }
  const applied = await ctx.runMutation(
    internal.syncApiSportsLive.applyReconciliationObservation,
    {
      gameId: input.gameId,
      observation: input.observation,
    },
  );
  if (applied.result === "rejected") {
    return await failReconciliationForCtx(ctx, {
      ...input,
      reason: "incoherent_terminal",
    });
  }
  await ctx.runMutation(internal.syncLive.completeSyncWork, {
    workItemId: input.workItemId,
  });
  return { ok: true, result: applied.result };
}

/** Test boundary for one scheduled post-verification targeted lookup. */
export const applyReconciliationLookupResult = internalAction({
  args: {
    workItemId: v.id("syncWorkItems"),
    gameId: v.id("nflGames"),
    requestedExternalId: v.string(),
    observation: v.union(liveObservationValidator, v.null()),
    nowMs: v.number(),
  },
  handler: (ctx, args) => applyReconciliationLookupForCtx(ctx, args),
});

/** Per-game recovery request; an empty/unusable response opens one incident. */
export const runClaimedTargetedRecovery = internalAction({
  args: {
    workItemId: v.id("syncWorkItems"),
    gameId: v.id("nflGames"),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: boolean; reason?: string }> => {
    const nowMs = Date.now();
    const externalId: string | null = await ctx.runQuery(
      internal.syncApiSportsLive.getApiSportsAlias,
      { gameId: args.gameId },
    );
    if (!externalId) {
      return await failTargetedLookupForCtx(ctx, {
        workItemId: args.workItemId,
        gameId: args.gameId,
        nowMs,
        reason: "alias_missing",
      });
    }
    try {
      const game = (await runEffect(
        configuredProvider().getGame({
          provider: "api-sports",
          id: externalId,
        }),
      )) as ApiSportsGame | null;
      const observation = game ? liveInput(game) : null;
      return await applyTargetedLookupForCtx(ctx, {
        workItemId: args.workItemId,
        gameId: args.gameId,
        requestedExternalId: externalId,
        observation,
        nowMs,
      });
    } catch {
      return await failTargetedLookupForCtx(ctx, {
        workItemId: args.workItemId,
        gameId: args.gameId,
        nowMs,
        reason: "lookup_failed",
      });
    }
  },
});

/** Claimed correction work always performs one provider-targeted game lookup. */
export const runClaimedResultReconciliation = internalAction({
  args: {
    workItemId: v.id("syncWorkItems"),
    gameId: v.id("nflGames"),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    ok: boolean;
    result?:
      | "unchanged"
      | "candidate"
      | "corrected"
      | "not_verified"
      | "stale";
    reason?: string;
  }> => {
    const nowMs = Date.now();
    const externalId: string | null = await ctx.runQuery(
      internal.syncApiSportsLive.getApiSportsAlias,
      { gameId: args.gameId },
    );
    if (!externalId) {
      return await failReconciliationForCtx(ctx, {
        ...args,
        nowMs,
        reason: "alias_missing",
      });
    }
    try {
      const game = (await runEffect(
        configuredProvider().getGame({
          provider: "api-sports",
          id: externalId,
        }),
      )) as ApiSportsGame | null;
      return await applyReconciliationLookupForCtx(ctx, {
        ...args,
        requestedExternalId: externalId,
        observation: game ? liveInput(game) : null,
        nowMs,
      });
    } catch {
      return await failReconciliationForCtx(ctx, {
        ...args,
        nowMs,
        reason: "lookup_failed",
      });
    }
  },
});
