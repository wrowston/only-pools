import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  computeWeeklyCutoffMs,
  isGameKickoffLocked,
} from "./pickLock";

export type ScoringHoldDependency =
  | "later_game_lock"
  | "later_weekly_cutoff"
  | "settled_pool_week"
  | "locked_survivor_pick"
  | "non_provisional_survivor_pick"
  | "locked_confidence_pick"
  | "bounded_scope_exceeded";

type CandidateEvidence = Readonly<{
  gameId: string;
  homeScore: number;
  awayScore: number;
  observedAtMs: number;
  status: "FT" | "AOT" | "CANC";
}>;

export function scoringHoldCandidateKey(candidate: CandidateEvidence): string {
  return [
    candidate.gameId,
    candidate.homeScore,
    candidate.awayScore,
    candidate.status,
  ].join(":");
}

export function scoringHoldDedupeKey(input: {
  poolId: string;
  candidateKey: string;
}): string {
  return `${input.poolId}:${input.candidateKey}`;
}

export function selectScoringHoldDependency(input: {
  laterGameLockReached: boolean;
  laterWeeklyCutoffReached: boolean;
  laterSettledPoolWeek: boolean;
  laterSurvivorLock: boolean;
  laterNonProvisionalSurvivorPick: boolean;
  laterConfidenceLock: boolean;
}): ScoringHoldDependency | null {
  if (input.laterGameLockReached) return "later_game_lock";
  if (input.laterWeeklyCutoffReached) return "later_weekly_cutoff";
  if (input.laterSettledPoolWeek) return "settled_pool_week";
  if (input.laterSurvivorLock) return "locked_survivor_pick";
  if (input.laterNonProvisionalSurvivorPick) {
    return "non_provisional_survivor_pick";
  }
  if (input.laterConfidenceLock) return "locked_confidence_pick";
  return null;
}

export type ScoringGate =
  | {
      kind: "evaluation";
      evaluation: Doc<"scoringHoldEvaluations">;
      dependency?: ScoringHoldDependency;
      candidateKey: string;
      gameWeek: number;
    }
  | {
      kind: "hold";
      hold: Doc<"scoringHolds">;
      candidateKey: string;
      gameWeek: number;
    }
  | {
      kind: "cleanup";
      cleanup: Doc<"scoringHoldCleanups">;
      candidateKey: string;
      gameWeek: number;
    }
  | {
      kind: "acceptance";
      acceptance: Doc<"scoringHoldAcceptances">;
      candidateKey: string;
      gameWeek: number;
    };

export function scoringGateGameId(gate: ScoringGate): Id<"nflGames"> {
  switch (gate.kind) {
    case "hold":
      return gate.hold.gameId;
    case "evaluation":
      return gate.evaluation.gameId;
    case "cleanup":
      return gate.cleanup.gameId;
    case "acceptance":
      return gate.acceptance.gameId;
  }
}

