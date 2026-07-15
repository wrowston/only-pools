/**
 * Survivor Scoring Revisions — atomic week publish from Verified Results.
 * Ticket 08: win-only advance, permanent elimination, winners, idempotency.
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
  isSurvivorPickLocked,
} from "./lib/pickLock";
import {
  SURVIVOR_FINAL_WEEK,
  buildSurvivorWeekFingerprint,
  decideSurvivorTerminalOutcome,
  eliminationReasonFromOutcome,
  resolveSurvivorPickOutcome,
  type SurvivorEligibility,
  type SurvivorPickOutcomeKind,
} from "./lib/survivorScoring";

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

function weekFullyLocked(
  pool: Doc<"pools">,
  games: Doc<"nflGames">[],
  nowMs: number,
): boolean {
  if (games.length === 0) return false;
  const earliestKickoff = Math.min(...games.map((g) => g.scheduledKickoffMs));
  const weeklyCutoffMs =
    pool.pickLockMode === "weeklyCutoff"
      ? computeWeeklyCutoffMs(earliestKickoff)
      : null;
  return games.every((g) =>
    isSurvivorPickLocked({
      pickLockMode: pool.pickLockMode,
      game: g,
      weeklyCutoffMs,
      nowMs,
    }),
  );
}

async function loadOrInitStanding(
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
    pickId?: Id<"survivorPicks">;
    outcome: SurvivorPickOutcomeKind;
    revisionId: Id<"scoringRevisions">;
    nowMs: number;
  },
) {
  const existing = await ctx.db
    .query("survivorPickOutcomes")
    .withIndex("by_poolId_and_participantId_and_week", (q) =>
      q
        .eq("poolId", args.poolId)
        .eq("participantId", args.participantId)
        .eq("week", args.week),
    )
    .unique();
  if (existing) {
    await ctx.db.patch(existing._id, {
      pickId: args.pickId,
      outcome: args.outcome,
      revisionId: args.revisionId,
      updatedAtMs: args.nowMs,
    });
  } else {
    await ctx.db.insert("survivorPickOutcomes", {
      poolId: args.poolId,
      participantId: args.participantId,
      week: args.week,
      pickId: args.pickId,
      outcome: args.outcome,
      revisionId: args.revisionId,
      updatedAtMs: args.nowMs,
    });
  }
}

async function invalidateLaterProvisionals(
  ctx: MutationCtx,
  args: {
    poolId: Id<"pools">;
    participantId: Id<"participants">;
    afterWeek: number;
    nowMs: number;
  },
) {
  const picks = await ctx.db
    .query("survivorPicks")
    .withIndex("by_poolId_and_participantId", (q) =>
      q.eq("poolId", args.poolId).eq("participantId", args.participantId),
    )
    .take(32);

  for (const pick of picks) {
    if (pick.week <= args.afterWeek) continue;
    if (pick.invalidated) continue;
    await ctx.db.patch(pick._id, {
      invalidated: true,
      invalidatedAtMs: args.nowMs,
      updatedAtMs: args.nowMs,
    });
    if (pick.nflTeamId) {
      const reservations = await ctx.db
        .query("survivorTeamReservations")
        .withIndex("by_poolId_and_participantId_and_nflTeamId", (q) =>
          q
            .eq("poolId", args.poolId)
            .eq("participantId", args.participantId)
            .eq("nflTeamId", pick.nflTeamId!),
        )
        .take(8);
      for (const res of reservations) {
        if (res.week === pick.week && !res.released) {
          await ctx.db.patch(res._id, {
            released: true,
            updatedAtMs: args.nowMs,
          });
        }
      }
    }
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
 * Atomically publish a Survivor Scoring Revision for one Pool Week.
 * Replays eligibility in Pool Week order from Start Week through `week`.
 */
