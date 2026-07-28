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
import type { ApiSportsRequestFence } from "./effect/apiSports/client";
import { SCORING_DELAY_THRESHOLD_MS } from "./lib/incidents";
import {
  computeWeeklyCutoffMs,
  isGameKickoffLocked,
} from "./lib/pickLock";
import {
  latestScoringDependencyEventId,
  recordScoringDependencyEvent,
  type ScoringHoldDependency,
  recordBlockedScoringWork,
  scoringHoldCandidateKey,
  scoringHoldDedupeKey,
  selectScoringHoldDependency,
} from "./lib/scoringHolds";
import {
  hasPinnedResultEvidence,
  PINNED_RESULT_EVIDENCE_CADENCE_MS,
  recordPinnedProviderEvidence,
} from "./lib/pinnedResultEvidence";
import { lifecycleValidator } from "./lib/syncObservations";
import { createReliableApiSportsFetch } from "./effect/apiSports/reliableFetch";
import {
  createApiSportsProviderFactory,
  selectSportsDataProvider,
} from "./providers/sportsData/config";
import type {
  SportsDataGameObservation,
  SportsDataProvider,
} from "./providers/sportsData/types";
import {
  correctionReconciliationSchedule,
  terminalEvidenceMatches,
} from "./providers/sportsData/correctionReconciliation";
import { resolveNflGameAlias } from "./providers/sportsData/identityStore";
import {
  LIVE_REFRESH_CADENCE_MS,
  advanceSuccessfulSlateMiss,
  classifyLiveObservation,
  isBeforeLiveWindowStart,
  isExpectedInSuccessfulLiveSlate,
  isLivePollingActive,
  liveObservationFingerprint,
} from "./providers/sportsData/liveSyncPolicy";
import { immediateVerifiedResult } from "./providers/sportsData/resultAuthority";
import {
  providerEvidenceState,
  recordProviderGameTransition,
} from "./providerEvidence";
import {
  productionQualificationFenceValidator,
  requireCurrentProductionQualificationFence,
  type ProductionQualificationFence,
} from "./providerQualification";

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
    | "pinned"
    | "wrong_target"
    | "outside_live_window"
    | "applied"
    | "failed";
  gameId: Id<"nflGames"> | null;
  incidentId: Id<"operatorIncidents"> | null;
};

async function recordGamePollDiagnostic(
  ctx: MutationCtx,
  input: {
    game: Doc<"nflGames">;
    externalId: string;
    surface: "live" | "correction";
    outcome: "no_change" | "quarantined";
    providerStatus?: {
      rawShort: string;
      rawLong: string;
    };
    incidentId?: Id<"operatorIncidents">;
  },
): Promise<void> {
  await ctx.runMutation(
    internal.providerEvidence.recordApiSportsDiagnostic,
    {
      surface: input.surface,
      scopeKey: `game:${input.game._id}`,
      gameId: input.game._id,
      incidentId: input.incidentId,
      endpoint: "/games",
      parameters: { id: input.externalId },
      outcome: input.outcome,
      providerStatus: input.providerStatus
        ? {
            short: input.providerStatus.rawShort,
            long: input.providerStatus.rawLong,
          }
        : undefined,
    },
  );
}

type SuccessfulSlateBatchInput = {
  observations: LiveObservation[];
  nowMs: number;
  productionFence?: ProductionQualificationFence;
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
      priority: "recovery",
      status: "due",
      dueAtMs: item.dueAtMs,
      attemptCount: 0,
      gameId: input.gameId,
      seasonId: input.seasonId,
      purpose: item.purpose,
    });
  }
}

type PoolDependencyContext = Readonly<{
  scopeComplete: boolean;
  laterGameLockReached: boolean;
  laterWeeklyCutoffReached: boolean;
}>;

async function loadPoolDependencyContext(
  ctx: MutationCtx,
  game: Doc<"nflGames">,
  observedAtMs: number,
): Promise<PoolDependencyContext> {
  const seasonGames = await ctx.db
    .query("nflGames")
    .withIndex("by_seasonId", (q) => q.eq("seasonId", game.seasonId))
    .take(401);
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
  return {
    scopeComplete: seasonGames.length <= 400,
    laterGameLockReached,
    laterWeeklyCutoffReached,
  };
}

async function findPagePoolDependencies(
  ctx: MutationCtx,
  input: {
    pools: Doc<"pools">[];
    game: Doc<"nflGames">;
    context: PoolDependencyContext;
  },
): Promise<
  Array<{ pool: Doc<"pools">; dependency: ScoringHoldDependency }>
> {
  const dependencies: Array<{
    pool: Doc<"pools">;
    dependency: ScoringHoldDependency;
  }> = [];
  for (const pool of input.pools) {
    if (pool.startWeek > input.game.week) continue;
    if (!input.context.scopeComplete) {
      dependencies.push({
        pool,
        dependency: "bounded_scope_exceeded",
      });
      continue;
    }
    const laterSettledPoolWeek = await ctx.db
      .query("poolWeeks")
      .withIndex("by_poolId_and_settled_and_week", (q) =>
        q
          .eq("poolId", pool._id)
          .eq("settled", true)
          .gt("week", input.game.week),
      )
      .first();
    const laterSurvivorLock =
      pool.type === "survivor"
        ? await ctx.db
            .query("survivorPicks")
            .withIndex("by_poolId_and_locked_and_week", (q) =>
              q
                .eq("poolId", pool._id)
                .eq("locked", true)
                .gt("week", input.game.week),
            )
            .first()
        : null;
    const laterNonProvisionalSurvivorPick =
      pool.type === "survivor"
        ? await ctx.db
            .query("survivorPicks")
            .withIndex("by_poolId_and_provisional_and_week", (q) =>
              q
                .eq("poolId", pool._id)
                .eq("provisional", false)
                .gt("week", input.game.week),
            )
            .first()
        : null;
    const laterConfidenceLock =
      pool.type === "confidence"
        ? await ctx.db
            .query("confidencePicks")
            .withIndex("by_poolId_and_locked_and_week", (q) =>
              q
                .eq("poolId", pool._id)
                .eq("locked", true)
                .gt("week", input.game.week),
            )
            .first()
        : null;
    const dependency = selectScoringHoldDependency({
      laterGameLockReached: input.context.laterGameLockReached,
      laterWeeklyCutoffReached:
        pool.pickLockMode === "weeklyCutoff" &&
        input.context.laterWeeklyCutoffReached,
      laterSettledPoolWeek: laterSettledPoolWeek !== null,
      laterSurvivorLock: laterSurvivorLock !== null,
      laterNonProvisionalSurvivorPick:
        laterNonProvisionalSurvivorPick !== null,
      laterConfidenceLock: laterConfidenceLock !== null,
    });
    if (dependency) dependencies.push({ pool, dependency });
  }
  return dependencies;
}