async function dependencyForPool(
  ctx: QueryCtx | MutationCtx,
  input: {
    pool: Doc<"pools">;
    game: Doc<"nflGames">;
    observedAtMs: number;
    seasonGames: Doc<"nflGames">[];
  },
): Promise<ScoringHoldDependency | null> {
  if (input.pool.startWeek > input.game.week) return null;
  if (input.seasonGames.length > 400) return "bounded_scope_exceeded";
  const laterGames = input.seasonGames.filter(
    (candidate) => candidate.week > input.game.week,
  );
  const laterGameLockReached = laterGames.some((candidate) =>
    isGameKickoffLocked(candidate, input.observedAtMs),
  );
  const weeklyAnchors = new Map<number, number>();
  for (const candidate of laterGames) {
    const current = weeklyAnchors.get(candidate.week);
    if (
      current === undefined ||
      candidate.scheduledKickoffMs < current
    ) {
      weeklyAnchors.set(candidate.week, candidate.scheduledKickoffMs);
    }
  }
  const laterSettledPoolWeek = await ctx.db
    .query("poolWeeks")
    .withIndex("by_poolId_and_settled_and_week", (q) =>
      q
        .eq("poolId", input.pool._id)
        .eq("settled", true)
        .gt("week", input.game.week),
    )
    .first();
  const laterSurvivorLock =
    input.pool.type === "survivor"
      ? await ctx.db
          .query("survivorPicks")
          .withIndex("by_poolId_and_locked_and_week", (q) =>
            q
              .eq("poolId", input.pool._id)
              .eq("locked", true)
              .gt("week", input.game.week),
          )
          .first()
      : null;
  const laterNonProvisionalSurvivorPick =
    input.pool.type === "survivor"
      ? await ctx.db
          .query("survivorPicks")
          .withIndex("by_poolId_and_provisional_and_week", (q) =>
            q
              .eq("poolId", input.pool._id)
              .eq("provisional", false)
              .gt("week", input.game.week),
          )
          .first()
      : null;
  const laterConfidenceLock =
    input.pool.type === "confidence"
      ? await ctx.db
          .query("confidencePicks")
          .withIndex("by_poolId_and_locked_and_week", (q) =>
            q
              .eq("poolId", input.pool._id)
              .eq("locked", true)
              .gt("week", input.game.week),
          )
          .first()
      : null;
  return selectScoringHoldDependency({
    laterGameLockReached,
    laterWeeklyCutoffReached:
      input.pool.pickLockMode === "weeklyCutoff" &&
      [...weeklyAnchors.values()].some(
        (anchorMs) =>
          input.observedAtMs >= computeWeeklyCutoffMs(anchorMs),
      ),
    laterSettledPoolWeek: laterSettledPoolWeek !== null,
    laterSurvivorLock: laterSurvivorLock !== null,
    laterNonProvisionalSurvivorPick:
      laterNonProvisionalSurvivorPick !== null,
    laterConfidenceLock: laterConfidenceLock !== null,
  });
}

