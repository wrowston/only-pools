/**
 * Audited, pinned Production Operator overrides for Verified NFL Game results.
 *
 * The game keeps only an active pointer. Every pin/release record and every
 * provider observation remains append-only for incident reconstruction.
 */
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { env, mutation, query } from "./_generated/server";
import {
  requireProductionOperatorIdentity,
  requireProductionOperatorWithStepUp,
} from "./lib/operatorAuth";
import { latestPinnedResultEvidence } from "./lib/pinnedResultEvidence";
import { retireCorrectionWorkflowForPinnedOverride } from "./syncApiSportsLive";
import {
  providerEvidenceState,
  recordProviderGameTransition,
} from "./providerEvidence";

const terminalStatusValidator = v.union(
  v.literal("FT"),
  v.literal("AOT"),
  v.literal("CANC"),
);

const replacedResultValidator = v.object({
  homeScore: v.number(),
  awayScore: v.number(),
  verifiedAtMs: v.number(),
  status: terminalStatusValidator,
});

const overrideResultValidator = v.object({
  homeScore: v.number(),
  awayScore: v.number(),
  status: terminalStatusValidator,
});

type VerifiedResult = NonNullable<Doc<"nflGames">["verifiedResult"]>;

const PINNED_RESULT_EVIDENCE_PURPOSE = "pinned_result_evidence";

function pinnedResultEvidenceScopeKey(
  overrideId: Doc<"nflGameResultOverrides">["_id"],
): string {
  return `pinned-result-evidence:${overrideId}`;
}

function normalizedReason(value: string): string {
  const reason = value.trim();
  if (reason.length === 0) {
    throw new Error("A nonempty override reason is required");
  }
  if (reason.length > 1_000) {
    throw new Error("Override reason must be 1,000 characters or fewer");
  }
  return reason;
}

function assertCoherentResult(result: {
  homeScore: number;
  awayScore: number;
  status: "FT" | "AOT" | "CANC";
}): void {
  if (
    !Number.isSafeInteger(result.homeScore) ||
    result.homeScore < 0 ||
    !Number.isSafeInteger(result.awayScore) ||
    result.awayScore < 0
  ) {
    throw new Error("Override scores must be nonnegative whole numbers");
  }
  if (
    result.status === "CANC" &&
    (result.homeScore !== 0 || result.awayScore !== 0)
  ) {
    throw new Error("Canceled override results must use canonical 0-0 scores");
  }
}

function sameResult(left: VerifiedResult, right: VerifiedResult): boolean {
  return (
    left.homeScore === right.homeScore &&
    left.awayScore === right.awayScore &&
    left.status === right.status &&
    left.verifiedAtMs === right.verifiedAtMs
  );
}

async function scheduleScoringReplay(
  ctx: Parameters<
    typeof retireCorrectionWorkflowForPinnedOverride
  >[0],
  gameId: Doc<"nflGames">["_id"],
  nowMs: number,
  status: "FT" | "AOT" | "CANC",
): Promise<void> {
  if (status === "CANC") {
    await ctx.scheduler.runAfter(
      0,
      internal.survivorScoring.handleVerifiedCancellation,
      { gameId, nowMs },
    );
  } else {
    await ctx.scheduler.runAfter(
      0,
      internal.survivorScoring.scoreSurvivorPoolsForVerifiedGame,
      { gameId, nowMs },
    );
  }
  await ctx.scheduler.runAfter(
    0,
    internal.confidenceScoring.scoreConfidencePoolsForVerifiedGame,
    { gameId, nowMs, replayLaterWeeks: true },
  );
}