async function createScoringHolds(
  ctx: MutationCtx,
  input: {
    game: Doc<"nflGames">;
    candidate: NonNullable<Doc<"nflGames">["correctionCandidate"]>;
    evaluationId?: Id<"scoringHoldEvaluations">;
    dependencies: Array<{
      pool: Doc<"pools">;
      dependency: ScoringHoldDependency;
    }>;
  },
): Promise<number> {
  const verified = input.game.verifiedResult!;
  const candidateKey = scoringHoldCandidateKey({
    gameId: input.game._id,
    ...input.candidate,
  });
  let created = 0;
  for (const { pool, dependency } of input.dependencies) {
    const dedupeKey = scoringHoldDedupeKey({
      poolId: pool._id,
      candidateKey,
    });
    const currentForGame = await ctx.db
      .query("scoringHolds")
      .withIndex("by_poolId_and_gameId_and_status", (q) =>
        q
          .eq("poolId", pool._id)
          .eq("gameId", input.game._id)
          .eq("status", "open"),
      )
      .unique();
    if (currentForGame?.candidateKey === candidateKey) {
      const updates: {
        candidateObservedAtMs?: number;
        evaluationId?: Id<"scoringHoldEvaluations">;
      } = {};
      if (
        input.candidate.observedAtMs >
        currentForGame.candidateObservedAtMs
      ) {
        updates.candidateObservedAtMs = input.candidate.observedAtMs;
      }
      if (
        input.evaluationId &&
        currentForGame.evaluationId !== input.evaluationId
      ) {
        updates.evaluationId = input.evaluationId;
        created += 1;
      }
      if (Object.keys(updates).length > 0) {
        await ctx.db.patch(currentForGame._id, updates);
      }
      continue;
    }
    if (currentForGame) {
      await ctx.db.patch(currentForGame._id, {
        status: "resolved",
        resolvedAtMs: input.candidate.observedAtMs,
        resolution: "superseded_candidate",
        resolvedByTokenIdentifier: "system:result-reconciliation",
        resolvedByClerkUserId: "system",
      });
      await ctx.db.insert("operatorAuditEvents", {
        action: "scoring_hold_superseded",
        actorTokenIdentifier: "system:result-reconciliation",
        actorClerkUserId: "system",
        atMs: input.candidate.observedAtMs,
        detailsJson: JSON.stringify({
          holdId: currentForGame._id,
          poolId: pool._id,
          gameId: input.game._id,
          priorCandidateKey: currentForGame.candidateKey,
          candidateKey,
        }),
      });
    }
    const holdFields = {
      evaluationId: input.evaluationId,
      poolId: pool._id,
      gameId: input.game._id,
      poolType: pool.type,
      gameWeek: input.game.week,
      dependency,
      candidateKey,
      dedupeKey,
      candidateHomeScore: input.candidate.homeScore,
      candidateAwayScore: input.candidate.awayScore,
      candidateObservedAtMs: input.candidate.observedAtMs,
      candidateStatus: input.candidate.status,
      officialHomeScore: verified.homeScore,
      officialAwayScore: verified.awayScore,
      officialVerifiedAtMs: verified.verifiedAtMs,
      officialStatus: verified.status,
      status: "open" as const,
      createdAtMs: input.candidate.observedAtMs,
      resolvedAtMs: undefined,
      resolution: undefined,
      resolvedByTokenIdentifier: undefined,
      resolvedByClerkUserId: undefined,
    };
    const holdId = await ctx.db.insert("scoringHolds", holdFields);
    await ctx.db.insert("operatorAuditEvents", {
      action: "scoring_hold_created",
      actorTokenIdentifier: "system:result-reconciliation",
      actorClerkUserId: "system",
      atMs: input.candidate.observedAtMs,
      detailsJson: JSON.stringify({
        holdId,
        poolId: pool._id,
        gameId: input.game._id,
        candidateKey,
        dependency,
      }),
    });
    created += 1;
  }
  return created;
}

async function scheduleVerifiedScoringReplay(
  ctx: MutationCtx,
  input: {
    gameId: Id<"nflGames">;
    nowMs: number;
  },
): Promise<void> {
  const game = await ctx.db.get(input.gameId);
  if (!game || game.resultAuthority !== "verified") return;
  if (game.verifiedResult?.status === "CANC") {
    await ctx.scheduler.runAfter(
      0,
      internal.survivorScoring.handleVerifiedCancellation,
      { gameId: game._id, nowMs: input.nowMs },
    );
  } else {
    await ctx.scheduler.runAfter(
      0,
      internal.survivorScoring.scoreSurvivorPoolsForVerifiedGame,
      { gameId: game._id, nowMs: input.nowMs },
    );
  }
  await ctx.scheduler.runAfter(
    0,
    internal.confidenceScoring.scoreConfidencePoolsForVerifiedGame,
    {
      gameId: game._id,
      nowMs: input.nowMs,
      replayLaterWeeks: true,
    },
  );
}

