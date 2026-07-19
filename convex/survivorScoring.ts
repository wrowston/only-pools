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
  ensurePrimaryEntryIfMissing,
  entryDisplayName,
  listActivePoolEntries,
} from "./lib/poolEntries";
import { MAX_POOL_ENTRIES } from "./lib/quotas";
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
  entryId: Id<"poolEntries">,
  nowMs: number,
): Promise<Doc<"seasonStandings">> {
  const existing = await ctx.db
    .query("seasonStandings")
    .withIndex("by_poolId_and_entryId", (q) =>
      q.eq("poolId", poolId).eq("entryId", entryId),
    )
    .unique();
  if (existing) return existing;
  const id = await ctx.db.insert("seasonStandings", {
    poolId,
    participantId,
    entryId,
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
    entryId: Id<"poolEntries">;
    week: number;
    pickId?: Id<"survivorPicks">;
    outcome: SurvivorPickOutcomeKind;
    revisionId: Id<"scoringRevisions">;
    nowMs: number;
  },
) {
  const existing = await ctx.db
    .query("survivorPickOutcomes")
    .withIndex("by_poolId_and_entryId_and_week", (q) =>
      q
        .eq("poolId", args.poolId)
        .eq("entryId", args.entryId)
        .eq("week", args.week),
    )
    .unique();
  if (existing) {
    await ctx.db.patch(existing._id, {
      pickId: args.pickId,
      outcome: args.outcome,
      revisionId: args.revisionId,
      updatedAtMs: args.nowMs,
      entryId: args.entryId,
    });
  } else {
    await ctx.db.insert("survivorPickOutcomes", {
      poolId: args.poolId,
      participantId: args.participantId,
      entryId: args.entryId,
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
    entryId: Id<"poolEntries">;
    afterWeek: number;
    nowMs: number;
  },
) {
  const picks = await ctx.db
    .query("survivorPicks")
    .withIndex("by_entryId", (q) => q.eq("entryId", args.entryId))
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
        .withIndex("by_poolId_and_entryId_and_nflTeamId", (q) =>
          q
            .eq("poolId", args.poolId)
            .eq("entryId", args.entryId)
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

/**
 * Corrected Result restoring eligibility also reinstates later Provisional
 * Survivor Picks accepted before their own lock (team re-reserved).
 */
async function reinstateProvisionalIfNeeded(
  ctx: MutationCtx,
  pick: Doc<"survivorPicks">,
  nowMs: number,
): Promise<Doc<"survivorPicks">> {
  if (!pick.invalidated) return pick;
  await ctx.db.patch(pick._id, {
    invalidated: undefined,
    invalidatedAtMs: undefined,
    updatedAtMs: nowMs,
  });
  if (pick.nflTeamId && pick.entryId !== undefined) {
    const reservations = await ctx.db
      .query("survivorTeamReservations")
      .withIndex("by_poolId_and_entryId_and_nflTeamId", (q) =>
        q
          .eq("poolId", pick.poolId)
          .eq("entryId", pick.entryId)
          .eq("nflTeamId", pick.nflTeamId!),
      )
      .take(8);
    let reserved = false;
    for (const res of reservations) {
      if (res.week === pick.week) {
        await ctx.db.patch(res._id, {
          released: false,
          updatedAtMs: nowMs,
        });
        reserved = true;
      }
    }
    if (!reserved) {
      await ctx.db.insert("survivorTeamReservations", {
        poolId: pick.poolId,
        participantId: pick.participantId,
        entryId: pick.entryId,
        nflTeamId: pick.nflTeamId,
        week: pick.week,
        released: false,
        updatedAtMs: nowMs,
      });
    }
  }
  const refreshed = await ctx.db.get(pick._id);
  return refreshed ?? pick;
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
        .take(MAX_POOL_ENTRIES)
    ).filter((m) => m.status === "active");

    for (const m of memberships) {
      await ensurePrimaryEntryIfMissing(ctx, {
        poolId: pool._id,
        participantId: m.participantId,
        membershipId: m._id,
        nowMs,
      });
    }

    const entries = await listActivePoolEntries(ctx, pool._id);

    // Ensure standing rows exist (one per competitive entry).
    const standingsByEntry = new Map<
      Id<"poolEntries">,
      Doc<"seasonStandings">
    >();
    for (const entry of entries) {
      const row = await loadOrInitStanding(
        ctx,
        pool._id,
        entry.participantId,
        entry._id,
        nowMs,
      );
      standingsByEntry.set(entry._id, row);
    }

    // Replay eligibility from startWeek through target week (order matters).
    type ReplayState = {
      eligibility: SurvivorEligibility;
      eliminatedWeek?: number;
      eliminationReason?: "loss" | "tie" | "missing_pick";
    };
    const state = new Map<Id<"poolEntries">, ReplayState>();
    for (const entry of entries) {
      state.set(entry._id, { eligibility: "alive" });
    }

    let targetWeekSettled = false;
    let targetFingerprint = "";
    const targetOutcomes = new Map<
      Id<"poolEntries">,
      {
        outcome: SurvivorPickOutcomeKind;
        pickId?: Id<"survivorPicks">;
        enteredAlive: boolean;
      }
    >();
    const enteredAliveAtTarget: Id<"poolEntries">[] = [];

    for (let w = pool.startWeek; w <= args.week; w++) {
      const games = await loadWeekGames(ctx, pool.seasonId, w);
      const locked = weekFullyLocked(pool, games, nowMs);
      const picks = await ctx.db
        .query("survivorPicks")
        .withIndex("by_poolId_and_week", (q) =>
          q.eq("poolId", pool._id).eq("week", w),
        )
        .take(MAX_POOL_ENTRIES);
      const pickByEntry = new Map<Id<"poolEntries">, Doc<"survivorPicks">>();
      for (const p of picks) {
        if (p.entryId !== undefined) {
          pickByEntry.set(p.entryId, p);
        }
      }

      const priorEligibility = [...state.entries()].map(([entryId, s]) => ({
        // Fingerprint field name is participantId; value is competitive entry id.
        participantId: entryId as string,
        eligibility: s.eligibility,
      }));

      const enteredAlive: Id<"poolEntries">[] = [];
      for (const entry of entries) {
        const s = state.get(entry._id)!;
        if (s.eligibility === "alive") {
          enteredAlive.push(entry._id);
        }
      }

      const weekOutcomes: Array<{
        entryId: Id<"poolEntries">;
        outcome: SurvivorPickOutcomeKind;
        pickId?: Id<"survivorPicks">;
        enteredAlive: boolean;
      }> = [];

      for (const entry of entries) {
        const s = state.get(entry._id)!;
        const entered = s.eligibility === "alive";
        let pick = pickByEntry.get(entry._id) ?? null;

        if (!entered) {
          weekOutcomes.push({
            entryId: entry._id,
            outcome: pick?.invalidated ? "invalidated" : "pending",
            pickId: pick?._id,
            enteredAlive: false,
          });
          continue;
        }

        // Correction restoring eligibility reinstates later provisionals.
        if (pick?.invalidated) {
          pick = await reinstateProvisionalIfNeeded(ctx, pick, nowMs);
          pickByEntry.set(entry._id, pick);
        }

        const game =
          pick?.gameId !== undefined
            ? (games.find((g) => g._id === pick.gameId) ?? null)
            : null;

        const outcome = resolveSurvivorPickOutcome({
          pick: pick
            ? {
                pickId: pick._id,
                participantId: entry._id,
                week: pick.week,
                nflTeamId: pick.nflTeamId,
                gameId: pick.gameId,
                provenance: pick.provenance,
                provisional: pick.provisional,
                invalidated: pick.invalidated,
                locked: pick.locked,
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
          entryId: entry._id,
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
          participantId: (p.entryId ?? p.participantId) as string,
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
          targetOutcomes.set(o.entryId, o);
        }
        enteredAliveAtTarget.push(...enteredAlive);
      }
    }

    // Load current pool week revision pointer.
    const poolWeek = await ctx.db
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
    for (const entry of entries) {
      const o = targetOutcomes.get(entry._id);
      await upsertPickOutcome(ctx, {
        poolId: pool._id,
        participantId: entry.participantId,
        entryId: entry._id,
        week: args.week,
        pickId: o?.pickId,
        outcome: o?.outcome ?? "pending",
        revisionId,
        nowMs,
      });
    }

    // Apply eligibility from full replay (state map holds final after target week).
    // Corrections may restore Alive / clear winners — always rewrite from replay.
    for (const entry of entries) {
      const s = state.get(entry._id)!;
      const standing = standingsByEntry.get(entry._id)!;
      await ctx.db.patch(standing._id, {
        eligibility: s.eligibility === "eliminated" ? "eliminated" : "alive",
        eliminatedWeek: s.eliminatedWeek,
        eliminationReason: s.eliminationReason,
        wonAtWeek: undefined,
        entryId: entry._id,
        revisionId,
        updatedAtMs: nowMs,
      });
      if (s.eligibility === "eliminated" && s.eliminatedWeek !== undefined) {
        await invalidateLaterProvisionals(ctx, {
          poolId: pool._id,
          participantId: entry.participantId,
          entryId: entry._id,
          afterWeek: s.eliminatedWeek,
          nowMs,
        });
      }
    }

    // Terminal winners — only from settled verified weeks.
    // Competitive ids in terminal helpers are entry ids (stable string keys).
    let poolStatus: "active" | "completed" = pool.status;
    if (targetWeekSettled) {
      const afterWeek = entries.map((entry) => {
        const s = state.get(entry._id)!;
        return {
          participantId: entry._id as string,
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
        const winnerEntryId = terminal.winnerParticipantId as Id<"poolEntries">;
        for (const entry of entries) {
          const standing = standingsByEntry.get(entry._id)!;
          if (entry._id === winnerEntryId) {
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
        for (const entry of entries) {
          if (!winnerSet.has(entry._id)) continue;
          const standing = standingsByEntry.get(entry._id)!;
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
      } else if (pool.status === "completed") {
        // Terminal condition no longer holds after correction — reopen Active.
        await ctx.db.patch(pool._id, {
          status: "active",
          completedAtMs: undefined,
          completedWeek: undefined,
        });
        poolStatus = "active";
      }
    } else if (pool.status === "completed") {
      // Week unsettled after correction (e.g. Pending) — reopen Active.
      await ctx.db.patch(pool._id, {
        status: "active",
        completedAtMs: undefined,
        completedWeek: undefined,
      });
      poolStatus = "active";
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
 * Pre-lock verified cancellation: invalidate Survivor picks and release teams
 * so participants can replace before the remaining lock window closes.
 * Post-lock picks are left intact for No-Contest Advance scoring.
 */
export const handleVerifiedCancellation = internalMutation({
  args: {
    gameId: v.id("nflGames"),
    nowMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const game = await ctx.db.get(args.gameId);
    if (!game) return { invalidated: 0 };
    if (game.resultAuthority !== "verified") return { invalidated: 0 };
    if (game.verifiedResult?.status !== "CANC") return { invalidated: 0 };

    const nowMs = args.nowMs ?? Date.now();
    const pools = await ctx.db
      .query("pools")
      .withIndex("by_seasonId", (q) => q.eq("seasonId", game.seasonId))
      .take(200);

    let invalidated = 0;
    for (const pool of pools) {
      if (pool.type !== "survivor") continue;
      const picks = await ctx.db
        .query("survivorPicks")
        .withIndex("by_poolId_and_week", (q) =>
          q.eq("poolId", pool._id).eq("week", game.week),
        )
        .take(MAX_POOL_ENTRIES);

      for (const pick of picks) {
        if (pick.gameId !== game._id) continue;
        if (pick.invalidated) continue;
        if (pick.locked) continue; // No-Contest Advance path

        await ctx.db.patch(pick._id, {
          invalidated: true,
          invalidatedAtMs: nowMs,
          updatedAtMs: nowMs,
        });
        if (pick.nflTeamId && pick.entryId !== undefined) {
          const reservations = await ctx.db
            .query("survivorTeamReservations")
            .withIndex("by_poolId_and_entryId_and_nflTeamId", (q) =>
              q
                .eq("poolId", pool._id)
                .eq("entryId", pick.entryId)
                .eq("nflTeamId", pick.nflTeamId!),
            )
            .take(8);
          for (const res of reservations) {
            if (res.week === pick.week && !res.released) {
              await ctx.db.patch(res._id, {
                released: true,
                updatedAtMs: nowMs,
              });
            }
          }
        }
        invalidated += 1;
      }
    }
    return { invalidated };
  },
});

/**
 * After a Verified / Corrected Result, score every Survivor Pool that includes
 * that week — including Completed Pools so corrections can reopen Active.
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
      if (game.week < pool.startWeek || game.week > SURVIVOR_FINAL_WEEK) {
        continue;
      }
      // Replay from the verified week through later weeks so provisional
      // invalidation, corrections, and terminal outcomes cascade.
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

    const entries = await listActivePoolEntries(ctx, pool._id);

    const rows = [];
    for (const entry of entries) {
      const standing = await ctx.db
        .query("seasonStandings")
        .withIndex("by_poolId_and_entryId", (q) =>
          q.eq("poolId", pool._id).eq("entryId", entry._id),
        )
        .unique();
      const person = await ctx.db.get(entry.participantId);
      rows.push({
        participantId: entry.participantId,
        entryId: entry._id,
        displayName: entryDisplayName(
          person?.displayName ?? "Participant",
          entry.entryNumber,
        ),
        avatarUrl: person?.avatarUrl ?? null,
        eligibility: standing?.eligibility ?? ("alive" as const),
        eliminatedWeek: standing?.eliminatedWeek ?? null,
        eliminationReason: standing?.eliminationReason ?? null,
        wonAtWeek: standing?.wonAtWeek ?? null,
        isViewer: entry.participantId === participant._id,
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

export type SurvivorStandingsGridCell = {
  week: number;
  /** Team identity visible: locked for anyone, or always for the viewer. */
  revealed: boolean;
  hasPick: boolean;
  locked: boolean;
  teamAbbreviation: string | null;
  teamName: string | null;
  teamLogoUrl: string | null;
  provenance: "authored" | "omission" | null;
  outcome:
    | "win"
    | "loss"
    | "tie"
    | "missing_pick"
    | "pending"
    | "invalidated"
    | "no_contest_advance"
    | null;
};

/**
 * Member-facing Survivor standings with week-by-week pick cells.
 * Preserves Hidden Pick rules: unlocked opponent team identity is omitted.
 */
export const getSurvivorStandingsGrid = query({
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

    const entries = await listActivePoolEntries(ctx, pool._id);

    const pickByEntryWeek = new Map<string, Doc<"survivorPicks">>();
    const outcomeByEntryWeek = new Map<string, Doc<"survivorPickOutcomes">>();
    let maxActivityWeek = pool.startWeek;

    for (let week = pool.startWeek; week <= SURVIVOR_FINAL_WEEK; week++) {
      const weekPicks = await ctx.db
        .query("survivorPicks")
        .withIndex("by_poolId_and_week", (q) =>
          q.eq("poolId", pool._id).eq("week", week),
        )
        .take(MAX_POOL_ENTRIES);
      for (const pick of weekPicks) {
        if (pick.entryId === undefined) continue;
        pickByEntryWeek.set(`${pick.entryId}:${week}`, pick);
        if (week > maxActivityWeek) maxActivityWeek = week;
      }

      const weekOutcomes = await ctx.db
        .query("survivorPickOutcomes")
        .withIndex("by_poolId_and_week", (q) =>
          q.eq("poolId", pool._id).eq("week", week),
        )
        .take(MAX_POOL_ENTRIES);
      for (const outcome of weekOutcomes) {
        if (outcome.entryId === undefined) continue;
        outcomeByEntryWeek.set(`${outcome.entryId}:${week}`, outcome);
        if (week > maxActivityWeek) maxActivityWeek = week;
      }
    }

    if (pool.completedWeek != null && pool.completedWeek > maxActivityWeek) {
      maxActivityWeek = pool.completedWeek;
    }

    // Show through activity (and at least a short runway for new pools).
    const endWeek = Math.min(
      SURVIVOR_FINAL_WEEK,
      Math.max(maxActivityWeek, Math.min(pool.startWeek + 3, SURVIVOR_FINAL_WEEK)),
    );
    const weeks: number[] = [];
    for (let w = pool.startWeek; w <= endWeek; w++) weeks.push(w);

    const teamCache = new Map<
      Id<"nflTeams">,
      { abbreviation: string; name: string; logoUrl: string | null }
    >();
    async function teamIdentity(
      teamId: Id<"nflTeams"> | undefined,
    ): Promise<{
      abbreviation: string;
      name: string;
      logoUrl: string | null;
    } | null> {
      if (!teamId) return null;
      const cached = teamCache.get(teamId);
      if (cached !== undefined) return cached;
      const team = await ctx.db.get(teamId);
      const identity = team
        ? {
            abbreviation: team.abbreviation,
            name: team.name,
            logoUrl: team.logoUrl ?? null,
          }
        : null;
      if (identity) teamCache.set(teamId, identity);
      return identity;
    }

    const rows = [];
    for (const entry of entries) {
      const standing = await ctx.db
        .query("seasonStandings")
        .withIndex("by_poolId_and_entryId", (q) =>
          q.eq("poolId", pool._id).eq("entryId", entry._id),
        )
        .unique();
      const person = await ctx.db.get(entry.participantId);
      const isViewer = entry.participantId === participant._id;

      const cells: SurvivorStandingsGridCell[] = [];
      for (const week of weeks) {
        const key = `${entry._id}:${week}`;
        const pick = pickByEntryWeek.get(key);
        const outcomeDoc = outcomeByEntryWeek.get(key);
        const hasPick =
          pick !== undefined &&
          pick.provenance === "authored" &&
          pick.invalidated !== true;
        const locked = pick?.locked === true;
        const revealed = locked || isViewer;

        let teamAbbreviation: string | null = null;
        let teamName: string | null = null;
        let teamLogoUrl: string | null = null;
        let provenance: "authored" | "omission" | null = null;
        if (pick && revealed) {
          provenance = pick.provenance;
          if (pick.provenance === "authored" && pick.invalidated !== true) {
            const team = await teamIdentity(pick.nflTeamId);
            teamAbbreviation = team?.abbreviation ?? null;
            teamName = team?.name ?? null;
            teamLogoUrl = team?.logoUrl ?? null;
          }
        }

        cells.push({
          week,
          revealed,
          hasPick,
          locked,
          teamAbbreviation: revealed ? teamAbbreviation : null,
          teamName: revealed ? teamName : null,
          teamLogoUrl: revealed ? teamLogoUrl : null,
          provenance: revealed ? provenance : null,
          outcome: revealed ? (outcomeDoc?.outcome ?? null) : null,
        });
      }

      rows.push({
        participantId: entry.participantId,
        entryId: entry._id,
        displayName: entryDisplayName(
          person?.displayName ?? "Participant",
          entry.entryNumber,
        ),
        avatarUrl: person?.avatarUrl ?? null,
        eligibility: standing?.eligibility ?? ("alive" as const),
        eliminatedWeek: standing?.eliminatedWeek ?? null,
        eliminationReason: standing?.eliminationReason ?? null,
        wonAtWeek: standing?.wonAtWeek ?? null,
        isViewer,
        cells,
      });
    }

    rows.sort((a, b) => {
      const rank = (e: string) =>
        e === "alive" || e === "winner" ? 0 : 1;
      const d = rank(a.eligibility) - rank(b.eligibility);
      if (d !== 0) return d;
      return a.displayName.localeCompare(b.displayName);
    });

    const aliveCount = rows.filter(
      (r) => r.eligibility === "alive" || r.eligibility === "winner",
    ).length;

    return {
      poolId: pool._id,
      poolName: pool.name,
      poolStatus: pool.status,
      completedWeek: pool.completedWeek ?? null,
      startWeek: pool.startWeek,
      weeks,
      aliveCount,
      rows,
    };
  },
});