export const listOperatorResultOverrides = query({
  args: {
    status: v.union(v.literal("active"), v.literal("released")),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireProductionOperatorIdentity(ctx, env);
    const result = await ctx.db
      .query("nflGameResultOverrides")
      .withIndex("by_status_and_pinnedAtMs", (q) =>
        q.eq("status", args.status),
      )
      .order("desc")
      .paginate(args.paginationOpts);
    const page = await Promise.all(
      result.page.map(async (override) => {
        const game =
          override.nflGameId === undefined
            ? null
            : await ctx.db.get(override.nflGameId);
        const [homeTeam, awayTeam, latestMatching, latestConflicting] =
          await Promise.all([
            game ? ctx.db.get(game.homeTeamId) : null,
            game ? ctx.db.get(game.awayTeamId) : null,
            ctx.db
              .query("nflGameResultOverrideEvidence")
              .withIndex(
                "by_overrideId_and_disposition_and_observedAtMs",
                (q) =>
                  q
                    .eq("overrideId", override._id)
                    .eq("disposition", "pinned_matching"),
              )
              .order("desc")
              .first(),
            ctx.db
              .query("nflGameResultOverrideEvidence")
              .withIndex(
                "by_overrideId_and_disposition_and_observedAtMs",
                (q) =>
                  q
                    .eq("overrideId", override._id)
                    .eq("disposition", "pinned_conflicting"),
              )
              .order("desc")
              .first(),
          ]);
        return {
          ...override,
          seasonLabel: override.seasonLabel,
          week: override.gameWeek,
          matchup:
            homeTeam && awayTeam
              ? `${awayTeam.abbreviation} at ${homeTeam.abbreviation}`
              : `${override.awayTeamAbbreviation} at ${override.homeTeamAbbreviation}`,
          latestMatching,
          latestConflicting,
        };
      }),
    );
    return { ...result, page };
  },
});

export const listOperatorVerifiedGames = query({
  args: {},
  handler: async (ctx) => {
    await requireProductionOperatorIdentity(ctx, env);
    const season = await ctx.db
      .query("poolSeasons")
      .withIndex("by_status", (q) => q.eq("status", "available"))
      .order("desc")
      .first();
    if (!season) return [];
    const games = await ctx.db
      .query("nflGames")
      .withIndex("by_seasonId", (q) => q.eq("seasonId", season._id))
      .take(400);
    return await Promise.all(
      games
        .filter(
          (game) =>
            game.resultAuthority === "verified" && game.verifiedResult,
        )
        .sort((left, right) => right.scheduledKickoffMs - left.scheduledKickoffMs)
        .map(async (game) => {
          const [homeTeam, awayTeam] = await Promise.all([
            ctx.db.get(game.homeTeamId),
            ctx.db.get(game.awayTeamId),
          ]);
          return {
            gameId: game._id,
            seasonLabel: game.seasonLabel,
            week: game.week,
            scheduledKickoffMs: game.scheduledKickoffMs,
            matchup:
              homeTeam && awayTeam
                ? `${awayTeam.abbreviation} at ${homeTeam.abbreviation}`
                : "Unknown matchup",
            verifiedResult: game.verifiedResult!,
            pinnedResultOverrideId: game.pinnedResultOverrideId,
          };
        }),
    );
  },
});