async function processScoringHoldCleanup(
  ctx: MutationCtx,
  cleanupId: Id<"scoringHoldCleanups">,
): Promise<{ status: "pending" | "complete"; resolvedHolds: number }> {
  const cleanup = await ctx.db.get(cleanupId);
  if (!cleanup || cleanup.status !== "pending") {
    return {
      status: cleanup?.status ?? "complete",
      resolvedHolds: cleanup?.resolvedHolds ?? 0,
    };
  }

  if (cleanup.phase === "evaluations") {
    const page = await ctx.db
      .query("scoringHoldEvaluations")
      .withIndex("by_gameId_and_candidateKey", (q) =>
        q
          .eq("gameId", cleanup.gameId)
          .eq("candidateKey", cleanup.candidateKey),
      )
      .paginate({
        numItems: 200,
        cursor: cleanup.evaluationCursor ?? null,
      });
    let abandoned = 0;
    for (const evaluation of page.page) {
      if (
        !["building", "complete", "incomplete"].includes(
          evaluation.status,
        )
      ) {
        continue;
      }
      await ctx.db.patch(evaluation._id, {
        status: "abandoned",
        abandonedAtMs: cleanup.startedAtMs,
      });
      abandoned += 1;
    }
    const abandonedEvaluations =
      cleanup.abandonedEvaluations + abandoned;
    if (!page.isDone) {
      await ctx.db.patch(cleanup._id, {
        evaluationCursor: page.continueCursor,
        abandonedEvaluations,
      });
      await ctx.scheduler.runAfter(
        0,
        internal.syncApiSportsLive.continueScoringHoldCleanup,
        { cleanupId: cleanup._id },
      );
      return { status: "pending", resolvedHolds: cleanup.resolvedHolds };
    }
    await ctx.db.patch(cleanup._id, {
      phase: "holds",
      evaluationCursor: undefined,
      abandonedEvaluations,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.syncApiSportsLive.continueScoringHoldCleanup,
      { cleanupId: cleanup._id },
    );
    return { status: "pending", resolvedHolds: cleanup.resolvedHolds };
  }

  const refreshed = cleanup;
  const page = await ctx.db
    .query("scoringHolds")
    .withIndex("by_gameId_and_candidateKey", (q) =>
      q
        .eq("gameId", refreshed.gameId)
        .eq("candidateKey", refreshed.candidateKey),
    )
    .paginate({
      numItems: 200,
      cursor: refreshed.holdCursor ?? null,
    });
  let resolved = 0;
  if (refreshed.reason === "withdrawn_candidate") {
    const blockedPoolWeeks = new Map<
      string,
      (typeof page.page)[number]
    >();
    for (const hold of page.page) {
      if (hold.status === "open") {
        blockedPoolWeeks.set(`${hold.poolId}:${hold.gameWeek}`, hold);
      }
    }
    for (const hold of blockedPoolWeeks.values()) {
      await recordBlockedScoringWork(ctx, {
        poolId: hold.poolId,
        kind: hold.poolType,
        week: hold.gameWeek,
        gate: {
          kind: "cleanup",
          cleanup: refreshed,
          candidateKey: refreshed.candidateKey,
          gameWeek: refreshed.gameWeek,
        },
        nowMs: refreshed.startedAtMs,
      });
    }
  }
  for (const hold of page.page) {
    if (hold.status !== "open") continue;
    await ctx.db.patch(hold._id, {
      status: "resolved",
      resolvedAtMs: refreshed.startedAtMs,
      resolution: refreshed.reason,
      resolvedByTokenIdentifier: "system:result-reconciliation",
      resolvedByClerkUserId: "system",
    });
    await ctx.db.insert("operatorAuditEvents", {
      action:
        refreshed.reason === "withdrawn_candidate"
          ? "scoring_hold_withdrawn"
          : "scoring_hold_superseded",
      actorTokenIdentifier: "system:result-reconciliation",
      actorClerkUserId: "system",
      atMs: refreshed.startedAtMs,
      detailsJson: JSON.stringify({
        holdId: hold._id,
        poolId: hold.poolId,
        gameId: refreshed.gameId,
        candidateKey: hold.candidateKey,
      }),
    });
    resolved += 1;
  }
  const resolvedHolds = refreshed.resolvedHolds + resolved;
  if (!page.isDone) {
    await ctx.db.patch(refreshed._id, {
      holdCursor: page.continueCursor,
      resolvedHolds,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.syncApiSportsLive.continueScoringHoldCleanup,
      { cleanupId: refreshed._id },
    );
    return { status: "pending", resolvedHolds };
  }
  await ctx.db.patch(refreshed._id, {
    status: "complete",
    holdCursor: undefined,
    resolvedHolds,
    completedAtMs: refreshed.startedAtMs,
  });
  await scheduleVerifiedScoringReplay(ctx, {
    gameId: refreshed.gameId,
    nowMs: refreshed.startedAtMs,
  });
  return { status: "complete", resolvedHolds };
}

async function startScoringHoldCleanup(
  ctx: MutationCtx,
  input: {
    game: Doc<"nflGames">;
    candidateKey: string;
    reason: "superseded_candidate" | "withdrawn_candidate";
    startedAtMs: number;
  },
): Promise<{
  cleanupId: Id<"scoringHoldCleanups">;
  status: "pending" | "complete";
  resolvedHolds: number;
}> {
  const existing = await ctx.db
    .query("scoringHoldCleanups")
    .withIndex("by_gameId_and_candidateKey_and_status", (q) =>
      q
        .eq("gameId", input.game._id)
        .eq("candidateKey", input.candidateKey)
        .eq("status", "pending"),
    )
    .unique();
  if (existing) {
    await ctx.scheduler.runAfter(
      0,
      internal.syncApiSportsLive.continueScoringHoldCleanup,
      { cleanupId: existing._id },
    );
    return {
      cleanupId: existing._id,
      status: "pending",
      resolvedHolds: existing.resolvedHolds,
    };
  }
  const [evaluationRows, holds] = await Promise.all([
    Promise.all(
      (["building", "complete", "incomplete"] as const).map((status) =>
        ctx.db
          .query("scoringHoldEvaluations")
          .withIndex(
            "by_gameId_and_candidateKey_and_status",
            (q) =>
              q
                .eq("gameId", input.game._id)
                .eq("candidateKey", input.candidateKey)
                .eq("status", status),
          )
          .unique(),
      ),
    ),
    ctx.db
      .query("scoringHolds")
      .withIndex("by_gameId_and_candidateKey_and_status", (q) =>
        q
          .eq("gameId", input.game._id)
          .eq("candidateKey", input.candidateKey)
          .eq("status", "open"),
      )
      .take(201),
  ]);
  const evaluations = evaluationRows.filter(
    (row): row is Doc<"scoringHoldEvaluations"> => row !== null,
  );
  if (evaluations.length > 1) {
    throw new Error(
      "Scoring Hold evaluation invariant violated during cleanup",
    );
  }
  if (
    evaluations.length <= 200 &&
    holds.length <= 200 &&
    evaluations.length + holds.length <= 200
  ) {
    let abandonedEvaluations = 0;
    for (const evaluation of evaluations) {
      if (
        !["building", "complete", "incomplete"].includes(
          evaluation.status,
        )
      ) {
        continue;
      }
      await ctx.db.patch(evaluation._id, {
        status: "abandoned",
        abandonedAtMs: input.startedAtMs,
      });
      abandonedEvaluations += 1;
    }
    let resolvedHolds = 0;
    for (const hold of holds) {
      if (hold.status !== "open") continue;
      await ctx.db.patch(hold._id, {
        status: "resolved",
        resolvedAtMs: input.startedAtMs,
        resolution: input.reason,
        resolvedByTokenIdentifier: "system:result-reconciliation",
        resolvedByClerkUserId: "system",
      });
      await ctx.db.insert("operatorAuditEvents", {
        action:
          input.reason === "withdrawn_candidate"
            ? "scoring_hold_withdrawn"
            : "scoring_hold_superseded",
        actorTokenIdentifier: "system:result-reconciliation",
        actorClerkUserId: "system",
        atMs: input.startedAtMs,
        detailsJson: JSON.stringify({
          holdId: hold._id,
          poolId: hold.poolId,
          gameId: input.game._id,
          candidateKey: hold.candidateKey,
        }),
      });
      resolvedHolds += 1;
    }
    const cleanupId = await ctx.db.insert("scoringHoldCleanups", {
      seasonId: input.game.seasonId,
      gameId: input.game._id,
      gameWeek: input.game.week,
      candidateKey: input.candidateKey,
      reason: input.reason,
      status: "complete",
      phase: "holds",
      abandonedEvaluations,
      resolvedHolds,
      startedAtMs: input.startedAtMs,
      completedAtMs: input.startedAtMs,
    });
    if (input.reason === "withdrawn_candidate") {
      await scheduleVerifiedScoringReplay(ctx, {
        gameId: input.game._id,
        nowMs: input.startedAtMs,
      });
    }
    return { cleanupId, status: "complete", resolvedHolds };
  }
  let abandonedEvaluations = 0;
  for (const evaluation of evaluations) {
    await ctx.db.patch(evaluation._id, {
      status: "abandoned",
      abandonedAtMs: input.startedAtMs,
    });
    abandonedEvaluations += 1;
  }
  const cleanupId = await ctx.db.insert("scoringHoldCleanups", {
    seasonId: input.game.seasonId,
    gameId: input.game._id,
    gameWeek: input.game.week,
    candidateKey: input.candidateKey,
    reason: input.reason,
    status: "pending",
    phase: "holds",
    abandonedEvaluations,
    resolvedHolds: 0,
    startedAtMs: input.startedAtMs,
  });
  await ctx.scheduler.runAfter(
    0,
    internal.syncApiSportsLive.continueScoringHoldCleanup,
    { cleanupId },
  );
  return { cleanupId, status: "pending", resolvedHolds: 0 };
}

/**
 * Retire correction work that was based on provider evidence before a
 * Production Operator pinned a different authoritative result.
 */
export async function retireCorrectionWorkflowForPinnedOverride(
  ctx: MutationCtx,
  input: {
    game: Doc<"nflGames">;
    nowMs: number;
  },
): Promise<{
  candidateKey: string;
  cleanupId: Id<"scoringHoldCleanups">;
  cleanupStatus: "pending" | "complete";
} | null> {
  const candidate = input.game.correctionCandidate;
  const candidateKey = candidate
    ? scoringHoldCandidateKey({
        gameId: input.game._id,
        ...candidate,
      })
    : null;
  const activeAcceptanceStatuses = [
    "validating_evaluations",
    "validating_holds",
    "applying_evaluations",
    "resolving_holds",
  ] as const;
  const activeAcceptances = (
    await Promise.all(
      activeAcceptanceStatuses.map((status) =>
        ctx.db
          .query("scoringHoldAcceptances")
          .withIndex("by_gameId_and_status", (q) =>
            q.eq("gameId", input.game._id).eq("status", status),
          )
          .unique(),
      ),
    )
  ).filter(
    (row): row is Doc<"scoringHoldAcceptances"> => row !== null,
  );
  if (activeAcceptances.length > 1) {
    throw new Error(
      "Scoring Hold acceptance invariant violated while pinning an override",
    );
  }
  const workflowCandidateKey =
    candidateKey ?? activeAcceptances[0]?.candidateKey ?? null;
  if (!workflowCandidateKey) return null;
  if (
    candidateKey &&
    activeAcceptances[0] &&
    activeAcceptances[0].candidateKey !== candidateKey
  ) {
    throw new Error(
      "Scoring Hold acceptance does not match the current correction candidate",
    );
  }
  for (const status of activeAcceptanceStatuses) {
    const acceptance = activeAcceptances.find(
      (row) => row.status === status,
    );
    if (acceptance) {
      await ctx.db.patch(acceptance._id, {
        status: "abandoned",
        abandonedAtMs: input.nowMs,
      });
    }
  }
  const cleanup = await startScoringHoldCleanup(ctx, {
    game: input.game,
    candidateKey: workflowCandidateKey,
    reason: "superseded_candidate",
    startedAtMs: input.nowMs,
  });
  return {
    candidateKey: workflowCandidateKey,
    cleanupId: cleanup.cleanupId,
    cleanupStatus: cleanup.status,
  };
}

async function activeEvaluationForGame(
  ctx: MutationCtx,
  gameId: Id<"nflGames">,
): Promise<Doc<"scoringHoldEvaluations"> | null> {
  const rows = (
    await Promise.all(
      (["building", "complete", "incomplete"] as const).map((status) =>
        ctx.db
          .query("scoringHoldEvaluations")
          .withIndex("by_gameId_and_status", (q) =>
            q.eq("gameId", gameId).eq("status", status),
          )
          .unique(),
      ),
    )
  ).filter(
    (row): row is Doc<"scoringHoldEvaluations"> => row !== null,
  );
  if (rows.length > 1) {
    throw new Error(
      "Scoring Hold evaluation invariant violated: multiple active evaluations for one NFL Game",
    );
  }
  return rows[0] ?? null;
}

async function applyCorrectionCandidate(
  ctx: MutationCtx,
  input: {
    game: Doc<"nflGames">;
    candidate: NonNullable<Doc<"nflGames">["correctionCandidate"]>;
    appliedAtMs: number;
  },
): Promise<void> {
  const verified = input.game.verifiedResult!;
  await ctx.db.insert("nflGameResultHistory", {
    nflGameId: input.game._id,
    homeScore: verified.homeScore,
    awayScore: verified.awayScore,
    status: verified.status,
    verifiedAtMs: verified.verifiedAtMs,
    supersededAtMs: input.appliedAtMs,
  });
  await ctx.db.insert("nflGameResultReconciliationObservations", {
    nflGameId: input.game._id,
    observedAtMs: input.candidate.observedAtMs,
    homeScore: input.candidate.homeScore,
    awayScore: input.candidate.awayScore,
    status: input.candidate.status,
    matchesVerified: false,
    disposition: "corrected",
  });
  await ctx.db.patch(input.game._id, {
    lifecycle:
      input.candidate.status === "CANC" ? "canceled" : "terminal",
    homeScore: input.candidate.homeScore,
    awayScore: input.candidate.awayScore,
    verifiedResult: {
      homeScore: input.candidate.homeScore,
      awayScore: input.candidate.awayScore,
      status: input.candidate.status,
      verifiedAtMs: input.candidate.observedAtMs,
    },
    priorVerifiedResult: {
      ...verified,
      supersededAtMs: input.appliedAtMs,
    },
    correctionCandidate: undefined,
    lastObservedAtMs: input.candidate.observedAtMs,
    revision: (input.game.revision ?? 0) + 1,
  });
  await recordProviderGameTransition(ctx, {
    gameId: input.game._id,
    provider: "api-sports",
    source: "correction",
    observedAtMs: input.candidate.observedAtMs,
    before: providerEvidenceState(input.game),
    after: providerEvidenceState({
      ...input.game,
      lifecycle:
        input.candidate.status === "CANC"
          ? "canceled"
          : "terminal",
      homeScore: input.candidate.homeScore,
      awayScore: input.candidate.awayScore,
      verifiedResult: {
        homeScore: input.candidate.homeScore,
        awayScore: input.candidate.awayScore,
        status: input.candidate.status,
        verifiedAtMs: input.candidate.observedAtMs,
      },
      priorVerifiedResult: {
        ...verified,
        supersededAtMs: input.appliedAtMs,
      },
      correctionCandidate: undefined,
    }),
  });
  if (input.candidate.status === "CANC") {
    await ctx.scheduler.runAfter(
      0,
      internal.survivorScoring.handleVerifiedCancellation,
      { gameId: input.game._id, nowMs: input.appliedAtMs },
    );
  } else {
    await ctx.scheduler.runAfter(
      0,
      internal.survivorScoring.scoreSurvivorPoolsForVerifiedGame,
      { gameId: input.game._id, nowMs: input.appliedAtMs },
    );
  }
  await ctx.scheduler.runAfter(
    0,
    internal.confidenceScoring.scoreConfidencePoolsForVerifiedGame,
    {
      gameId: input.game._id,
      nowMs: input.appliedAtMs,
      replayLaterWeeks: true,
    },
  );
  await ctx.scheduler.runAfter(
    SCORING_DELAY_THRESHOLD_MS + 1_000,
    internal.incidents.checkScoringDelayForGame,
    {
      gameId: input.game._id,
      verifiedAtMs: input.candidate.observedAtMs,
    },
  );
}

export const continueScoringHoldEvaluation = internalMutation({
  args: {
    evaluationId: v.id("scoringHoldEvaluations"),
    candidateKey: v.string(),
  },
  handler: async (ctx, args) => {
    const evaluation = await ctx.db.get(args.evaluationId);
    if (
      !evaluation ||
      evaluation.status !== "building" ||
      evaluation.candidateKey !== args.candidateKey
    ) {
      return { status: "abandoned" as const };
    }
    const game = await ctx.db.get(evaluation.gameId);
    const candidate = game?.correctionCandidate;
    if (
      !game ||
      !candidate ||
      scoringHoldCandidateKey({ gameId: game._id, ...candidate }) !==
        args.candidateKey
    ) {
      await ctx.db.patch(evaluation._id, {
        status: "abandoned",
        abandonedAtMs: Date.now(),
      });
      return { status: "abandoned" as const };
    }
    const page = await ctx.db
      .query("pools")
      .withIndex("by_seasonId", (q) =>
        q.eq("seasonId", evaluation.seasonId),
      )
      .paginate({
        numItems: 200,
        cursor: evaluation.cursor ?? null,
      });
    const context = await loadPoolDependencyContext(
      ctx,
      game,
      candidate.observedAtMs,
    );
    const dependencies = await findPagePoolDependencies(ctx, {
      pools: page.page,
      game,
      context,
    });
    const created = await createScoringHolds(ctx, {
      game,
      candidate,
      evaluationId: evaluation._id,
      dependencies,
    });
    const processedPools = evaluation.processedPools + page.page.length;
    const holdCount = evaluation.holdCount + created;
    if (!page.isDone) {
      await ctx.db.patch(evaluation._id, {
        cursor: page.continueCursor,
        processedPools,
        holdCount,
      });
      await ctx.scheduler.runAfter(
        0,
        internal.syncApiSportsLive.continueScoringHoldEvaluation,
        {
          evaluationId: evaluation._id,
          candidateKey: evaluation.candidateKey,
        },
      );
      return { status: "building" as const, processedPools, holdCount };
    }
    const dependencyEventId = await latestScoringDependencyEventId(
      ctx,
      evaluation.seasonId,
    );
    if (dependencyEventId !== evaluation.dependencyEventId) {
      await ctx.db.patch(evaluation._id, {
        cursor: undefined,
        processedPools: 0,
        holdCount,
        dependencyEventId,
      });
      await ctx.scheduler.runAfter(
        0,
        internal.syncApiSportsLive.continueScoringHoldEvaluation,
        {
          evaluationId: evaluation._id,
          candidateKey: evaluation.candidateKey,
        },
      );
      return {
        status: "building" as const,
        processedPools: 0,
        holdCount,
      };
    }
    if (!context.scopeComplete) {
      await ctx.db.patch(evaluation._id, {
        status: "incomplete",
        cursor: undefined,
        processedPools,
        holdCount,
        completedAtMs: candidate.observedAtMs,
      });
      return { status: "incomplete" as const, processedPools, holdCount };
    }
    if (holdCount > 0) {
      await ctx.db.patch(evaluation._id, {
        status: "complete",
        cursor: undefined,
        processedPools,
        holdCount,
        completedAtMs: candidate.observedAtMs,
      });
      return { status: "complete" as const, processedPools, holdCount };
    }
    await ctx.db.patch(evaluation._id, {
      status: "applied",
      cursor: undefined,
      processedPools,
      holdCount,
      completedAtMs: candidate.observedAtMs,
    });
    await applyCorrectionCandidate(ctx, {
      game,
      candidate,
      appliedAtMs: candidate.observedAtMs,
    });
    return { status: "applied" as const, processedPools, holdCount };
  },
});

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

export const getApiSportsRequestTarget = internalQuery({
  args: { gameId: v.id("nflGames") },
  handler: async (ctx, args) => {
    const game = await ctx.db.get(args.gameId);
    if (!game) return null;
    const aliases = await ctx.db
      .query("nflGameAliases")
      .withIndex("by_nflGameId_and_provider_and_isCurrent", (q) =>
        q
          .eq("nflGameId", args.gameId)
          .eq("provider", "api-sports")
          .eq("isCurrent", true),
      )
      .take(2);
    return aliases.length === 1
      ? {
          externalId: aliases[0]!.externalId,
          seasonId: game.seasonId,
        }
      : null;
  },
});

export const isPinnedResultOverrideCurrent = internalQuery({
  args: {
    gameId: v.id("nflGames"),
    overrideId: v.id("nflGameResultOverrides"),
  },
  handler: async (ctx, args) => {
    const game = await ctx.db.get(args.gameId);
    return game?.pinnedResultOverrideId === args.overrideId;
  },
});

export const continueScoringHoldCleanup = internalMutation({
  args: {
    cleanupId: v.id("scoringHoldCleanups"),
  },
  handler: async (ctx, args) =>
    await processScoringHoldCleanup(ctx, args.cleanupId),
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
    productionFence: v.optional(productionQualificationFenceValidator),
  },
  handler: async (ctx, args) => {
    await requireCurrentProductionQualificationFence(
      ctx,
      args.productionFence as ProductionQualificationFence | undefined,
    );
    const observation: LiveObservation = args.observation;
    const ownership = await resolveNflGameAlias(ctx, {
      provider: "api-sports",
      externalId: observation.externalId,
    });
    if (ownership.kind !== "owned") {
      if (args.expectedGameId !== undefined) {
        await ctx.runMutation(
          internal.providerEvidence.recordApiSportsDiagnostic,
          {
            surface: "live",
            scopeKey: `game:${args.expectedGameId}`,
            gameId: args.expectedGameId,
            endpoint: "/games",
            parameters: { id: observation.externalId },
            outcome: "quarantined",
          },
        );
        return {
          status: "unresolved" as const,
          gameId: null,
          incidentId: null,
        };
      }
      const externalCorrelation = /^\d{1,20}$/.test(
        observation.externalId,
      )
        ? observation.externalId
        : "unresolved";
      const incidentId = await openLiveIncident(ctx, {
        scopeKey: `game-alias:${externalCorrelation}`,
        summary:
          "A live NFL Game could not be matched; the last trusted state was preserved.",
        nowMs: observation.observedAtMs,
      });
      await ctx.runMutation(
        internal.providerEvidence.recordApiSportsDiagnostic,
        {
          surface: "live",
          scopeKey: `game-alias:${externalCorrelation}`,
          incidentId: incidentId ?? undefined,
          endpoint: "/games",
          parameters: { id: observation.externalId },
          outcome: "quarantined",
        },
      );
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
    await requireCurrentProductionQualificationFence(
      ctx,
      args.productionFence as ProductionQualificationFence | undefined,
      game.seasonId,
    );
    if (
      isBeforeLiveWindowStart({
        lifecycle: observation.lifecycle,
        scheduledKickoffMs: game.scheduledKickoffMs,
        observedAtMs: observation.observedAtMs,
      })
    ) {
      const incidentId = await openLiveIncident(ctx, {
        scopeKey: `game:${gameId}:outside-live-window`,
        summary:
          "API-Sports reported started or completed play before the NFL Game live window; the last trusted state was preserved.",
        nowMs: observation.observedAtMs,
      });
      await recordGamePollDiagnostic(ctx, {
        game,
        externalId: observation.externalId,
        surface: "live",
        outcome: "quarantined",
        providerStatus: observation.providerStatus,
        incidentId,
      });
      return {
        status: "outside_live_window" as const,
        gameId,
        incidentId,
      };
    }
    await ctx.runMutation(internal.incidents.autoResolveIncident, {
      type: "provider_exception",
      surface: "live",
      scopeKey: `game:${gameId}:outside-live-window`,
      nowMs: observation.observedAtMs,
    });
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

    if (game.pinnedResultOverrideId !== undefined) {
      if (decision === "stale") {
        await recordGamePollDiagnostic(ctx, {
          game,
          externalId: observation.externalId,
          surface: "live",
          outcome: "no_change",
        });
        return { status: "stale" as const, gameId, incidentId: null };
      }
      if (decision === "duplicate") {
        const terminal = immediateVerifiedResult(observation);
        const needsFirstEpisodeEvidence =
          terminal.accepted &&
          !(await hasPinnedResultEvidence(
            ctx,
            game.pinnedResultOverrideId,
          ));
        if (needsFirstEpisodeEvidence && terminal.accepted) {
          const disposition = await recordPinnedProviderEvidence(ctx, {
            game,
            source: "api_sports_live",
            result: terminal.result,
          });
          if (disposition === "stale") {
            return { status: "stale" as const, gameId, incidentId: null };
          }
        }
        if (
          state &&
          observation.observedAtMs >
            (state.lastAppliedObservedAtMs ?? 0)
        ) {
          await ctx.db.patch(state._id, {
            lastAppliedObservedAtMs: observation.observedAtMs,
          });
        }
        if (!needsFirstEpisodeEvidence) {
          await recordGamePollDiagnostic(ctx, {
            game,
            externalId: observation.externalId,
            surface: "live",
            outcome: "no_change",
          });
        }
        return {
          status: needsFirstEpisodeEvidence
            ? ("pinned" as const)
            : ("duplicate" as const),
          gameId,
          incidentId: null,
        };
      }
      const terminal = immediateVerifiedResult(observation);
      if (terminal.accepted) {
        const disposition = await recordPinnedProviderEvidence(ctx, {
          game,
          source: "api_sports_live",
          result: terminal.result,
        });
        if (disposition === "stale") {
          return { status: "stale" as const, gameId, incidentId: null };
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
      return { status: "pinned" as const, gameId, incidentId: null };
    }

    if (decision === "stale") {
      await recordGamePollDiagnostic(ctx, {
        game,
        externalId: observation.externalId,
        surface: "live",
        outcome: "no_change",
      });
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
      await recordGamePollDiagnostic(ctx, {
        game,
        externalId: observation.externalId,
        surface: "live",
        outcome: "no_change",
      });
      return { status: "duplicate" as const, gameId, incidentId: null };
    }

    if (decision === "evidence_only") {
      await recordGamePollDiagnostic(ctx, {
        game,
        externalId: observation.externalId,
        surface: "live",
        outcome: "quarantined",
        providerStatus: observation.providerStatus,
      });
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
          scopeKey: `game:${gameId}:terminal`,
          summary:
            "API-Sports terminal evidence was incoherent; the last trusted NFL Game state was preserved.",
          nowMs: observation.observedAtMs,
        });
        await recordGamePollDiagnostic(ctx, {
          game,
          externalId: observation.externalId,
          surface: "live",
          outcome: "quarantined",
          providerStatus: observation.providerStatus,
          incidentId: incidentId ?? undefined,
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
        lastObservedAtMs: observation.observedAtMs,
        kickoffLockReachedAtMs:
          game.kickoffLockReachedAtMs ?? observation.observedAtMs,
        revision: (game.revision ?? 0) + 1,
      });
      await recordProviderGameTransition(ctx, {
        gameId,
        provider: "api-sports",
        externalId: observation.externalId,
        source: "live",
        observedAtMs: observation.observedAtMs,
        before: providerEvidenceState(game),
        after: providerEvidenceState({
          ...game,
          lifecycle:
            terminal.result.status === "CANC"
              ? "canceled"
              : "terminal",
          homeScore: terminal.result.homeScore,
          awayScore: terminal.result.awayScore,
          resultAuthority: "verified",
          verifiedResult: terminal.result,
          kickoffLockReachedAtMs:
            game.kickoffLockReachedAtMs ??
            observation.observedAtMs,
        }),
      });
      if (game.kickoffLockReachedAtMs == null) {
        await recordScoringDependencyEvent(
          ctx,
          game.seasonId,
          game.week,
        );
      }
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
    await recordProviderGameTransition(ctx, {
      gameId,
      provider: "api-sports",
      externalId: observation.externalId,
      source: "live",
      observedAtMs: observation.observedAtMs,
      before: providerEvidenceState(game),
      after: providerEvidenceState({
        ...game,
        lifecycle: observation.lifecycle,
        homeScore: observation.homeScore,
        awayScore: observation.awayScore,
        resultAuthority: "projected",
        kickoffLockReachedAtMs:
          game.kickoffLockReachedAtMs ??
          (observation.lifecycle === "in_progress" ||
          observation.lifecycle === "interrupted"
            ? observation.observedAtMs
            : undefined),
      }),
    });
    if (
      game.kickoffLockReachedAtMs == null &&
      (observation.lifecycle === "in_progress" ||
        observation.lifecycle === "interrupted")
    ) {
      await recordScoringDependencyEvent(
        ctx,
        game.seasonId,
        game.week,
      );
    }
    return { status: "applied" as const, gameId, incidentId: null };
  },
});

export const applyReconciliationObservation = internalMutation({
  args: {
    gameId: v.id("nflGames"),
    expectedPinnedOverrideId: v.optional(
      v.id("nflGameResultOverrides"),
    ),
    observation: liveObservationValidator,
    productionFence: v.optional(productionQualificationFenceValidator),
  },
  handler: async (ctx, args) => {
    await requireCurrentProductionQualificationFence(
      ctx,
      args.productionFence as ProductionQualificationFence | undefined,
    );
    const game = await ctx.db.get(args.gameId);
    if (game) {
      await requireCurrentProductionQualificationFence(
        ctx,
        args.productionFence as ProductionQualificationFence | undefined,
        game.seasonId,
      );
    }
    if (
      args.expectedPinnedOverrideId !== undefined &&
      game?.pinnedResultOverrideId !== args.expectedPinnedOverrideId
    ) {
      return { result: "pin_episode_ended" as const };
    }
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
    if (game.pinnedResultOverrideId !== undefined) {
      const disposition = await recordPinnedProviderEvidence(ctx, {
        game,
        source: "api_sports_targeted",
        result: terminal.result,
      });
      return { result: disposition };
    }
    if (
      game.lastObservedAtMs !== undefined &&
      args.observation.observedAtMs < game.lastObservedAtMs
    ) {
      await recordGamePollDiagnostic(ctx, {
        game,
        externalId: args.observation.externalId,
        surface: "correction",
        outcome: "no_change",
      });
      return { result: "stale" as const };
    }

    if (evidence.matchesVerified) {
      if (game.correctionCandidate) {
        await startScoringHoldCleanup(ctx, {
          game,
          candidateKey: scoringHoldCandidateKey({
            gameId: game._id,
            ...game.correctionCandidate,
          }),
          reason: "withdrawn_candidate",
          startedAtMs: args.observation.observedAtMs,
        });
      }
      if (game.correctionCandidate) {
        await ctx.db.insert(
          "nflGameResultReconciliationObservations",
          {
            nflGameId: game._id,
            ...evidence,
            disposition: "unchanged",
          },
        );
        await ctx.db.patch(game._id, {
          correctionCandidate: undefined,
          lastObservedAtMs: args.observation.observedAtMs,
          revision: (game.revision ?? 0) + 1,
        });
        await recordProviderGameTransition(ctx, {
          gameId: game._id,
          provider: "api-sports",
          externalId: args.observation.externalId,
          source: "correction",
          observedAtMs: args.observation.observedAtMs,
          before: providerEvidenceState(game),
          after: providerEvidenceState({
            ...game,
            correctionCandidate: undefined,
          }),
        });
      } else {
        await ctx.db.patch(game._id, {
          lastObservedAtMs: args.observation.observedAtMs,
        });
        await recordGamePollDiagnostic(ctx, {
          game,
          externalId: args.observation.externalId,
          surface: "correction",
          outcome: "no_change",
        });
      }
      return { result: "unchanged" as const };
    }

    const candidate = {
      homeScore: terminal.result.homeScore,
      awayScore: terminal.result.awayScore,
      observedAtMs: args.observation.observedAtMs,
      status: terminal.result.status,
    };
    const candidateKey = scoringHoldCandidateKey({
      gameId: game._id,
      ...candidate,
    });
    const sameCurrentCandidate =
      game.correctionCandidate !== undefined &&
      scoringHoldCandidateKey({
        gameId: game._id,
        ...game.correctionCandidate,
      }) === candidateKey;
    if (sameCurrentCandidate) {
      const activeEvaluation = await activeEvaluationForGame(
        ctx,
        game._id,
      );
      if (activeEvaluation) {
        if (activeEvaluation.candidateKey !== candidateKey) {
          throw new Error(
            "Scoring Hold evaluation invariant violated: active evaluation does not match the current candidate",
          );
        }
        if (
          candidate.observedAtMs >
          activeEvaluation.candidateObservedAtMs
        ) {
          const dependencyEventId =
            await latestScoringDependencyEventId(ctx, game.seasonId);
          await ctx.db.patch(activeEvaluation._id, {
            candidateObservedAtMs: candidate.observedAtMs,
            status: "building",
            cursor: undefined,
            processedPools: 0,
            dependencyEventId,
            completedAtMs: undefined,
          });
          await ctx.scheduler.runAfter(
            0,
            internal.syncApiSportsLive.continueScoringHoldEvaluation,
            {
              evaluationId: activeEvaluation._id,
              candidateKey,
            },
          );
        }
        await recordGamePollDiagnostic(ctx, {
          game,
          externalId: args.observation.externalId,
          surface: "correction",
          outcome: "no_change",
        });
        await ctx.db.patch(game._id, {
          correctionCandidate: candidate,
          lastObservedAtMs: candidate.observedAtMs,
          revision: (game.revision ?? 0) + 1,
        });
        return { result: "candidate" as const };
      }
    }
    if (
      game.correctionCandidate &&
      scoringHoldCandidateKey({
        gameId: game._id,
        ...game.correctionCandidate,
      }) !== candidateKey
    ) {
      await startScoringHoldCleanup(ctx, {
        game,
        candidateKey: scoringHoldCandidateKey({
          gameId: game._id,
          ...game.correctionCandidate,
        }),
        reason: "superseded_candidate",
        startedAtMs: candidate.observedAtMs,
      });
    }
    const firstPage = await ctx.db
      .query("pools")
      .withIndex("by_seasonId", (q) => q.eq("seasonId", game.seasonId))
      .paginate({ numItems: 200, cursor: null });
    const dependencyEventId = await latestScoringDependencyEventId(
      ctx,
      game.seasonId,
    );
    const dependencyContext = await loadPoolDependencyContext(
      ctx,
      game,
      args.observation.observedAtMs,
    );
    const dependencies = await findPagePoolDependencies(ctx, {
      pools: firstPage.page,
      game,
      context: dependencyContext,
    });
    if (
      !firstPage.isDone ||
      !dependencyContext.scopeComplete ||
      dependencies.length > 0
    ) {
      const conflictingEvaluation = await activeEvaluationForGame(
        ctx,
        game._id,
      );
      if (conflictingEvaluation) {
        throw new Error(
          "Scoring Hold evaluation invariant violated: cannot start a second active evaluation for one NFL Game",
        );
      }
      const evaluationStatus = !firstPage.isDone
        ? ("building" as const)
        : !dependencyContext.scopeComplete
          ? ("incomplete" as const)
          : ("complete" as const);
      const evaluationId = await ctx.db.insert(
        "scoringHoldEvaluations",
        {
          seasonId: game.seasonId,
          gameId: game._id,
          gameWeek: game.week,
          candidateKey,
          candidateHomeScore: candidate.homeScore,
          candidateAwayScore: candidate.awayScore,
          candidateObservedAtMs: candidate.observedAtMs,
          candidateStatus: candidate.status,
          status: evaluationStatus,
          cursor: firstPage.isDone
            ? undefined
            : firstPage.continueCursor,
          processedPools: firstPage.page.length,
          holdCount: 0,
          dependencyEventId,
          startedAtMs: candidate.observedAtMs,
          completedAtMs: evaluationStatus !== "building"
            ? candidate.observedAtMs
            : undefined,
        },
      );
      const created = await createScoringHolds(ctx, {
        game,
        candidate,
        evaluationId,
        dependencies,
      });
      await ctx.db.patch(evaluationId, { holdCount: created });
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
      await recordProviderGameTransition(ctx, {
        gameId: game._id,
        provider: "api-sports",
        externalId: args.observation.externalId,
        source: "correction",
        observedAtMs: args.observation.observedAtMs,
        before: providerEvidenceState(game),
        after: providerEvidenceState({
          ...game,
          correctionCandidate: candidate,
        }),
      });
      if (evaluationStatus === "building") {
        await ctx.scheduler.runAfter(
          0,
          internal.syncApiSportsLive.continueScoringHoldEvaluation,
          { evaluationId, candidateKey },
        );
      }
      return { result: "candidate" as const };
    }
    await applyCorrectionCandidate(ctx, {
      game,
      candidate,
      appliedAtMs: args.observation.observedAtMs,
    });
    return { result: "corrected" as const };
  },
});

export const reconcileSuccessfulSlate = internalMutation({
  args: {
    nowMs: v.number(),
    seenGameIds: v.array(v.id("nflGames")),
    productionFence: v.optional(productionQualificationFenceValidator),
  },
  handler: async (ctx, args) => {
    const productionFence = args.productionFence as
      | ProductionQualificationFence
      | undefined;
    await requireCurrentProductionQualificationFence(
      ctx,
      productionFence,
      productionFence?.seasonId,
    );
    const seen = new Set(args.seenGameIds);
    const seasons = productionFence
      ? [await ctx.db.get(productionFence.seasonId)].filter(
          (season): season is Doc<"poolSeasons"> =>
            season?.status === "available",
        )
      : await ctx.db
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
              priority: "recovery",
            });
          }
        } else {
          await ctx.db.insert("syncWorkItems", {
            surface: "live",
            scopeKey,
            priority: "recovery",
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
        {
          observation,
          productionFence: args.productionFence,
        },
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
      {
        nowMs: args.nowMs,
        seenGameIds,
        productionFence: args.productionFence,
      },
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
    productionFence: v.optional(productionQualificationFenceValidator),
  },
  handler: (ctx, args) => applySuccessfulSlateBatchForCtx(ctx, args),
});

function liveInput(
  game: SportsDataGameObservation,
): LiveObservation | null {
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

function configuredProvider(
  requestFence?: ApiSportsRequestFence,
): SportsDataProvider {
  return selectSportsDataProvider({
    config: {
      provider: env.SPORTS_DATA_PROVIDER,
      apiSportsKey: env.API_SPORTS_KEY,
    },
    providers: {
      "api-sports": createApiSportsProviderFactory({ requestFence }),
    },
  });
}

/** Selected-provider action for the single global league-wide live request. */
export const runClaimedLiveFetch = internalAction({
  args: { workItemId: v.id("syncWorkItems") },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: boolean; applied?: number; reason?: string }> => {
    const nowMs = Date.now();
    const attempt = await ctx.runQuery(
      internal.providerReliability.getWorkAttemptCount,
      { workItemId: args.workItemId },
    );
    const reliable = createReliableApiSportsFetch({
      ctx,
      surface: "live",
      traffic: "protected",
      jitterKey: String(args.workItemId),
      scopeKey: "live:nfl",
    });
    let providerSucceeded = false;
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
        configuredProvider(reliable.fence).listLiveGamesWithFailures(),
      );
      providerSucceeded = true;
      await reliable.recordOutcome({
        success: true,
        attempt,
        nowMs: Date.now(),
      });
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
        productionFence: reliable.productionFence() ?? undefined,
      });
      const completedAtMs = Date.now();
      await ctx.runMutation(internal.syncLive.recordSyncSurfaceHealth, {
        surface: "league_live",
        scopeKey: "live:nfl",
        success: true,
        nowMs: completedAtMs,
        expectedNextRefreshAtMs: completedAtMs + 60_000,
      });
      await ctx.runMutation(internal.syncLive.completeSyncWork, {
        workItemId: args.workItemId,
      });
      return {
        ok: true,
        applied: batch.results.filter((item) => item.status === "applied")
          .length,
      };
    } catch (error) {
      const outcome = providerSucceeded
        ? {
            retryAtMs: nowMs + 60_000,
            deferredReason: undefined,
          }
        : await reliable.recordOutcome({
            success: false,
            attempt,
            nowMs,
            error,
            failureReason: "live_fetch_failed",
          });
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
        dueAtMs: outcome.retryAtMs,
        deferredReason: outcome.deferredReason,
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
    productionFence?: ProductionQualificationFence;
    reason: string;
    retryAtMs?: number;
    deferredReason?: string;
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
    dueAtMs:
      input.retryAtMs ??
      input.nowMs + LIVE_REFRESH_CADENCE_MS,
    deferredReason: input.deferredReason,
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
    productionFence?: ProductionQualificationFence;
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
      productionFence: input.productionFence,
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
    productionFence: v.optional(productionQualificationFenceValidator),
  },
  handler: (ctx, args) => applyTargetedLookupForCtx(ctx, args),
});

