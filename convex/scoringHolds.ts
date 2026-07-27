/**
 * Production Operator review of pool-specific scoring holds.
 *
 * A result is global, so resolving one hold resolves every open hold for the
 * same semantic candidate before existing scoring fan-out is resumed.
 */
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  env,
  internalMutation,
  mutation,
  query,
} from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import {
  requireProductionOperatorIdentity,
} from "./lib/operatorAuth";
import {
  latestScoringDependencyEventId,
  recordBlockedScoringWork,
  scoringHoldCandidateKey,
} from "./lib/scoringHolds";

function holdMatchesCurrentCandidate(
  hold: Doc<"scoringHolds">,
  game: Doc<"nflGames">,
): boolean {
  const candidate = game.correctionCandidate;
  if (!candidate) return false;
  return (
    hold.candidateKey ===
    scoringHoldCandidateKey({ gameId: game._id, ...candidate })
  );
}

export const listOperatorScoringHolds = query({
  args: {
    status: v.union(v.literal("open"), v.literal("resolved")),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireProductionOperatorIdentity(ctx, env);
    const result = await ctx.db
      .query("scoringHolds")
      .withIndex("by_status_and_createdAtMs", (q) =>
        q.eq("status", args.status),
      )
      .order("desc")
      .paginate(args.paginationOpts);
    const page = await Promise.all(
      result.page.map(async (hold) => {
        const [pool, game, evaluation] = await Promise.all([
          ctx.db.get(hold.poolId),
          ctx.db.get(hold.gameId),
          hold.evaluationId ? ctx.db.get(hold.evaluationId) : null,
        ]);
        const activeAcceptances =
          args.status === "open"
            ? (
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
                            .eq("gameId", hold.gameId)
                            .eq("candidateKey", hold.candidateKey)
                            .eq("status", status),
                      )
                      .unique(),
                  ),
                )
              ).filter(
                (
                  row,
                ): row is Doc<"scoringHoldAcceptances"> =>
                  row !== null,
              )
            : [];
        if (activeAcceptances.length > 1) {
          throw new Error(
            "Scoring Hold acceptance invariant violated: multiple active acceptances for one candidate",
          );
        }
        const activeAcceptance = activeAcceptances[0] ?? null;
        if (
          args.status === "open" &&
          evaluation &&
          !activeAcceptance &&
          !["building", "complete", "incomplete"].includes(
            evaluation.status,
          )
        ) {
          return null;
        }
        const [homeTeam, awayTeam] = game
          ? await Promise.all([
              ctx.db.get(game.homeTeamId),
              ctx.db.get(game.awayTeamId),
            ])
          : [null, null];
        return {
          ...hold,
          evaluationStatus: evaluation?.status ?? "complete",
          acceptanceStatus: activeAcceptance?.status ?? null,
          poolName: pool?.name ?? "Deleted Pool",
          matchup:
            homeTeam && awayTeam
              ? `${awayTeam.abbreviation} at ${homeTeam.abbreviation}`
              : "Unknown matchup",
        };
      }),
    );
    return {
      ...result,
      page: page.filter((hold) => hold !== null),
    };
  },
});

type AcceptanceResult = {
  status: "processing" | "complete" | "abandoned" | "rejected";
  resolvedHoldCount: number;
  scoringScheduled: boolean;
};

async function restartEvaluationIfDependencyEventAdvanced(
  ctx: MutationCtx,
  evaluation: Doc<"scoringHoldEvaluations">,
): Promise<boolean> {
  const dependencyEventId = await latestScoringDependencyEventId(
    ctx,
    evaluation.seasonId,
  );
  if (evaluation.dependencyEventId === dependencyEventId) {
    return false;
  }
  await ctx.db.patch(evaluation._id, {
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
      evaluationId: evaluation._id,
      candidateKey: evaluation.candidateKey,
    },
  );
  return true;
}

async function abandonAcceptance(
  ctx: MutationCtx,
  acceptance: Doc<"scoringHoldAcceptances">,
): Promise<AcceptanceResult> {
  await ctx.db.patch(acceptance._id, {
    status: "abandoned",
    abandonedAtMs: Date.now(),
  });
  return {
    status: "abandoned",
    resolvedHoldCount: acceptance.processedHolds,
    scoringScheduled: false,
  };
}