export const pinNflGameResultOverride = mutation({
  args: {
    gameId: v.id("nflGames"),
    reason: v.string(),
    replacedResult: replacedResultValidator,
    overrideResult: overrideResultValidator,
  },
  handler: async (ctx, args) => {
    const nowMs = Date.now();
    const actor = await requireProductionOperatorWithStepUp(
      ctx,
      nowMs,
      env,
    );
    const reason = normalizedReason(args.reason);
    assertCoherentResult(args.overrideResult);
    const game = await ctx.db.get(args.gameId);
    if (
      !game ||
      game.resultAuthority !== "verified" ||
      !game.verifiedResult
    ) {
      throw new Error("Verified NFL Game result not found");
    }
    if (!sameResult(game.verifiedResult, args.replacedResult)) {
      throw new Error(
        "The replaced result no longer matches the current Verified Result",
      );
    }
    if (game.pinnedResultOverrideId !== undefined) {
      throw new Error("This NFL Game already has an active pinned override");
    }
    const active = await ctx.db
      .query("nflGameResultOverrides")
      .withIndex("by_nflGameId_and_status", (q) =>
        q.eq("nflGameId", game._id).eq("status", "active"),
      )
      .unique();
    if (active) {
      throw new Error("This NFL Game already has an active pinned override");
    }

    const [homeTeam, awayTeam] = await Promise.all([
      ctx.db.get(game.homeTeamId),
      ctx.db.get(game.awayTeamId),
    ]);
    if (!homeTeam || !awayTeam) {
      throw new Error("NFL Game team identity is incomplete");
    }
    const retiredWorkflow =
      await retireCorrectionWorkflowForPinnedOverride(ctx, {
        game,
        nowMs,
      });
    const pinnedResult = {
      ...args.overrideResult,
      verifiedAtMs: nowMs,
    };
    const overrideId = await ctx.db.insert("nflGameResultOverrides", {
      nflGameId: game._id,
      gameStableKey: game.stableKey,
      seasonLabel: game.seasonLabel,
      gameWeek: game.week,
      homeTeamAbbreviation: homeTeam.abbreviation,
      awayTeamAbbreviation: awayTeam.abbreviation,
      status: "active",
      reason,
      replacedResult: game.verifiedResult,
      overrideResult: pinnedResult,
      actorTokenIdentifier: actor.tokenIdentifier,
      actorClerkUserId: actor.clerkUserId,
      pinnedAtMs: nowMs,
      workflowCleanupId: retiredWorkflow?.cleanupId,
    });
    await ctx.db.insert("syncWorkItems", {
      surface: "correction",
      scopeKey: pinnedResultEvidenceScopeKey(overrideId),
      priority: "recovery",
      status: "due",
      dueAtMs: nowMs,
      attemptCount: 0,
      gameId: game._id,
      pinnedResultOverrideId: overrideId,
      seasonId: game.seasonId,
      purpose: PINNED_RESULT_EVIDENCE_PURPOSE,
    });
    await ctx.db.insert("nflGameResultHistory", {
      nflGameId: game._id,
      homeScore: game.verifiedResult.homeScore,
      awayScore: game.verifiedResult.awayScore,
      status: game.verifiedResult.status,
      verifiedAtMs: game.verifiedResult.verifiedAtMs,
      supersededAtMs: nowMs,
    });
    await ctx.db.patch(game._id, {
      lifecycle: pinnedResult.status === "CANC" ? "canceled" : "terminal",
      homeScore: pinnedResult.homeScore,
      awayScore: pinnedResult.awayScore,
      resultAuthority: "verified",
      verifiedResult: pinnedResult,
      priorVerifiedResult: {
        ...game.verifiedResult,
        supersededAtMs: nowMs,
      },
      correctionCandidate: undefined,
      pinnedResultOverrideId: overrideId,
      revision: (game.revision ?? 0) + 1,
    });
    await recordProviderGameTransition(ctx, {
      gameId: game._id,
      provider: "operator",
      externalId: `override:${overrideId}`,
      source: "override",
      observedAtMs: nowMs,
      before: providerEvidenceState(game),
      after: providerEvidenceState({
        ...game,
        lifecycle:
          pinnedResult.status === "CANC"
            ? "canceled"
            : "terminal",
        homeScore: pinnedResult.homeScore,
        awayScore: pinnedResult.awayScore,
        resultAuthority: "verified",
        verifiedResult: pinnedResult,
        priorVerifiedResult: {
          ...game.verifiedResult,
          supersededAtMs: nowMs,
        },
        correctionCandidate: undefined,
        pinnedResultOverrideId: overrideId,
      }),
    });
    await ctx.db.insert("operatorAuditEvents", {
      action: "nfl_game_result_override_pinned",
      actorTokenIdentifier: actor.tokenIdentifier,
      actorClerkUserId: actor.clerkUserId,
      atMs: nowMs,
      detailsJson: JSON.stringify({
        overrideId,
        gameId: game._id,
        reason,
        replacedResult: game.verifiedResult,
        overrideResult: pinnedResult,
        retiredCandidateKey: retiredWorkflow?.candidateKey ?? null,
        workflowCleanupId: retiredWorkflow?.cleanupId ?? null,
        workflowCleanupStatus: retiredWorkflow?.cleanupStatus ?? null,
      }),
    });
    await scheduleScoringReplay(
      ctx,
      game._id,
      nowMs,
      pinnedResult.status,
    );
    return { overrideId, pinnedAtMs: nowMs };
  },
});