async function failReconciliationForCtx(
  ctx: ActionCtx,
  input: {
    workItemId: Id<"syncWorkItems">;
    gameId: Id<"nflGames">;
    expectedPinnedOverrideId?: Id<"nflGameResultOverrides">;
    nowMs: number;
    productionFence?: ProductionQualificationFence;
    reason: string;
    retryAtMs?: number;
    deferredReason?: string;
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
    dueAtMs:
      input.retryAtMs ??
      input.nowMs + LIVE_REFRESH_CADENCE_MS,
    gameId: input.gameId,
    expectedPinnedOverrideId: input.expectedPinnedOverrideId,
    deferredReason: input.deferredReason,
  });
  return { ok: false, reason: input.reason };
}

async function applyReconciliationLookupForCtx(
  ctx: ActionCtx,
  input: {
    workItemId: Id<"syncWorkItems">;
    gameId: Id<"nflGames">;
    expectedPinnedOverrideId?: Id<"nflGameResultOverrides">;
    requestedExternalId: string;
    observation: LiveObservation | null;
    nowMs: number;
    productionFence?: ProductionQualificationFence;
  },
): Promise<{
  ok: boolean;
  result?:
    | "unchanged"
    | "candidate"
    | "corrected"
    | "not_verified"
    | "stale"
    | "pinned_matching"
    | "pinned_conflicting"
    | "pin_episode_ended";
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
      expectedPinnedOverrideId: input.expectedPinnedOverrideId,
      observation: input.observation,
      productionFence: input.productionFence,
    },
  );
  if (applied.result === "rejected") {
    return await failReconciliationForCtx(ctx, {
      ...input,
      reason: "incoherent_terminal",
    });
  }
  if (
    input.expectedPinnedOverrideId !== undefined &&
    applied.result !== "pin_episode_ended"
  ) {
    await ctx.runMutation(internal.syncLive.requeueFailedWork, {
      workItemId: input.workItemId,
      dueAtMs:
        input.nowMs + PINNED_RESULT_EVIDENCE_CADENCE_MS,
      gameId: input.gameId,
      expectedPinnedOverrideId: input.expectedPinnedOverrideId,
    });
    return { ok: true, result: applied.result };
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
    expectedPinnedOverrideId: v.optional(
      v.id("nflGameResultOverrides"),
    ),
    requestedExternalId: v.string(),
    observation: v.union(liveObservationValidator, v.null()),
    nowMs: v.number(),
    productionFence: v.optional(productionQualificationFenceValidator),
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
    const attempt = await ctx.runQuery(
      internal.providerReliability.getWorkAttemptCount,
      { workItemId: args.workItemId },
    );
    let providerSucceeded = false;
    const target: {
      externalId: string;
      seasonId: Id<"poolSeasons">;
    } | null = await ctx.runQuery(
      internal.syncApiSportsLive.getApiSportsRequestTarget,
      { gameId: args.gameId },
    );
    if (!target) {
      return await failTargetedLookupForCtx(ctx, {
        workItemId: args.workItemId,
        gameId: args.gameId,
        nowMs,
        reason: "alias_missing",
      });
    }
    const externalId = target.externalId;
    const reliable = createReliableApiSportsFetch({
      ctx,
      surface: "live",
      traffic: "protected",
      jitterKey: String(args.workItemId),
      scopeKey: `game:${args.gameId}`,
      gameId: args.gameId,
      expectedSeasonId: target.seasonId,
    });
    try {
      const game = await runEffect(
        configuredProvider(reliable.fence).getGame({
          provider: "api-sports",
          id: externalId,
        }),
      );
      providerSucceeded = true;
      await reliable.recordOutcome({
        success: true,
        attempt,
        nowMs: Date.now(),
      });
      const observation = game ? liveInput(game) : null;
      return await applyTargetedLookupForCtx(ctx, {
        workItemId: args.workItemId,
        gameId: args.gameId,
        requestedExternalId: externalId,
        observation,
        nowMs,
        productionFence: reliable.productionFence() ?? undefined,
      });
    } catch (error) {
      const outcome = providerSucceeded
        ? {
            retryAtMs: nowMs + LIVE_REFRESH_CADENCE_MS,
            deferredReason: undefined,
          }
        : await reliable.recordOutcome({
            success: false,
            attempt,
            nowMs,
            error,
            failureReason: "targeted_lookup_failed",
          });
      return await failTargetedLookupForCtx(ctx, {
        workItemId: args.workItemId,
        gameId: args.gameId,
        nowMs,
        reason: "lookup_failed",
        retryAtMs: outcome.retryAtMs,
        deferredReason: outcome.deferredReason,
      });
    }
  },
});