export const applySurvivorScoringRevision = internalMutation({
  args: {
    poolId: v.id("pools"),
    week: v.number(),
    /** When set, refuse if a newer revision already exists (stale attempt). */
    basisRevisionNumber: v.optional(v.number()),
    nowMs: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<PublishResult> => {
    const pool = await ctx.db.get(args.poolId);
    if (!pool) {
      throw new Error("Pool not found");
    }
    if (pool.type !== "survivor") {
      throw new Error("Survivor scoring only applies to Survivor Pools");
    }
    if (args.week < pool.startWeek || args.week > SURVIVOR_FINAL_WEEK) {
      throw new Error("Week is outside this Pool's included weeks");
    }

    const nowMs = args.nowMs ?? Date.now();
    const memberships = (
      await ctx.db
        .query("poolMemberships")
        .withIndex("by_poolId", (q) => q.eq("poolId", pool._id))
        .take(120)
    ).filter((m) => m.status === "active");

    // Ensure standing rows exist.
    const standingsByParticipant = new Map<
      Id<"participants">,
      Doc<"seasonStandings">
    >();
    for (const m of memberships) {
      const row = await loadOrInitStanding(
        ctx,
        pool._id,
        m.participantId,
        nowMs,
      );
      standingsByParticipant.set(m.participantId, row);
    }

    // Replay eligibility from startWeek through target week (order matters).
    type ReplayState = {
      eligibility: SurvivorEligibility;
      eliminatedWeek?: number;
      eliminationReason?: "loss" | "tie" | "missing_pick";
    };
    const state = new Map<Id<"participants">, ReplayState>();
    for (const m of memberships) {
      state.set(m.participantId, { eligibility: "alive" });
    }

    let targetWeekSettled = false;
    let targetFingerprint = "";
    const targetOutcomes = new Map<
      Id<"participants">,
      {
        outcome: SurvivorPickOutcomeKind;
        pickId?: Id<"survivorPicks">;
        enteredAlive: boolean;
      }
    >();
    const enteredAliveAtTarget: Id<"participants">[] = [];

    for (let w = pool.startWeek; w <= args.week; w++) {
      const games = await loadWeekGames(ctx, pool.seasonId, w);
      const locked = weekFullyLocked(pool, games, nowMs);
      const picks = await ctx.db
        .query("survivorPicks")
        .withIndex("by_poolId_and_week", (q) =>
          q.eq("poolId", pool._id).eq("week", w),
        )
        .take(200);
      const pickByParticipant = new Map(
        picks.map((p) => [p.participantId, p] as const),
      );

      const priorEligibility = [...state.entries()].map(
        ([participantId, s]) => ({
          participantId: participantId as string,
          eligibility: s.eligibility,
        }),
      );

      const enteredAlive: Id<"participants">[] = [];
      for (const m of memberships) {
        const s = state.get(m.participantId)!;
        if (s.eligibility === "alive") {
          enteredAlive.push(m.participantId);
        }
      }

      const weekOutcomes: Array<{
        participantId: Id<"participants">;
        outcome: SurvivorPickOutcomeKind;
        pickId?: Id<"survivorPicks">;
        enteredAlive: boolean;
      }> = [];

      for (const m of memberships) {
        const s = state.get(m.participantId)!;
        const entered = s.eligibility === "alive";
        const pick = pickByParticipant.get(m.participantId) ?? null;

        if (!entered) {
          weekOutcomes.push({
            participantId: m.participantId,
            outcome: pick?.invalidated ? "invalidated" : "pending",
            pickId: pick?._id,
            enteredAlive: false,
          });
          continue;
        }

        const game =
          pick?.gameId !== undefined
            ? (games.find((g) => g._id === pick.gameId) ?? null)
            : null;

        const outcome = resolveSurvivorPickOutcome({
          pick: pick
            ? {
                pickId: pick._id,
                participantId: pick.participantId,
                week: pick.week,
                nflTeamId: pick.nflTeamId,
                gameId: pick.gameId,
                provenance: pick.provenance,
                provisional: pick.provisional,
                invalidated: pick.invalidated,
              }
            : null,
          game: game
            ? {
                gameId: game._id,
                homeTeamId: game.homeTeamId,
                awayTeamId: game.awayTeamId,
                resultAuthority: game.resultAuthority ?? "none",
                homeScore:
                  game.verifiedResult?.homeScore ?? game.homeScore,
                awayScore:
                  game.verifiedResult?.awayScore ?? game.awayScore,
                verifiedStatus: game.verifiedResult?.status ?? null,
              }
            : null,
          weekFullyLocked: locked,
        });

        weekOutcomes.push({
          participantId: m.participantId,
          outcome,
          pickId: pick?._id,
          enteredAlive: true,
        });

        if (outcome === "pending") {
          continue;
        }

        const reason = eliminationReasonFromOutcome(outcome);
        if (reason) {
          s.eligibility = "eliminated";
          s.eliminatedWeek = w;
          s.eliminationReason = reason;
        }
      }

      const fingerprint = buildSurvivorWeekFingerprint({
        poolId: pool._id,
        week: w,
        priorEligibility,
        picks: picks.map((p) => ({
          participantId: p.participantId,
          nflTeamId: p.nflTeamId,
          gameId: p.gameId,
          provenance: p.provenance,
          invalidated: p.invalidated,
        })),
        verifiedGames: games
          .filter((g) => g.resultAuthority === "verified" && g.verifiedResult)
          .map((g) => ({
            gameId: g._id,
            homeScore: g.verifiedResult!.homeScore,
            awayScore: g.verifiedResult!.awayScore,
            status: g.verifiedResult!.status,
          })),
        weekFullyLocked: locked,
      });

      if (w === args.week) {
        targetFingerprint = fingerprint;
        // Settled when every Alive entrant has a non-pending outcome.
        targetWeekSettled =
          enteredAlive.length === 0 ||
          weekOutcomes
            .filter((o) => o.enteredAlive)
            .every((o) => o.outcome !== "pending");
        for (const o of weekOutcomes) {
          targetOutcomes.set(o.participantId, o);
        }
        enteredAliveAtTarget.push(...enteredAlive);
      }
    }

    // Load current pool week revision pointer.
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
      if (currentRev && currentRev.fingerprint === targetFingerprint) {
        return {
          status: "noop",
          reason: "identical_fingerprint",
          revisionNumber: currentRevisionNumber,
        };
      }
    }

    const nextRevisionNumber = currentRevisionNumber + 1;

    // Stale guard: re-check pointer before write.
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

    const revisionId = await ctx.db.insert("scoringRevisions", {
      poolId: pool._id,
      week: args.week,
      kind: "survivor",
      revisionNumber: nextRevisionNumber,
      fingerprint: targetFingerprint,
      publishedAtMs: nowMs,
      status: "published",
    });

    if (poolWeek) {
      await ctx.db.patch(poolWeek._id, {
        settled: targetWeekSettled,
        currentScoringRevisionId: revisionId,
        currentRevisionNumber: nextRevisionNumber,
        updatedAtMs: nowMs,
      });
    } else {
      await ctx.db.insert("poolWeeks", {
        poolId: pool._id,
        week: args.week,
        settled: targetWeekSettled,
        currentScoringRevisionId: revisionId,
        currentRevisionNumber: nextRevisionNumber,
        updatedAtMs: nowMs,
      });
    }

    // Publish pick outcomes for the target week.
    for (const m of memberships) {
      const o = targetOutcomes.get(m.participantId);
      await upsertPickOutcome(ctx, {
        poolId: pool._id,
        participantId: m.participantId,
        week: args.week,
        pickId: o?.pickId,
        outcome: o?.outcome ?? "pending",
        revisionId,
        nowMs,
      });
    }

    // Apply eligibility from full replay (state map holds final after target week).
    for (const m of memberships) {
      const s = state.get(m.participantId)!;
      const standing = standingsByParticipant.get(m.participantId)!;
      // Don't downgrade winners here; terminal designation below may promote.
      if (standing.eligibility === "winner" && pool.status === "completed") {
        continue;
      }
      await ctx.db.patch(standing._id, {
        eligibility: s.eligibility === "eliminated" ? "eliminated" : "alive",
        eliminatedWeek: s.eliminatedWeek,
        eliminationReason: s.eliminationReason,
        wonAtWeek: undefined,
        revisionId,
        updatedAtMs: nowMs,
      });
      if (s.eligibility === "eliminated" && s.eliminatedWeek !== undefined) {
        await invalidateLaterProvisionals(ctx, {
          poolId: pool._id,
          participantId: m.participantId,
          afterWeek: s.eliminatedWeek,
          nowMs,
        });
      }
    }

    // Terminal winners — only from settled verified weeks.
    let poolStatus: "active" | "completed" = pool.status;
    if (targetWeekSettled) {
      const afterWeek = memberships.map((m) => {
        const s = state.get(m.participantId)!;
        return {
          participantId: m.participantId as string,
          eligibility:
            s.eligibility === "eliminated"
              ? ("eliminated" as const)
              : ("alive" as const),
        };
      });
      const terminal = decideSurvivorTerminalOutcome({
        week: args.week,
        finalWeek: SURVIVOR_FINAL_WEEK,
        weekSettled: true,
        enteredAliveIds: enteredAliveAtTarget.map((id) => id as string),
        afterWeek,
      });

      if (terminal.kind === "sole_winner") {
        const winnerId = terminal.winnerParticipantId as Id<"participants">;
        for (const m of memberships) {
          const standing = standingsByParticipant.get(m.participantId)!;
          if (m.participantId === winnerId) {
            await ctx.db.patch(standing._id, {
              eligibility: "winner",
              wonAtWeek: args.week,
              revisionId,
              updatedAtMs: nowMs,
            });
          }
        }
        await ctx.db.patch(pool._id, {
          status: "completed",
          completedAtMs: nowMs,
          completedWeek: args.week,
        });
        poolStatus = "completed";
      } else if (terminal.kind === "joint_winners") {
        const winnerSet = new Set(terminal.winnerParticipantIds);
        for (const m of memberships) {
          if (!winnerSet.has(m.participantId)) continue;
          const standing = standingsByParticipant.get(m.participantId)!;
          await ctx.db.patch(standing._id, {
            eligibility: "winner",
            wonAtWeek: args.week,
            // Keep elimination reason/week when joint-from-elimination cohort.
            revisionId,
            updatedAtMs: nowMs,
          });
        }
        await ctx.db.patch(pool._id, {
          status: "completed",
          completedAtMs: nowMs,
          completedWeek: args.week,
        });
        poolStatus = "completed";
      }
    }

    return {
      status: "published",
      revisionId,
      revisionNumber: nextRevisionNumber,
      weekSettled: targetWeekSettled,
      poolStatus,
    };
  },
});