async function applyAcceptedCorrection(
  ctx: MutationCtx,
  input: {
    acceptance: Doc<"scoringHoldAcceptances">;
    game: Doc<"nflGames">;
  },
): Promise<void> {
  const candidate = input.game.correctionCandidate!;
  const verified = input.game.verifiedResult!;
  const nowMs = input.acceptance.startedAtMs;
  await ctx.db.insert("nflGameResultHistory", {
    nflGameId: input.game._id,
    homeScore: verified.homeScore,
    awayScore: verified.awayScore,
    status: verified.status,
    verifiedAtMs: verified.verifiedAtMs,
    supersededAtMs: nowMs,
  });
  await ctx.db.insert("nflGameResultReconciliationObservations", {
    nflGameId: input.game._id,
    observedAtMs: candidate.observedAtMs,
    homeScore: candidate.homeScore,
    awayScore: candidate.awayScore,
    status: candidate.status,
    matchesVerified: false,
    disposition: "corrected",
  });
  await ctx.db.patch(input.game._id, {
    lifecycle: candidate.status === "CANC" ? "canceled" : "terminal",
    homeScore: candidate.homeScore,
    awayScore: candidate.awayScore,
    verifiedResult: {
      homeScore: candidate.homeScore,
      awayScore: candidate.awayScore,
      status: candidate.status,
      verifiedAtMs: candidate.observedAtMs,
    },
    priorVerifiedResult: {
      ...verified,
      supersededAtMs: nowMs,
    },
    correctionCandidate: undefined,
    revision: (input.game.revision ?? 0) + 1,
  });
}