/** Claimed correction work always performs one provider-targeted game lookup. */
export const runClaimedResultReconciliation = internalAction({
  args: {
    workItemId: v.id("syncWorkItems"),
    gameId: v.id("nflGames"),
    expectedPinnedOverrideId: v.optional(
      v.id("nflGameResultOverrides"),
    ),
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
      | "stale"
      | "pinned_matching"
      | "pinned_conflicting"
      | "pin_episode_ended";
    reason?: string;
  }> => {
    const nowMs = Date.now();
    const attempt = await ctx.runQuery(
      internal.providerReliability.getWorkAttemptCount,
      { workItemId: args.workItemId },
    );
    let providerSucceeded = false;
    if (args.expectedPinnedOverrideId !== undefined) {
      const current = await ctx.runQuery(
        internal.syncApiSportsLive.isPinnedResultOverrideCurrent,
        {
          gameId: args.gameId,
          overrideId: args.expectedPinnedOverrideId,
        },
      );
      if (!current) {
        await ctx.runMutation(internal.syncLive.completeSyncWork, {
          workItemId: args.workItemId,
        });
        return {
          ok: true,
          result: "pin_episode_ended" as const,
        };
      }
    }
    const target: {
      externalId: string;
      seasonId: Id<"poolSeasons">;
    } | null = await ctx.runQuery(
      internal.syncApiSportsLive.getApiSportsRequestTarget,
      { gameId: args.gameId },
    );
    if (!target) {
      return await failReconciliationForCtx(ctx, {
        ...args,
        nowMs,
        reason: "alias_missing",
      });
    }
    const externalId = target.externalId;
    const reliable = createReliableApiSportsFetch({
      ctx,
      surface: "correction",
      traffic: "protected",
      jitterKey: String(args.workItemId),
      scopeKey: `game:${args.gameId}`,
      gameId: args.gameId,
      expectedSeasonId: target.seasonId,
    });
    try {
      const game = await runEffect(
        configuredProvider(reliable.fence).getGame({
          provider: "api-sports",
          id: externalId,
        }),
      );
      providerSucceeded = true;
      await reliable.recordOutcome({
        success: true,
        attempt,
        nowMs: Date.now(),
      });
      return await applyReconciliationLookupForCtx(ctx, {
        ...args,
        requestedExternalId: externalId,
        observation: game ? liveInput(game) : null,
        nowMs,
        productionFence: reliable.productionFence() ?? undefined,
      });
    } catch (error) {
      const outcome = providerSucceeded
        ? {
            retryAtMs: nowMs + LIVE_REFRESH_CADENCE_MS,
            deferredReason: undefined,
          }
        : await reliable.recordOutcome({
            success: false,
            attempt,
            nowMs,
            error,
            failureReason: "reconciliation_lookup_failed",
          });
      return await failReconciliationForCtx(ctx, {
        ...args,
        nowMs,
        reason: "lookup_failed",
        retryAtMs: outcome.retryAtMs,
        deferredReason: outcome.deferredReason,
      });
    }
  },
});