export async function getScoringGate(
  ctx: QueryCtx | MutationCtx,
  pool: Doc<"pools">,
): Promise<ScoringGate | null> {
  const hold = await ctx.db
    .query("scoringHolds")
    .withIndex("by_poolId_and_status_and_gameWeek", (q) =>
      q
        .eq("poolId", pool._id)
        .eq("status", "open")
        .gte("gameWeek", pool.startWeek),
    )
    .order("desc")
    .first();
  if (hold) {
    return {
      kind: "hold",
      hold,
      candidateKey: hold.candidateKey,
      gameWeek: hold.gameWeek,
    };
  }

  const blockedRows = await ctx.db
    .query("scoringBlockedWork")
    .withIndex("by_poolId_and_kind_and_status", (q) =>
      q
        .eq("poolId", pool._id)
        .eq("kind", pool.type)
        .eq("status", "pending"),
  )
    .take(18);
  for (const blocked of blockedRows) {
    let workflowGameId: Id<"nflGames"> | null = null;
    let workflowCandidateKey: string | null = null;
    if (blocked.holdId) {
      const blockedHold = await ctx.db.get(blocked.holdId);
      if (blockedHold) {
        workflowGameId = blockedHold.gameId;
        workflowCandidateKey = blockedHold.candidateKey;
      }
    }
    if (blocked.cleanupId) {
      const cleanup = await ctx.db.get(blocked.cleanupId);
      if (cleanup?.status === "pending") {
        return {
          kind: "cleanup",
          cleanup,
          candidateKey: cleanup.candidateKey,
          gameWeek: cleanup.gameWeek,
        };
      }
    }
    if (blocked.acceptanceId) {
      const acceptance = await ctx.db.get(blocked.acceptanceId);
      if (
        acceptance &&
        !["complete", "abandoned", "rejected"].includes(
          acceptance.status,
        )
      ) {
        return {
          kind: "acceptance",
          acceptance,
          candidateKey: acceptance.candidateKey,
          gameWeek: acceptance.gameWeek,
        };
      }
    }
    if (blocked.evaluationId) {
      const evaluation = await ctx.db.get(blocked.evaluationId);
      if (evaluation) {
        workflowGameId = evaluation.gameId;
        workflowCandidateKey = evaluation.candidateKey;
        if (
          ["building", "complete", "incomplete"].includes(
            evaluation.status,
          )
        ) {
          return {
            kind: "evaluation",
            evaluation,
            candidateKey: evaluation.candidateKey,
            gameWeek: evaluation.gameWeek,
          };
        }
      }
    }
    if (workflowGameId && workflowCandidateKey) {
      const cleanup = await ctx.db
        .query("scoringHoldCleanups")
        .withIndex("by_gameId_and_candidateKey_and_status", (q) =>
          q
            .eq("gameId", workflowGameId!)
            .eq("candidateKey", workflowCandidateKey!)
            .eq("status", "pending"),
        )
        .unique();
      if (cleanup) {
        return {
          kind: "cleanup",
          cleanup,
          candidateKey: cleanup.candidateKey,
          gameWeek: cleanup.gameWeek,
        };
      }
      const acceptances = (
        await Promise.all(
          (
            [
              "validating_evaluations",
              "validating_holds",
              "applying_evaluations",
              "resolving_holds",
            ] as const
          ).map((status) =>
            ctx.db
              .query("scoringHoldAcceptances")
              .withIndex(
                "by_gameId_and_candidateKey_and_status",
                (q) =>
                  q
                    .eq("gameId", workflowGameId!)
                    .eq("candidateKey", workflowCandidateKey!)
                    .eq("status", status),
              )
              .unique(),
          ),
        )
      ).filter(
        (row): row is Doc<"scoringHoldAcceptances"> => row !== null,
      );
      if (acceptances.length > 1) {
        throw new Error(
          "Scoring Hold acceptance invariant violated: multiple active acceptances for one candidate",
        );
      }
      const acceptance = acceptances[0];
      if (acceptance) {
        return {
          kind: "acceptance",
          acceptance,
          candidateKey: acceptance.candidateKey,
          gameWeek: acceptance.gameWeek,
        };
      }
    }
  }

  const evaluations: Doc<"scoringHoldEvaluations">[] = [];
  for (const status of [
    "building",
    "complete",
    "incomplete",
  ] as const) {
    evaluations.push(
      ...(await ctx.db
        .query("scoringHoldEvaluations")
        .withIndex("by_seasonId_and_status_and_gameWeek", (q) =>
          q
            .eq("seasonId", pool.seasonId)
            .eq("status", status)
            .gte("gameWeek", pool.startWeek),
        )
        .order("desc")
        .take(401)),
    );
  }
  if (evaluations.length > 400) {
    throw new Error(
      "Scoring Hold evaluation invariant violated: active evaluations exceed the bounded NFL Game scope",
    );
  }
  const evaluationGameIds = new Set<Id<"nflGames">>();
  for (const evaluation of evaluations) {
    if (evaluationGameIds.has(evaluation.gameId)) {
      throw new Error(
        "Scoring Hold evaluation invariant violated: multiple active evaluations for one NFL Game",
      );
    }
    evaluationGameIds.add(evaluation.gameId);
  }
  const seasonGames =
    evaluations.length === 0
      ? []
      : await ctx.db
          .query("nflGames")
          .withIndex("by_seasonId", (q) => q.eq("seasonId", pool.seasonId))
          .take(401);
  for (const evaluation of evaluations.sort(
    (left, right) =>
      right.gameWeek - left.gameWeek ||
      right._creationTime - left._creationTime,
  )) {
    const game = await ctx.db.get(evaluation.gameId);
    if (
      !game?.correctionCandidate ||
      scoringHoldCandidateKey({
        gameId: game._id,
        ...game.correctionCandidate,
      }) !== evaluation.candidateKey
    ) {
      continue;
    }
    const dependency = await dependencyForPool(ctx, {
      pool,
      game,
      observedAtMs: evaluation.candidateObservedAtMs,
      seasonGames,
    });
    if (!dependency) continue;
    return {
      kind: "evaluation",
      evaluation,
      dependency,
      candidateKey: evaluation.candidateKey,
      gameWeek: evaluation.gameWeek,
    };
  }
  return null;
}