/**
 * After a Verified Result, score every Survivor Pool that includes that week.
 */
export const scoreSurvivorPoolsForVerifiedGame = internalMutation({
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
      if (pool.type !== "survivor") continue;
      if (pool.status === "completed") continue;
      if (game.week < pool.startWeek || game.week > SURVIVOR_FINAL_WEEK) {
        continue;
      }
      // Replay from the verified week through later weeks so provisional
      // invalidation and terminal outcomes cascade.
      for (let w = game.week; w <= SURVIVOR_FINAL_WEEK; w++) {
        const weekGames = await loadWeekGames(ctx, pool.seasonId, w);
        if (weekGames.length === 0 && w > game.week) break;
        const result = await ctx.runMutation(
          internal.survivorScoring.applySurvivorScoringRevision,
          {
            poolId: pool._id,
            week: w,
            nowMs: args.nowMs,
          },
        );
        if (result.status === "published" && result.poolStatus === "completed") {
          break;
        }
      }
      scoredPools += 1;
    }
    return { scoredPools };
  },
});

/**
 * Member-facing Survivor Standings — Alive / Eliminated / Winner with week context.
 * Deny-by-default: non-members receive null.
 */
export const getSurvivorStandings = query({
  args: {
    poolId: v.id("pools"),
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
    if (pool.type !== "survivor") return null;

    try {
      await requirePoolMembership(ctx, pool._id, participant._id);
    } catch (error) {
      if (error instanceof AuthError) return null;
      throw error;
    }

    const memberships = (
      await ctx.db
        .query("poolMemberships")
        .withIndex("by_poolId", (q) => q.eq("poolId", pool._id))
        .take(120)
    ).filter((m) => m.status === "active");

    const rows = [];
    for (const m of memberships) {
      const standing = await ctx.db
        .query("seasonStandings")
        .withIndex("by_poolId_and_participantId", (q) =>
          q.eq("poolId", pool._id).eq("participantId", m.participantId),
        )
        .unique();
      const person = await ctx.db.get(m.participantId);
      rows.push({
        participantId: m.participantId,
        displayName: person?.displayName ?? "Participant",
        eligibility: standing?.eligibility ?? ("alive" as const),
        eliminatedWeek: standing?.eliminatedWeek ?? null,
        eliminationReason: standing?.eliminationReason ?? null,
        wonAtWeek: standing?.wonAtWeek ?? null,
        isViewer: m.participantId === participant._id,
      });
    }

    rows.sort((a, b) => {
      const rank = (e: string) =>
        e === "alive" || e === "winner" ? 0 : 1;
      const d = rank(a.eligibility) - rank(b.eligibility);
      if (d !== 0) return d;
      return a.displayName.localeCompare(b.displayName);
    });

    return {
      poolId: pool._id,
      poolName: pool.name,
      poolStatus: pool.status,
      completedWeek: pool.completedWeek ?? null,
      startWeek: pool.startWeek,
      rows,
    };
  },
});