async function scheduleAcceptedScoringReplay(
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

async function scheduleAcceptanceContinuation(
  ctx: MutationCtx,
  acceptanceId: Id<"scoringHoldAcceptances">,
): Promise<void> {
  await ctx.scheduler.runAfter(
    0,
    internal.scoringHolds.continueScoringHoldAcceptance,
    { acceptanceId },
  );
}

async function processScoringHoldAcceptance(
  ctx: MutationCtx,
  acceptanceId: Id<"scoringHoldAcceptances">,
): Promise<AcceptanceResult> {
  const acceptance = await ctx.db.get(acceptanceId);
  if (!acceptance) {
    return {
      status: "abandoned",
      resolvedHoldCount: 0,
      scoringScheduled: false,
    };
  }
  if (
    ["complete", "abandoned", "rejected"].includes(acceptance.status)
  ) {
    return {
      status: acceptance.status as "complete" | "abandoned" | "rejected",
      resolvedHoldCount: acceptance.processedHolds,
      scoringScheduled: acceptance.status === "complete",
    };
  }
  const game = await ctx.db.get(acceptance.gameId);
  const resultAlreadyApplied =
    ["applying_evaluations", "resolving_holds"].includes(
      acceptance.status,
    ) &&
    acceptance.appliedAtMs !== undefined;
  if (
    !game ||
    (!resultAlreadyApplied &&
      (game.resultAuthority !== "verified" ||
        !game.verifiedResult ||
        !game.correctionCandidate ||
        scoringHoldCandidateKey({
          gameId: game._id,
          ...game.correctionCandidate,
        }) !== acceptance.candidateKey))
  ) {
    return await abandonAcceptance(ctx, acceptance);
  }

  if (acceptance.status === "validating_evaluations") {
    const page = await ctx.db
      .query("scoringHoldEvaluations")
      .withIndex("by_gameId_and_candidateKey", (q) =>
        q
          .eq("gameId", acceptance.gameId)
          .eq("candidateKey", acceptance.candidateKey),
      )
      .paginate({ numItems: 200, cursor: acceptance.cursor ?? null });
    if (
      page.page.some((evaluation) =>
        ["building", "incomplete"].includes(evaluation.status),
      )
    ) {
      await ctx.db.patch(acceptance._id, {
        status: "rejected",
        completedAtMs: acceptance.startedAtMs,
      });
      return {
        status: "rejected",
        resolvedHoldCount: 0,
        scoringScheduled: false,
      };
    }
    if (!page.isDone) {
      await ctx.db.patch(acceptance._id, {
        cursor: page.continueCursor,
      });
      await scheduleAcceptanceContinuation(ctx, acceptance._id);
      return {
        status: "processing",
        resolvedHoldCount: 0,
        scoringScheduled: false,
      };
    }
    await ctx.db.patch(acceptance._id, {
      status: "validating_holds",
      cursor: undefined,
    });
    await scheduleAcceptanceContinuation(ctx, acceptance._id);
    return {
      status: "processing",
      resolvedHoldCount: 0,
      scoringScheduled: false,
    };
  }

  if (acceptance.status === "validating_holds") {
    const page = await ctx.db
      .query("scoringHolds")
      .withIndex("by_gameId_and_candidateKey_and_status", (q) =>
        q
          .eq("gameId", acceptance.gameId)
          .eq("candidateKey", acceptance.candidateKey)
          .eq("status", "open"),
      )
      .paginate({ numItems: 200, cursor: acceptance.cursor ?? null });
    if (
      page.page.some(
        (hold) => hold.dependency === "bounded_scope_exceeded",
      )
    ) {
      await ctx.db.patch(acceptance._id, {
        status: "rejected",
        completedAtMs: acceptance.startedAtMs,
      });
      return {
        status: "rejected",
        resolvedHoldCount: 0,
        scoringScheduled: false,
      };
    }
    const validatedHolds =
      acceptance.validatedHolds + page.page.length;
    const blockedPoolWeeks = new Map<
      string,
      (typeof page.page)[number]
    >();
    for (const hold of page.page) {
      blockedPoolWeeks.set(`${hold.poolId}:${hold.gameWeek}`, hold);
    }
    for (const hold of blockedPoolWeeks.values()) {
      await recordBlockedScoringWork(ctx, {
        poolId: hold.poolId,
        kind: hold.poolType,
        week: hold.gameWeek,
        gate: {
          kind: "acceptance",
          acceptance,
          candidateKey: acceptance.candidateKey,
          gameWeek: acceptance.gameWeek,
        },
        nowMs: acceptance.startedAtMs,
      });
    }
    if (!page.isDone) {
      await ctx.db.patch(acceptance._id, {
        cursor: page.continueCursor,
        validatedHolds,
      });
      await scheduleAcceptanceContinuation(ctx, acceptance._id);
      return {
        status: "processing",
        resolvedHoldCount: 0,
        scoringScheduled: false,
      };
    }
    const evaluation = await ctx.db
      .query("scoringHoldEvaluations")
      .withIndex(
        "by_gameId_and_candidateKey_and_status",
        (q) =>
          q
            .eq("gameId", acceptance.gameId)
            .eq("candidateKey", acceptance.candidateKey)
            .eq("status", "complete"),
      )
      .unique();
    if (
      evaluation &&
      (await restartEvaluationIfDependencyEventAdvanced(
        ctx,
        evaluation,
      ))
    ) {
      await ctx.db.patch(acceptance._id, {
        status: "rejected",
        completedAtMs: acceptance.startedAtMs,
      });
      return {
        status: "rejected",
        resolvedHoldCount: 0,
        scoringScheduled: false,
      };
    }
    await applyAcceptedCorrection(ctx, { acceptance, game });
    await ctx.db.patch(acceptance._id, {
      status: "applying_evaluations",
      cursor: undefined,
      validatedHolds,
      appliedAtMs: acceptance.startedAtMs,
    });
    await scheduleAcceptanceContinuation(ctx, acceptance._id);
    return {
      status: "processing",
      resolvedHoldCount: 0,
      scoringScheduled: false,
    };
  }

  if (acceptance.status === "resolving_holds") {
    const page = await ctx.db
      .query("scoringHolds")
      .withIndex("by_gameId_and_candidateKey", (q) =>
        q
          .eq("gameId", acceptance.gameId)
          .eq("candidateKey", acceptance.candidateKey),
      )
      .paginate({ numItems: 200, cursor: acceptance.cursor ?? null });
    let resolved = 0;
    for (const hold of page.page) {
      if (hold.status !== "open") continue;
      await ctx.db.patch(hold._id, {
        status: "resolved",
        resolvedAtMs: acceptance.startedAtMs,
        resolution: "accepted_correction",
        resolvedByTokenIdentifier: acceptance.actorTokenIdentifier,
        resolvedByClerkUserId: acceptance.actorClerkUserId,
      });
      await ctx.db.insert("operatorAuditEvents", {
        action: "scoring_hold_resolved",
        actorTokenIdentifier: acceptance.actorTokenIdentifier,
        actorClerkUserId: acceptance.actorClerkUserId,
        atMs: acceptance.startedAtMs,
        detailsJson: JSON.stringify({
          holdId: hold._id,
          poolId: hold.poolId,
          gameId: acceptance.gameId,
          candidateKey: hold.candidateKey,
          resolution: "accepted_correction",
        }),
      });
      resolved += 1;
    }
    const processedHolds = acceptance.processedHolds + resolved;
    if (!page.isDone) {
      await ctx.db.patch(acceptance._id, {
        cursor: page.continueCursor,
        processedHolds,
      });
      await scheduleAcceptanceContinuation(ctx, acceptance._id);
      return {
        status: "processing",
        resolvedHoldCount: processedHolds,
        scoringScheduled: false,
      };
    }
    await ctx.db.patch(acceptance._id, {
      status: "complete",
      processedHolds,
      cursor: undefined,
      completedAtMs: acceptance.startedAtMs,
    });
    await scheduleAcceptedScoringReplay(ctx, {
      gameId: game._id,
      nowMs: acceptance.startedAtMs,
    });
    return {
      status: "complete",
      resolvedHoldCount: processedHolds,
      scoringScheduled: true,
    };
  }

  const page = await ctx.db
    .query("scoringHoldEvaluations")
    .withIndex("by_gameId_and_candidateKey", (q) =>
      q
        .eq("gameId", acceptance.gameId)
        .eq("candidateKey", acceptance.candidateKey),
    )
    .paginate({ numItems: 200, cursor: acceptance.cursor ?? null });
  for (const evaluation of page.page) {
    if (evaluation.status === "complete") {
      await ctx.db.patch(evaluation._id, {
        status: "applied",
        completedAtMs: acceptance.startedAtMs,
      });
    }
  }
  if (!page.isDone) {
    await ctx.db.patch(acceptance._id, {
      cursor: page.continueCursor,
    });
    await scheduleAcceptanceContinuation(ctx, acceptance._id);
    return {
      status: "processing",
      resolvedHoldCount: acceptance.processedHolds,
      scoringScheduled: false,
    };
  }
  await ctx.db.patch(acceptance._id, {
    status: "resolving_holds",
    cursor: undefined,
    appliedAtMs: acceptance.startedAtMs,
  });
  await scheduleAcceptanceContinuation(ctx, acceptance._id);
  return {
    status: "processing",
    resolvedHoldCount: acceptance.processedHolds,
    scoringScheduled: false,
  };
}

export const continueScoringHoldAcceptance = internalMutation({
  args: {
    acceptanceId: v.id("scoringHoldAcceptances"),
  },
  handler: async (ctx, args) =>
    await processScoringHoldAcceptance(ctx, args.acceptanceId),
});

export const resolveScoringHold = mutation({
  args: {
    holdId: v.id("scoringHolds"),
  },
  handler: async (ctx, args) => {
    const actor = await requireProductionOperatorIdentity(ctx, env);
    const selectedHold = await ctx.db.get(args.holdId);
    if (!selectedHold || selectedHold.status !== "open") {
      throw new Error("Open Scoring Hold not found");
    }
    const game = await ctx.db.get(selectedHold.gameId);
    if (
      !game ||
      game.resultAuthority !== "verified" ||
      !game.verifiedResult ||
      !holdMatchesCurrentCandidate(selectedHold, game)
    ) {
      throw new Error("Scoring Hold candidate is no longer current");
    }
    const evaluation = selectedHold.evaluationId
      ? await ctx.db.get(selectedHold.evaluationId)
      : null;
    if (
      selectedHold.evaluationId &&
      (!evaluation ||
        evaluation.status !== "complete" ||
        evaluation.candidateKey !== selectedHold.candidateKey)
    ) {
      throw new Error(
        "Scoring Hold evaluation must complete before acceptance",
      );
    }
    if (
      evaluation &&
      (await restartEvaluationIfDependencyEventAdvanced(
        ctx,
        evaluation,
      ))
    ) {
      return {
        resolution: "evaluation_restarted" as const,
        resolvedHoldCount: 0,
        scoringScheduled: false,
      };
    }
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
            .withIndex(
              "by_gameId_and_candidateKey_and_status",
              (q) =>
                q
                  .eq("gameId", game._id)
                  .eq("candidateKey", selectedHold.candidateKey)
                  .eq("status", status),
            )
            .unique(),
        ),
      )
    ).filter(
      (row): row is Doc<"scoringHoldAcceptances"> => row !== null,
    );
    if (activeAcceptances.length > 1) {
      throw new Error(
        "Scoring Hold acceptance invariant violated: multiple active acceptances for one candidate",
      );
    }
    const existing = activeAcceptances[0] ?? null;
    if (existing) {
      const result = await processScoringHoldAcceptance(
        ctx,
        existing._id,
      );
      return {
        resolution: "accepted_correction" as const,
        resolvedHoldCount: result.resolvedHoldCount,
        scoringScheduled: result.scoringScheduled,
      };
    }

    const [evaluationRows, matchingHolds] = await Promise.all([
      Promise.all(
        (["building", "complete", "incomplete"] as const).map((status) =>
          ctx.db
            .query("scoringHoldEvaluations")
            .withIndex(
              "by_gameId_and_candidateKey_and_status",
              (q) =>
                q
                  .eq("gameId", game._id)
                  .eq("candidateKey", selectedHold.candidateKey)
                  .eq("status", status),
            )
            .unique(),
        ),
      ),
      ctx.db
        .query("scoringHolds")
        .withIndex("by_gameId_and_candidateKey_and_status", (q) =>
          q
            .eq("gameId", game._id)
            .eq("candidateKey", selectedHold.candidateKey)
            .eq("status", "open"),
        )
        .take(201),
    ]);
    const evaluations = evaluationRows.filter(
      (row): row is Doc<"scoringHoldEvaluations"> => row !== null,
    );
    if (evaluations.length > 1) {
      throw new Error(
        "Scoring Hold evaluation invariant violated during acceptance",
      );
    }
    if (
      evaluations.some((row) =>
        ["building", "incomplete"].includes(row.status),
      )
    ) {
      throw new Error(
        "Scoring Hold evaluation must complete before acceptance",
      );
    }
    if (
      matchingHolds.length <= 200 &&
      matchingHolds.some(
        (hold) =>
          hold.status === "open" &&
          hold.dependency === "bounded_scope_exceeded",
      )
    ) {
      throw new Error(
        "Bounded dependency scope is incomplete; this correction cannot be accepted globally",
      );
    }
    const nowMs = Date.now();
    const fastPath = matchingHolds.length <= 200;
    const acceptanceId = await ctx.db.insert(
      "scoringHoldAcceptances",
      {
        seasonId: game.seasonId,
        gameId: game._id,
        gameWeek: game.week,
        candidateKey: selectedHold.candidateKey,
        status: fastPath
          ? "applying_evaluations"
          : "validating_holds",
        validatedHolds: fastPath
          ? matchingHolds.filter((hold) => hold.status === "open").length
          : 0,
        processedHolds: 0,
        actorTokenIdentifier: actor.tokenIdentifier,
        actorClerkUserId: actor.clerkUserId,
        startedAtMs: nowMs,
      },
    );
    if (fastPath) {
      for (const row of evaluations) {
        if (row.status === "complete") {
          await ctx.db.patch(row._id, {
            status: "applied",
            completedAtMs: nowMs,
          });
        }
      }
      const acceptance = (await ctx.db.get(acceptanceId))!;
      await applyAcceptedCorrection(ctx, { acceptance, game });
      await ctx.db.patch(acceptanceId, {
        status: "resolving_holds",
        appliedAtMs: nowMs,
      });
      let processedHolds = 0;
      for (const hold of matchingHolds) {
        if (hold.status !== "open") continue;
        await ctx.db.patch(hold._id, {
          status: "resolved",
          resolvedAtMs: nowMs,
          resolution: "accepted_correction",
          resolvedByTokenIdentifier: actor.tokenIdentifier,
          resolvedByClerkUserId: actor.clerkUserId,
        });
        await ctx.db.insert("operatorAuditEvents", {
          action: "scoring_hold_resolved",
          actorTokenIdentifier: actor.tokenIdentifier,
          actorClerkUserId: actor.clerkUserId,
          atMs: nowMs,
          detailsJson: JSON.stringify({
            holdId: hold._id,
            poolId: hold.poolId,
            gameId: game._id,
            candidateKey: hold.candidateKey,
            resolution: "accepted_correction",
          }),
        });
        processedHolds += 1;
      }
      await ctx.db.patch(acceptanceId, {
        status: "complete",
        processedHolds,
        completedAtMs: nowMs,
      });
      await scheduleAcceptedScoringReplay(ctx, {
        gameId: game._id,
        nowMs,
      });
      return {
        resolution: "accepted_correction" as const,
        resolvedHoldCount: processedHolds,
        scoringScheduled: true,
      };
    }
    const result = await processScoringHoldAcceptance(ctx, acceptanceId);
    return {
      resolution: "accepted_correction" as const,
      resolvedHoldCount: result.resolvedHoldCount,
      scoringScheduled: result.scoringScheduled,
    };
  },
});