export async function recordScoringDependencyEvent(
  ctx: MutationCtx,
  seasonId: Id<"poolSeasons">,
  dependencyWeek?: number,
): Promise<Id<"scoringDependencyEvents"> | undefined> {
  let hasApplicableEvaluation = false;
  for (const status of [
    "building",
    "complete",
    "incomplete",
  ] as const) {
    const evaluation = await ctx.db
      .query("scoringHoldEvaluations")
      .withIndex(
        "by_seasonId_and_status_and_gameWeek",
        (q) => {
          const scoped = q
            .eq("seasonId", seasonId)
            .eq("status", status);
          return dependencyWeek === undefined
            ? scoped
            : scoped.lt("gameWeek", dependencyWeek);
        },
      )
      .first();
    if (evaluation) {
      hasApplicableEvaluation = true;
      break;
    }
  }
  if (!hasApplicableEvaluation) return undefined;
  return await ctx.db.insert("scoringDependencyEvents", {
    seasonId,
    dependencyWeek,
    recordedAtMs: Date.now(),
  });
}

export async function latestScoringDependencyEventId(
  ctx: QueryCtx | MutationCtx,
  seasonId: Id<"poolSeasons">,
): Promise<Id<"scoringDependencyEvents"> | undefined> {
  const event = await ctx.db
    .query("scoringDependencyEvents")
    .withIndex("by_seasonId", (q) => q.eq("seasonId", seasonId))
    .order("desc")
    .first();
  return event?._id;
}

function blockedWorkDedupeKey(input: {
  poolId: Id<"pools">;
  kind: "survivor" | "confidence";
  week: number;
}): string {
  return `${input.poolId}:${input.kind}:${input.week}`;
}