export const releaseNflGameResultOverride = mutation({
  args: {
    overrideId: v.id("nflGameResultOverrides"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const nowMs = Date.now();
    const actor = await requireProductionOperatorWithStepUp(
      ctx,
      nowMs,
      env,
    );
    const reason = normalizedReason(args.reason);
    const override = await ctx.db.get(args.overrideId);
    if (!override || override.status !== "active") {
      throw new Error("Active NFL Game result override not found");
    }
    if (override.nflGameId === undefined) {
      throw new Error("Active NFL Game result override is detached");
    }
    const game = await ctx.db.get(override.nflGameId);
    if (!game || game.pinnedResultOverrideId !== override._id) {
      throw new Error("Pinned NFL Game result override is no longer current");
    }
    if (override.workflowCleanupId !== undefined) {
      const cleanup = await ctx.db.get(override.workflowCleanupId);
      if (!cleanup || cleanup.status !== "complete") {
        throw new Error(
          "Pinned override cleanup is still processing; release is deferred",
        );
      }
    }
    const latestPinnedEvidence = await latestPinnedResultEvidence(
      ctx,
      override._id,
    );
    if (!latestPinnedEvidence) {
      throw new Error(
        "Provider evidence has not yet been received during this pin episode; release is deferred",
      );
    }
    const releaseEvidence = {
      observedAtMs: latestPinnedEvidence.observedAtMs,
      homeScore: latestPinnedEvidence.homeScore,
      awayScore: latestPinnedEvidence.awayScore,
      status: latestPinnedEvidence.status,
      source: "latest_pinned_provider_observation" as const,
    };
    await ctx.db.patch(override._id, {
      status: "released",
      nflGameId: undefined,
      workflowCleanupId: undefined,
      releaseReason: reason,
      releasedAtMs: nowMs,
      releasedByTokenIdentifier: actor.tokenIdentifier,
      releasedByClerkUserId: actor.clerkUserId,
    });
    await ctx.db.patch(game._id, {
      pinnedResultOverrideId: undefined,
      revision: (game.revision ?? 0) + 1,
    });
    await recordProviderGameTransition(ctx, {
      gameId: game._id,
      provider: "operator",
      externalId: `override:${override._id}`,
      source: "override",
      observedAtMs: nowMs,
      before: providerEvidenceState(game),
      after: providerEvidenceState({
        ...game,
        pinnedResultOverrideId: undefined,
      }),
    });
    const evidenceWork = await ctx.db
      .query("syncWorkItems")
      .withIndex("by_scopeKey", (q) =>
        q.eq("scopeKey", pinnedResultEvidenceScopeKey(override._id)),
      )
      .unique();
    if (evidenceWork) {
      await ctx.db.patch(evidenceWork._id, {
        status: "done",
        claimedAtMs: undefined,
        leaseExpiresAtMs: undefined,
      });
    }
    await ctx.db.insert("operatorAuditEvents", {
      action: "nfl_game_result_override_released",
      actorTokenIdentifier: actor.tokenIdentifier,
      actorClerkUserId: actor.clerkUserId,
      atMs: nowMs,
      detailsJson: JSON.stringify({
        overrideId: override._id,
        gameId: game._id,
        reason,
        releaseEvidenceSource: releaseEvidence.source,
        releaseEvidence: {
          observedAtMs: releaseEvidence.observedAtMs,
          homeScore: releaseEvidence.homeScore,
          awayScore: releaseEvidence.awayScore,
          status: releaseEvidence.status,
        },
      }),
    });
    await ctx.scheduler.runAfter(
      0,
      internal.syncApiSportsLive.applyReconciliationObservation,
      {
        gameId: game._id,
        observation: {
          externalId: `operator-release:${override._id}`,
          observedAtMs: releaseEvidence.observedAtMs,
          lifecycle:
            releaseEvidence.status === "CANC" ? "canceled" : "terminal",
          homeScore: releaseEvidence.homeScore,
          awayScore: releaseEvidence.awayScore,
          providerStatus: {
            rawShort: releaseEvidence.status,
            rawLong: "Released pinned override evidence",
            recognized: true,
            terminal: true,
          },
        },
      },
    );
    return {
      reconciliationResult: "submitted" as const,
      evidenceSource: releaseEvidence.source,
    };
  },
});
