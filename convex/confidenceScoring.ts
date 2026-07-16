/**
 * Confidence Scoring Revisions — progressive Weekly Standings from Verified
 * Results; Season Standings advance only when a week fully resolves.
 * Ticket 09: unique values, tiebreaker, idempotency, standings queries.
 */

import { v } from "convex/values";
import {
  internalMutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { AuthError, requireParticipant } from "./lib/auth";
import {
  computeWeeklyCutoffMs,
  isConfidenceGameLocked,
} from "./lib/pickLock";
import {
  CONFIDENCE_FINAL_WEEK,
  buildConfidenceWeekFingerprint,
  computePossibleRemainingPoints,
  computeWeeklyPoints,
  rankSeasonStandings,
  rankWeeklyStandings,
  resolveConfidencePickOutcome,
  tiebreakerActualTotal,
  weekFullyResolved,
  type ConfidencePickOutcomeKind,
  type VerifiedGameInput,
} from "./lib/confidenceScoring";

type DbCtx = QueryCtx | MutationCtx;

async function requirePoolMembership(
  ctx: DbCtx,
  poolId: Id<"pools">,
  participantId: Id<"participants">,
): Promise<Doc<"poolMemberships">> {
  const membership = await ctx.db
    .query("poolMemberships")
    .withIndex("by_poolId_and_participantId", (q) =>
      q.eq("poolId", poolId).eq("participantId", participantId),
    )
    .unique();
  if (!membership || membership.status !== "active") {
    throw new AuthError("Not a member of this Pool");
  }
  return membership;
}

async function loadWeekGames(
  ctx: DbCtx,
  seasonId: Id<"poolSeasons">,
  week: number,
) {
  return await ctx.db
    .query("nflGames")
    .withIndex("by_seasonId_and_week", (q) =>
      q.eq("seasonId", seasonId).eq("week", week),
    )
    .take(64);
}

function toVerifiedInput(game: Doc<"nflGames">): VerifiedGameInput {
  return {
    gameId: game._id,
    homeTeamId: game.homeTeamId,
    awayTeamId: game.awayTeamId,
    resultAuthority: game.resultAuthority ?? "none",
    homeScore: game.verifiedResult?.homeScore ?? game.homeScore,
    awayScore: game.verifiedResult?.awayScore ?? game.awayScore,
    verifiedStatus: game.verifiedResult?.status ?? null,
  };
}

function gameLockMap(
  pool: Doc<"pools">,
  games: Doc<"nflGames">[],
  nowMs: number,
): Map<Id<"nflGames">, boolean> {
  const earliest =
    games.length === 0
      ? null
      : Math.min(...games.map((g) => g.scheduledKickoffMs));
  const weeklyCutoffMs =
    pool.pickLockMode === "weeklyCutoff" && earliest !== null
      ? computeWeeklyCutoffMs(earliest)
      : null;
  const map = new Map<Id<"nflGames">, boolean>();
  for (const g of games) {
    map.set(
      g._id,
      isConfidenceGameLocked({
        pickLockMode: pool.pickLockMode,
        game: g,
        weeklyCutoffMs,
        nowMs,
      }),
    );
  }
  return map;
}

async function loadOrInitSeasonStanding(
  ctx: MutationCtx,
  poolId: Id<"pools">,
  participantId: Id<"participants">,
  nowMs: number,
): Promise<Doc<"seasonStandings">> {
  const existing = await ctx.db
    .query("seasonStandings")
    .withIndex("by_poolId_and_participantId", (q) =>
      q.eq("poolId", poolId).eq("participantId", participantId),
    )
    .unique();
  if (existing) return existing;
  const id = await ctx.db.insert("seasonStandings", {
    poolId,
    participantId,
    eligibility: "alive",
    seasonPoints: 0,
    seasonRank: 1,
    updatedAtMs: nowMs,
  });
  const row = await ctx.db.get(id);
  if (!row) throw new Error("Failed to create season standing");
  return row;
}

async function upsertPickOutcome(
  ctx: MutationCtx,
  args: {
    poolId: Id<"pools">;
    participantId: Id<"participants">;
    week: number;
    gameId: Id<"nflGames">;
    pickId?: Id<"confidencePicks">;
    outcome: ConfidencePickOutcomeKind;
    pointsEarned: number;
    confidenceValue: number;
    revisionId: Id<"scoringRevisions">;
    nowMs: number;
  },
) {
  const existing = await ctx.db
    .query("confidencePickOutcomes")
    .withIndex("by_poolId_and_participantId_and_week_and_gameId", (q) =>
      q
        .eq("poolId", args.poolId)
        .eq("participantId", args.participantId)
        .eq("week", args.week)
        .eq("gameId", args.gameId),
    )
    .unique();
  const patch = {
    pickId: args.pickId,
    outcome: args.outcome,
    pointsEarned: args.pointsEarned,
    confidenceValue: args.confidenceValue,
    revisionId: args.revisionId,
    updatedAtMs: args.nowMs,
  };
  if (existing) {
    await ctx.db.patch(existing._id, patch);
  } else {
    await ctx.db.insert("confidencePickOutcomes", {
      poolId: args.poolId,
      participantId: args.participantId,
      week: args.week,
      gameId: args.gameId,
      ...patch,
    });
  }
}

async function upsertWeeklyStanding(
  ctx: MutationCtx,
  args: {
    poolId: Id<"pools">;
    participantId: Id<"participants">;
    week: number;
    points: number;
    possibleRemainingPoints: number;
    rank: number;
    correctPickCount: number;
    tiebreakerPrediction?: number;
    tiebreakerAbsError?: number;
    tiebreakerUsable: boolean;
    revisionId: Id<"scoringRevisions">;
    nowMs: number;
  },
) {
  const existing = await ctx.db
    .query("weeklyStandings")
    .withIndex("by_poolId_and_participantId_and_week", (q) =>
      q
        .eq("poolId", args.poolId)
        .eq("participantId", args.participantId)
        .eq("week", args.week),
    )
    .unique();
  const fields = {
    points: args.points,
    possibleRemainingPoints: args.possibleRemainingPoints,
    rank: args.rank,
    correctPickCount: args.correctPickCount,
    tiebreakerPrediction: args.tiebreakerPrediction,
    tiebreakerAbsError: args.tiebreakerAbsError,
    tiebreakerUsable: args.tiebreakerUsable,
    revisionId: args.revisionId,
    updatedAtMs: args.nowMs,
  };
  if (existing) {
    await ctx.db.patch(existing._id, fields);
  } else {
    await ctx.db.insert("weeklyStandings", {
      poolId: args.poolId,
      participantId: args.participantId,
      week: args.week,
      ...fields,
    });
  }
}

type PublishResult =
  | { status: "noop"; reason: "identical_fingerprint"; revisionNumber: number }
  | { status: "stale"; reason: "newer_revision_exists"; revisionNumber: number }
  | {
      status: "published";
      revisionId: Id<"scoringRevisions">;
      revisionNumber: number;
      weekSettled: boolean;
      poolStatus: "active" | "completed";
    };

/**
 * Atomically publish a Confidence Scoring Revision for one Pool Week.
 * Progressive Weekly Standings; Season Standing only when weekFullyResolved.
 */
export const applyConfidenceScoringRevision = internalMutation({
  args: {
    poolId: v.id("pools"),
    week: v.number(),
    basisRevisionNumber: v.optional(v.number()),
    nowMs: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<PublishResult> => {
    const pool = await ctx.db.get(args.poolId);
    if (!pool) throw new Error("Pool not found");
    if (pool.type !== "confidence") {
      throw new Error("Confidence scoring only applies to Confidence Pools");
    }
    if (args.week < pool.startWeek || args.week > CONFIDENCE_FINAL_WEEK) {
      throw new Error("Week is outside this Pool's included weeks");
    }

    const nowMs = args.nowMs ?? Date.now();
    const memberships = (
      await ctx.db
        .query("poolMemberships")
        .withIndex("by_poolId", (q) => q.eq("poolId", pool._id))
        .take(120)
    ).filter((m) => m.status === "active");

    for (const m of memberships) {
      await loadOrInitSeasonStanding(ctx, pool._id, m.participantId, nowMs);
    }

    const games = await loadWeekGames(ctx, pool.seasonId, args.week);
    const locks = gameLockMap(pool, games, nowMs);
    const gameById = new Map(games.map((g) => [g._id, g] as const));

    const sheet = await ctx.db
      .query("confidencePickSheets")
      .withIndex("by_poolId_and_week", (q) =>
        q.eq("poolId", pool._id).eq("week", args.week),
      )
      .unique();

    const allPicks = await ctx.db
      .query("confidencePicks")
      .withIndex("by_poolId_and_week", (q) =>
        q.eq("poolId", pool._id).eq("week", args.week),
      )
      .take(2000);

    const allSets = await ctx.db
      .query("confidencePickSets")
      .withIndex("by_poolId_and_week", (q) =>
        q.eq("poolId", pool._id).eq("week", args.week),
      )
      .take(200);

    const setByParticipant = new Map(
      allSets.map((s) => [s.participantId, s] as const),
    );

    const fingerprint = buildConfidenceWeekFingerprint({
      poolId: pool._id,
      week: args.week,
      picks: allPicks.map((p) => ({
        participantId: p.participantId,
        gameId: p.gameId,
        pickedTeamId: p.pickedTeamId,
        confidenceValue: p.confidenceValue,
        provenance: p.provenance,
        locked: locks.get(p.gameId) ?? p.locked,
      })),
      pickSets: allSets.map((s) => ({
        participantId: s.participantId,
        tiebreakerPrediction: s.tiebreakerPrediction,
      })),
      verifiedGames: games
        .filter((g) => g.resultAuthority === "verified" && g.verifiedResult)
        .map((g) => ({
          gameId: g._id,
          homeScore: g.verifiedResult!.homeScore,
          awayScore: g.verifiedResult!.awayScore,
          status: g.verifiedResult!.status,
        })),
      gameLocks: games.map((g) => ({
        gameId: g._id,
        locked: locks.get(g._id) ?? false,
      })),
    });

    let poolWeek = await ctx.db
      .query("poolWeeks")
      .withIndex("by_poolId_and_week", (q) =>
        q.eq("poolId", pool._id).eq("week", args.week),
      )
      .unique();

    const currentRevisionNumber = poolWeek?.currentRevisionNumber ?? 0;

    if (
      args.basisRevisionNumber !== undefined &&
      currentRevisionNumber > args.basisRevisionNumber
    ) {
      return {
        status: "stale",
        reason: "newer_revision_exists",
        revisionNumber: currentRevisionNumber,
      };
    }

    if (poolWeek?.currentScoringRevisionId) {
      const currentRev = await ctx.db.get(poolWeek.currentScoringRevisionId);
      if (currentRev && currentRev.fingerprint === fingerprint) {
        return {
          status: "noop",
          reason: "identical_fingerprint",
          revisionNumber: currentRevisionNumber,
        };
      }
    }

    const nextRevisionNumber = currentRevisionNumber + 1;

    if (poolWeek) {
      const fresh = await ctx.db.get(poolWeek._id);
      if (
        fresh &&
        (fresh.currentRevisionNumber ?? 0) > currentRevisionNumber
      ) {
        return {
          status: "stale",
          reason: "newer_revision_exists",
          revisionNumber: fresh.currentRevisionNumber ?? 0,
        };
      }
    }

    const weekSettled = weekFullyResolved(
      games.map((g) => ({ resultAuthority: g.resultAuthority ?? "none" })),
    );

    const revisionId = await ctx.db.insert("scoringRevisions", {
      poolId: pool._id,
      week: args.week,
      kind: "confidence",
      revisionNumber: nextRevisionNumber,
      fingerprint,
      publishedAtMs: nowMs,
      status: "published",
    });

    if (poolWeek) {
      await ctx.db.patch(poolWeek._id, {
        settled: weekSettled,
        currentScoringRevisionId: revisionId,
        currentRevisionNumber: nextRevisionNumber,
        updatedAtMs: nowMs,
      });
    } else {
      await ctx.db.insert("poolWeeks", {
        poolId: pool._id,
        week: args.week,
        settled: weekSettled,
        currentScoringRevisionId: revisionId,
        currentRevisionNumber: nextRevisionNumber,
        updatedAtMs: nowMs,
      });
    }

    const tbGame = sheet
      ? (gameById.get(sheet.tiebreakerGameId) ?? null)
      : null;
    const tbActual = tbGame ? tiebreakerActualTotal(toVerifiedInput(tbGame)) : null;
    const tbUsable = tbActual !== null;

    type ParticipantWeek = {
      participantId: Id<"participants">;
      points: number;
      possibleRemaining: number;
      correctPickCount: number;
      tiebreakerPrediction: number | null;
      outcomes: Array<{
        gameId: Id<"nflGames">;
        pickId?: Id<"confidencePicks">;
        outcome: ConfidencePickOutcomeKind;
        pointsEarned: number;
        confidenceValue: number;
      }>;
    };

    const participantWeeks: ParticipantWeek[] = [];

    for (const m of memberships) {
      const picks = allPicks.filter((p) => p.participantId === m.participantId);
      const pickSet = setByParticipant.get(m.participantId);
      const outcomes: ParticipantWeek["outcomes"] = [];
      const remainingRows: Array<{
        pick: {
          gameId: string;
          pickedTeamId?: string;
          confidenceValue: number;
          provenance: "authored" | "automatic" | "omission";
          locked: boolean;
        };
        game: VerifiedGameInput | null;
      }> = [];

      // Prefer Pick Sheet order; fall back to all week games.
      const orderedGameIds = sheet?.gameIds ?? games.map((g) => g._id);
      const picksByGame = new Map(picks.map((p) => [p.gameId, p] as const));

      for (const gameId of orderedGameIds) {
        const game = gameById.get(gameId) ?? null;
        const pick = picksByGame.get(gameId);
        const locked = locks.get(gameId) ?? pick?.locked ?? false;
        const pickInput = pick
          ? {
              gameId: pick.gameId as string,
              pickedTeamId: pick.pickedTeamId as string | undefined,
              confidenceValue: pick.confidenceValue,
              provenance: pick.provenance,
              locked,
            }
          : {
              gameId: gameId as string,
              confidenceValue: 0,
              provenance: "omission" as const,
              locked,
            };

        const gameInput = game ? toVerifiedInput(game) : null;
        const resolved = resolveConfidencePickOutcome({
          pick: pickInput,
          game: gameInput,
        });

        // Skip placeholder zero-value rows when no pick sheet / no pick exists.
        if (!pick && pickInput.confidenceValue === 0) {
          continue;
        }

        outcomes.push({
          gameId,
          pickId: pick?._id,
          outcome: resolved.outcome,
          pointsEarned: resolved.pointsEarned,
          confidenceValue: pickInput.confidenceValue,
        });
        remainingRows.push({ pick: pickInput, game: gameInput });
      }

      participantWeeks.push({
        participantId: m.participantId,
        points: computeWeeklyPoints(outcomes),
        possibleRemaining: computePossibleRemainingPoints(remainingRows),
        correctPickCount: outcomes.filter((o) => o.outcome === "correct")
          .length,
        tiebreakerPrediction: pickSet?.tiebreakerPrediction ?? null,
        outcomes,
      });
    }

    const ranked = rankWeeklyStandings(
      participantWeeks.map((pw) => ({
        participantId: pw.participantId as string,
        points: pw.points,
        tiebreakerPrediction: pw.tiebreakerPrediction,
      })),
      { actualTotal: tbActual, usable: tbUsable },
    );
    const rankById = new Map(
      ranked.map((r) => [r.participantId as Id<"participants">, r.rank]),
    );

    for (const pw of participantWeeks) {
      for (const o of pw.outcomes) {
        await upsertPickOutcome(ctx, {
          poolId: pool._id,
          participantId: pw.participantId,
          week: args.week,
          gameId: o.gameId,
          pickId: o.pickId,
          outcome: o.outcome,
          pointsEarned: o.pointsEarned,
          confidenceValue: o.confidenceValue,
          revisionId,
          nowMs,
        });
      }

      const absError =
        tbUsable &&
        tbActual !== null &&
        pw.tiebreakerPrediction !== null
          ? Math.abs(pw.tiebreakerPrediction - tbActual)
          : undefined;

      await upsertWeeklyStanding(ctx, {
        poolId: pool._id,
        participantId: pw.participantId,
        week: args.week,
        points: pw.points,
        possibleRemainingPoints: pw.possibleRemaining,
        rank: rankById.get(pw.participantId) ?? 1,
        correctPickCount: pw.correctPickCount,
        tiebreakerPrediction: pw.tiebreakerPrediction ?? undefined,
        tiebreakerAbsError: absError,
        tiebreakerUsable: tbUsable,
        revisionId,
        nowMs,
      });
    }

    // Rebuild Season Standing from all fully settled weeks through this week.
    const settledWeekPoints = new Map<Id<"participants">, number>();
    for (const m of memberships) {
      settledWeekPoints.set(m.participantId, 0);
    }

    for (let w = pool.startWeek; w <= CONFIDENCE_FINAL_WEEK; w++) {
      const pw = await ctx.db
        .query("poolWeeks")
        .withIndex("by_poolId_and_week", (q) =>
          q.eq("poolId", pool._id).eq("week", w),
        )
        .unique();
      // Current week uses the just-computed settled flag; earlier weeks use DB.
      const settled =
        w === args.week ? weekSettled : (pw?.settled === true);
      if (!settled) continue;

      if (w === args.week) {
        for (const row of participantWeeks) {
          settledWeekPoints.set(
            row.participantId,
            (settledWeekPoints.get(row.participantId) ?? 0) + row.points,
          );
        }
      } else {
        const weekRows = await ctx.db
          .query("weeklyStandings")
          .withIndex("by_poolId_and_week", (q) =>
            q.eq("poolId", pool._id).eq("week", w),
          )
          .take(200);
        for (const row of weekRows) {
          settledWeekPoints.set(
            row.participantId,
            (settledWeekPoints.get(row.participantId) ?? 0) + row.points,
          );
        }
      }
    }

    const seasonRanked = rankSeasonStandings(
      [...settledWeekPoints.entries()].map(([participantId, seasonPoints]) => ({
        participantId: participantId as string,
        seasonPoints,
      })),
    );
    const seasonRankById = new Map(
      seasonRanked.map((r) => [
        r.participantId as Id<"participants">,
        r,
      ]),
    );

    let poolStatus: "active" | "completed" = pool.status;
    const finalWeekDone =
      weekSettled && args.week === CONFIDENCE_FINAL_WEEK;

    // Also complete when week 18 is already settled and we're republishing.
    let week18Settled = finalWeekDone;
    if (!week18Settled) {
      const w18 = await ctx.db
        .query("poolWeeks")
        .withIndex("by_poolId_and_week", (q) =>
          q.eq("poolId", pool._id).eq("week", CONFIDENCE_FINAL_WEEK),
        )
        .unique();
      week18Settled = w18?.settled === true;
    }

    const topSeasonPoints = seasonRanked[0]?.seasonPoints ?? 0;

    for (const m of memberships) {
      const standing = await ctx.db
        .query("seasonStandings")
        .withIndex("by_poolId_and_participantId", (q) =>
          q.eq("poolId", pool._id).eq("participantId", m.participantId),
        )
        .unique();
      if (!standing) continue;
      const sr = seasonRankById.get(m.participantId);
      const seasonPoints = sr?.seasonPoints ?? 0;
      const seasonRank = sr?.rank ?? 1;
      const isWinner =
        week18Settled && seasonPoints === topSeasonPoints;

      await ctx.db.patch(standing._id, {
        seasonPoints,
        seasonRank,
        eligibility: isWinner ? "winner" : "alive",
        wonAtWeek: isWinner ? CONFIDENCE_FINAL_WEEK : undefined,
        revisionId,
        updatedAtMs: nowMs,
      });
    }

    if (week18Settled && pool.status !== "completed") {
      await ctx.db.patch(pool._id, {
        status: "completed",
        completedAtMs: nowMs,
        completedWeek: CONFIDENCE_FINAL_WEEK,
      });
      poolStatus = "completed";
    }

    return {
      status: "published",
      revisionId,
      revisionNumber: nextRevisionNumber,
      weekSettled,
      poolStatus,
    };
  },
});

/**
 * After a Verified Result, score every Confidence Pool that includes that week.
 */
export const scoreConfidencePoolsForVerifiedGame = internalMutation({
  args: {
    gameId: v.id("nflGames"),
    nowMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const game = await ctx.db.get(args.gameId);
    if (!game) return { scoredPools: 0 };
    if (game.resultAuthority !== "verified") return { scoredPools: 0 };

    const pools = await ctx.db
      .query("pools")
      .withIndex("by_seasonId", (q) => q.eq("seasonId", game.seasonId))
      .take(200);

    let scoredPools = 0;
    for (const pool of pools) {
      if (pool.type !== "confidence") continue;
      if (game.week < pool.startWeek || game.week > CONFIDENCE_FINAL_WEEK) {
        continue;
      }
      await ctx.runMutation(
        internal.confidenceScoring.applyConfidenceScoringRevision,
        {
          poolId: pool._id,
          week: game.week,
          nowMs: args.nowMs,
        },
      );
      scoredPools += 1;
    }
    return { scoredPools };
  },
});

/**
 * Member-facing Confidence Standings — Weekly + Season.
 * Projections from live/provisional scores are labeled official: false.
 * Deny-by-default: non-members receive null. Never exposes Hidden Pick values.
 */
export const getConfidenceStandings = query({
  args: {
    poolId: v.id("pools"),
    week: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let participant;
    try {
      participant = await requireParticipant(ctx);
    } catch (error) {
      if (error instanceof AuthError) return null;
      throw error;
    }

    const pool = await ctx.db.get(args.poolId);
    if (!pool) return null;
    if (pool.type !== "confidence") return null;

    try {
      await requirePoolMembership(ctx, pool._id, participant._id);
    } catch (error) {
      if (error instanceof AuthError) return null;
      throw error;
    }

    const week = args.week ?? pool.startWeek;
    const memberships = (
      await ctx.db
        .query("poolMemberships")
        .withIndex("by_poolId", (q) => q.eq("poolId", pool._id))
        .take(120)
    ).filter((m) => m.status === "active");

    const poolWeek = await ctx.db
      .query("poolWeeks")
      .withIndex("by_poolId_and_week", (q) =>
        q.eq("poolId", pool._id).eq("week", week),
      )
      .unique();

    const weeklyRows = await ctx.db
      .query("weeklyStandings")
      .withIndex("by_poolId_and_week", (q) =>
        q.eq("poolId", pool._id).eq("week", week),
      )
      .take(200);

    const weekly = [];
    for (const m of memberships) {
      const row = weeklyRows.find((r) => r.participantId === m.participantId);
      const person = await ctx.db.get(m.participantId);
      weekly.push({
        participantId: m.participantId,
        displayName: person?.displayName ?? "Participant",
        avatarUrl: person?.avatarUrl ?? null,
        points: row?.points ?? 0,
        possibleRemainingPoints: row?.possibleRemainingPoints ?? 0,
        rank: row?.rank ?? null,
        correctPickCount: row?.correctPickCount ?? 0,
        isViewer: m.participantId === participant._id,
      });
    }
    weekly.sort((a, b) => {
      if (a.rank !== null && b.rank !== null && a.rank !== b.rank) {
        return a.rank - b.rank;
      }
      if (a.points !== b.points) return b.points - a.points;
      return a.displayName.localeCompare(b.displayName);
    });

    const seasonWins = new Map<Id<"participants">, number>();
    const seasonLosses = new Map<Id<"participants">, number>();
    for (const m of memberships) {
      seasonWins.set(m.participantId, 0);
      seasonLosses.set(m.participantId, 0);
    }
    for (let w = pool.startWeek; w <= 18; w++) {
      const weekOutcomes = await ctx.db
        .query("confidencePickOutcomes")
        .withIndex("by_poolId_and_week", (q) =>
          q.eq("poolId", pool._id).eq("week", w),
        )
        .take(4096);
      for (const outcome of weekOutcomes) {
        if (outcome.outcome === "correct") {
          seasonWins.set(
            outcome.participantId,
            (seasonWins.get(outcome.participantId) ?? 0) + 1,
          );
        } else if (
          outcome.outcome === "incorrect" ||
          outcome.outcome === "omission_zero"
        ) {
          seasonLosses.set(
            outcome.participantId,
            (seasonLosses.get(outcome.participantId) ?? 0) + 1,
          );
        }
      }
    }

    const season = [];
    for (const m of memberships) {
      const standing = await ctx.db
        .query("seasonStandings")
        .withIndex("by_poolId_and_participantId", (q) =>
          q.eq("poolId", pool._id).eq("participantId", m.participantId),
        )
        .unique();
      const person = await ctx.db.get(m.participantId);
      season.push({
        participantId: m.participantId,
        displayName: person?.displayName ?? "Participant",
        avatarUrl: person?.avatarUrl ?? null,
        seasonPoints: standing?.seasonPoints ?? 0,
        seasonRank: standing?.seasonRank ?? null,
        eligibility: standing?.eligibility ?? ("alive" as const),
        wins: seasonWins.get(m.participantId) ?? 0,
        losses: seasonLosses.get(m.participantId) ?? 0,
        isViewer: m.participantId === participant._id,
      });
    }
    season.sort((a, b) => {
      if (
        a.seasonRank !== null &&
        b.seasonRank !== null &&
        a.seasonRank !== b.seasonRank
      ) {
        return a.seasonRank - b.seasonRank;
      }
      if (a.seasonPoints !== b.seasonPoints) {
        return b.seasonPoints - a.seasonPoints;
      }
      return a.displayName.localeCompare(b.displayName);
    });

    // Labeled non-official projection from live/provisional scores (never Hidden).
    const games = await loadWeekGames(ctx, pool.seasonId, week);
    const hasLiveProjection = games.some(
      (g) =>
        g.resultAuthority === "projected" ||
        g.resultAuthority === "confirmation_pending",
    );

    return {
      poolId: pool._id,
      poolName: pool.name,
      poolStatus: pool.status,
      startWeek: pool.startWeek,
      week,
      weekSettled: poolWeek?.settled ?? false,
      weekly: {
        official: true as const,
        rows: weekly,
      },
      projectedWeekly: hasLiveProjection
        ? {
            official: false as const,
            label: "Projected — not official",
            note: "Live and provisionally final scores do not change official Weekly Standings.",
          }
        : null,
      season: {
        official: true as const,
        rows: season,
      },
    };
  },
});

/**
 * Compact standings peek for desktop context rail — top 5 + current user.
 * Never includes Hidden Pick values or operator chrome.
 */
export const getConfidenceStandingsPeek = query({
  args: {
    poolId: v.id("pools"),
    week: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let participant;
    try {
      participant = await requireParticipant(ctx);
    } catch (error) {
      if (error instanceof AuthError) return null;
      throw error;
    }

    const pool = await ctx.db.get(args.poolId);
    if (!pool || pool.type !== "confidence") return null;

    try {
      await requirePoolMembership(ctx, pool._id, participant._id);
    } catch (error) {
      if (error instanceof AuthError) return null;
      throw error;
    }

    const week = args.week ?? pool.startWeek;
    const weeklyRows = await ctx.db
      .query("weeklyStandings")
      .withIndex("by_poolId_and_week", (q) =>
        q.eq("poolId", pool._id).eq("week", week),
      )
      .take(200);

    const memberships = (
      await ctx.db
        .query("poolMemberships")
        .withIndex("by_poolId", (q) => q.eq("poolId", pool._id))
        .take(120)
    ).filter((m) => m.status === "active");

    const rows = [];
    for (const m of memberships) {
      const row = weeklyRows.find((r) => r.participantId === m.participantId);
      const person = await ctx.db.get(m.participantId);
      rows.push({
        participantId: m.participantId,
        displayName: person?.displayName ?? "Participant",
        avatarUrl: person?.avatarUrl ?? null,
        points: row?.points ?? 0,
        rank: row?.rank ?? null,
        isViewer: m.participantId === participant._id,
      });
    }
    rows.sort((a, b) => {
      if (a.rank !== null && b.rank !== null && a.rank !== b.rank) {
        return a.rank - b.rank;
      }
      if (a.points !== b.points) return b.points - a.points;
      return a.displayName.localeCompare(b.displayName);
    });

    const top5 = rows.slice(0, 5);
    const viewer = rows.find((r) => r.isViewer) ?? null;
    const viewerInTop = viewer
      ? top5.some((r) => r.participantId === viewer.participantId)
      : true;

    return {
      week,
      top5,
      viewer: viewerInTop ? null : viewer,
      standingsPath: `/pools/${pool._id}/standings`,
    };
  },
});