export async function recordBlockedScoringWork(
  ctx: MutationCtx,
  input: {
    poolId: Id<"pools">;
    kind: "survivor" | "confidence";
    week: number;
    gate: ScoringGate;
    nowMs: number;
  },
): Promise<Id<"scoringBlockedWork">> {
  if (input.gate.kind === "evaluation" && input.gate.dependency) {
    const evaluation = await ctx.db.get(input.gate.evaluation._id);
    const game = await ctx.db.get(input.gate.evaluation.gameId);
    const pool = await ctx.db.get(input.poolId);
    if (
      evaluation &&
      ["building", "complete", "incomplete"].includes(
        evaluation.status,
      ) &&
      game?.resultAuthority === "verified" &&
      game.verifiedResult &&
      pool
    ) {
      const dedupeKey = scoringHoldDedupeKey({
        poolId: input.poolId,
        candidateKey: evaluation.candidateKey,
      });
      const currentForGame = await ctx.db
        .query("scoringHolds")
        .withIndex("by_poolId_and_gameId_and_status", (q) =>
          q
            .eq("poolId", input.poolId)
            .eq("gameId", evaluation.gameId)
            .eq("status", "open"),
        )
        .unique();
      if (currentForGame?.candidateKey === evaluation.candidateKey) {
        const updates: {
          candidateObservedAtMs?: number;
          evaluationId?: Id<"scoringHoldEvaluations">;
        } = {};
        if (
          evaluation.candidateObservedAtMs >
          currentForGame.candidateObservedAtMs
        ) {
          updates.candidateObservedAtMs =
            evaluation.candidateObservedAtMs;
        }
        if (currentForGame.evaluationId !== evaluation._id) {
          updates.evaluationId = evaluation._id;
          await ctx.db.patch(evaluation._id, {
            holdCount: evaluation.holdCount + 1,
          });
        }
        if (Object.keys(updates).length > 0) {
          await ctx.db.patch(currentForGame._id, updates);
        }
        input = {
          ...input,
          gate: {
            kind: "hold",
            hold: {
              ...currentForGame,
              ...updates,
            },
            candidateKey: currentForGame.candidateKey,
            gameWeek: currentForGame.gameWeek,
          },
        };
      } else {
        if (currentForGame) {
          await ctx.db.patch(currentForGame._id, {
            status: "resolved",
            resolvedAtMs: evaluation.candidateObservedAtMs,
            resolution: "superseded_candidate",
            resolvedByTokenIdentifier: "system:result-reconciliation",
            resolvedByClerkUserId: "system",
          });
          await ctx.db.insert("operatorAuditEvents", {
            action: "scoring_hold_superseded",
            actorTokenIdentifier: "system:result-reconciliation",
            actorClerkUserId: "system",
            atMs: evaluation.candidateObservedAtMs,
            detailsJson: JSON.stringify({
              holdId: currentForGame._id,
              poolId: input.poolId,
              gameId: evaluation.gameId,
              priorCandidateKey: currentForGame.candidateKey,
              candidateKey: evaluation.candidateKey,
            }),
          });
        }
        const holdId = await ctx.db.insert("scoringHolds", {
          evaluationId: evaluation._id,
          poolId: input.poolId,
          gameId: evaluation.gameId,
          poolType: pool.type,
          gameWeek: evaluation.gameWeek,
          dependency: input.gate.dependency,
          candidateKey: evaluation.candidateKey,
          dedupeKey,
          candidateHomeScore: evaluation.candidateHomeScore,
          candidateAwayScore: evaluation.candidateAwayScore,
          candidateObservedAtMs: evaluation.candidateObservedAtMs,
          candidateStatus: evaluation.candidateStatus,
          officialHomeScore: game.verifiedResult.homeScore,
          officialAwayScore: game.verifiedResult.awayScore,
          officialVerifiedAtMs: game.verifiedResult.verifiedAtMs,
          officialStatus: game.verifiedResult.status,
          status: "open",
          createdAtMs: evaluation.candidateObservedAtMs,
        });
        await ctx.db.patch(evaluation._id, {
          holdCount: evaluation.holdCount + 1,
        });
        await ctx.db.insert("operatorAuditEvents", {
          action: "scoring_hold_created",
          actorTokenIdentifier: "system:result-reconciliation",
          actorClerkUserId: "system",
          atMs: evaluation.candidateObservedAtMs,
          detailsJson: JSON.stringify({
            holdId,
            poolId: input.poolId,
            gameId: evaluation.gameId,
            candidateKey: evaluation.candidateKey,
            dependency: input.gate.dependency,
          }),
        });
        input = {
          ...input,
          gate: {
            kind: "hold",
            hold: (await ctx.db.get(holdId))!,
            candidateKey: evaluation.candidateKey,
            gameWeek: evaluation.gameWeek,
          },
        };
      }
    }
  }
  const dedupeKey = blockedWorkDedupeKey(input);
  const existing = await ctx.db
    .query("scoringBlockedWork")
    .withIndex("by_dedupeKey", (q) => q.eq("dedupeKey", dedupeKey))
    .unique();
  const fields = {
    status: "pending" as const,
    candidateKey: input.gate.candidateKey,
    holdId:
      input.gate.kind === "hold" ? input.gate.hold._id : undefined,
    evaluationId:
      input.gate.kind === "evaluation"
        ? input.gate.evaluation._id
        : input.gate.kind === "hold"
          ? input.gate.hold.evaluationId
          : undefined,
    cleanupId:
      input.gate.kind === "cleanup" ? input.gate.cleanup._id : undefined,
    acceptanceId:
      input.gate.kind === "acceptance"
        ? input.gate.acceptance._id
        : undefined,
    blockedAtMs: input.nowMs,
    replayedAtMs: undefined,
  };
  if (existing) {
    await ctx.db.patch(existing._id, fields);
    return existing._id;
  }
  return await ctx.db.insert("scoringBlockedWork", {
    poolId: input.poolId,
    kind: input.kind,
    week: input.week,
    dedupeKey,
    ...fields,
  });
}

export async function markBlockedScoringWorkReplayed(
  ctx: MutationCtx,
  input: {
    poolId: Id<"pools">;
    kind: "survivor" | "confidence";
    week: number;
    nowMs: number;
  },
): Promise<void> {
  const existing = await ctx.db
    .query("scoringBlockedWork")
    .withIndex("by_dedupeKey", (q) =>
      q.eq("dedupeKey", blockedWorkDedupeKey(input)),
    )
    .unique();
  if (existing?.status === "pending") {
    await ctx.db.patch(existing._id, {
      status: "replayed",
      replayedAtMs: input.nowMs,
    });
  }
}

export async function pendingBlockedScoringWeeks(
  ctx: QueryCtx | MutationCtx,
  input: {
    poolId: Id<"pools">;
    kind: "survivor" | "confidence";
  },
): Promise<number[]> {
  const rows = await ctx.db
    .query("scoringBlockedWork")
    .withIndex("by_poolId_and_kind_and_status", (q) =>
      q
        .eq("poolId", input.poolId)
        .eq("kind", input.kind)
        .eq("status", "pending"),
    )
    .take(18);
  return rows.map((row) => row.week);
}
