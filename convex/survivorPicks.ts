import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { AuthError, requireParticipant } from "./lib/auth";
import { maybeMarkSurvivorPlayingMilestone } from "./helpPrompt";
import { createLogger } from "./lib/log";
import {
  computeWeeklyCutoffMs,
  isSurvivorPickLocked,
  type SaveTrustState,
} from "./lib/pickLock";
import { isPoolArchived } from "./lib/poolArchive";
import { SURVIVOR_ONE_USE_MESSAGE } from "./lib/survivorMessages";
import {
  ensurePrimaryEntryIfMissing,
  listActivePoolEntries,
  requireOwnedActiveEntry,
} from "./lib/poolEntries";
import { MAX_POOL_ENTRIES } from "./lib/quotas";

const log = createLogger("survivorPicks");

/** Application error — client reads `error.data` for the user-facing message. */
class SurvivorPickError extends ConvexError<string> {
  constructor(message: string) {
    super(message);
  }
}

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

function findTeamGame(
  games: Doc<"nflGames">[],
  nflTeamId: Id<"nflTeams">,
): Doc<"nflGames"> | null {
  return (
    games.find(
      (g) => g.homeTeamId === nflTeamId || g.awayTeamId === nflTeamId,
    ) ?? null
  );
}

async function loadActiveReservation(
  ctx: DbCtx,
  poolId: Id<"pools">,
  entryId: Id<"poolEntries">,
  nflTeamId: Id<"nflTeams">,
) {
  const rows = await ctx.db
    .query("survivorTeamReservations")
    .withIndex("by_poolId_and_entryId_and_nflTeamId", (q) =>
      q.eq("poolId", poolId).eq("entryId", entryId).eq("nflTeamId", nflTeamId),
    )
    .take(8);
  return rows.find((r) => !r.released) ?? null;
}

async function releaseReservation(
  ctx: MutationCtx,
  poolId: Id<"pools">,
  entryId: Id<"poolEntries">,
  nflTeamId: Id<"nflTeams">,
  nowMs: number,
) {
  const active = await loadActiveReservation(ctx, poolId, entryId, nflTeamId);
  if (active) {
    await ctx.db.patch(active._id, { released: true, updatedAtMs: nowMs });
  }
}

async function reserveTeam(
  ctx: MutationCtx,
  args: {
    poolId: Id<"pools">;
    participantId: Id<"participants">;
    entryId: Id<"poolEntries">;
    nflTeamId: Id<"nflTeams">;
    week: number;
    nowMs: number;
  },
) {
  const existing = await loadActiveReservation(
    ctx,
    args.poolId,
    args.entryId,
    args.nflTeamId,
  );
  if (existing) {
    // Same week re-save of same team is fine; other week is one-use conflict.
    if (existing.week !== args.week) {
      throw new SurvivorPickError(SURVIVOR_ONE_USE_MESSAGE);
    }
    await ctx.db.patch(existing._id, { updatedAtMs: args.nowMs });
    return;
  }
  await ctx.db.insert("survivorTeamReservations", {
    poolId: args.poolId,
    participantId: args.participantId,
    entryId: args.entryId,
    nflTeamId: args.nflTeamId,
    week: args.week,
    released: false,
    updatedAtMs: args.nowMs,
  });
}

async function writeSanitizedAudit(
  ctx: MutationCtx,
  args: {
    poolId: Id<"pools">;
    actorParticipantId: Id<"participants">;
    action: string;
    week: number;
    locked: boolean;
    provisional: boolean;
  },
) {
  // Never include nflTeamId / team names — Hidden Picks non-leak (scenario 37).
  await ctx.db.insert("poolAuditEvents", {
    poolId: args.poolId,
    actorParticipantId: args.actorParticipantId,
    action: args.action,
    atMs: Date.now(),
    metadataJson: JSON.stringify({
      week: args.week,
      locked: args.locked,
      provisional: args.provisional,
    }),
  });
}

/**
 * Alive Survivor Participant autosaves one team pick for an included week.
 * No Save button — each gesture is a mutation. Client clocks are ignored.
 */
export const autosaveSurvivorPick = mutation({
  args: {
    poolId: v.id("pools"),
    week: v.number(),
    nflTeamId: v.id("nflTeams"),
    entryId: v.optional(v.id("poolEntries")),
    /** Ignored if present — server Date.now() is authoritative. */
    clientNowMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const participant = await requireParticipant(ctx);
    const pool = await ctx.db.get(args.poolId);
    if (!pool) {
      throw new SurvivorPickError("Pool not found");
    }
    if (pool.type !== "survivor") {
      throw new SurvivorPickError("Survivor picks only apply to Survivor Pools");
    }

    const membership = await requirePoolMembership(
      ctx,
      pool._id,
      participant._id,
    );

    if (pool.status === "completed") {
      throw new SurvivorPickError(
        "This Pool is Completed — Survivor Picks are closed",
      );
    }
    if (isPoolArchived(pool)) {
      throw new SurvivorPickError(
        "Archived Pools are read-only for picks — restore to edit",
      );
    }

    await ensurePrimaryEntryIfMissing(ctx, {
      poolId: pool._id,
      participantId: participant._id,
      membershipId: membership._id,
      nowMs: Date.now(),
    });
    const entry = await requireOwnedActiveEntry(ctx, {
      poolId: pool._id,
      participantId: participant._id,
      entryId: args.entryId,
    });

    // Alive entry only — eliminated / winner cannot submit new picks.
    const standing = await ctx.db
      .query("seasonStandings")
      .withIndex("by_poolId_and_entryId", (q) =>
        q.eq("poolId", pool._id).eq("entryId", entry._id),
      )
      .unique();
    if (standing && standing.eligibility !== "alive") {
      throw new SurvivorPickError(
        "Only Alive Participants may submit Survivor Picks",
      );
    }

    if (args.week < pool.startWeek || args.week > 18) {
      throw new SurvivorPickError("Week is outside this Pool's included weeks");
    }

    const nowMs = Date.now();
    const games = await loadWeekGames(ctx, pool.seasonId, args.week);
    if (games.length === 0) {
      throw new SurvivorPickError("Week slate has no published games");
    }

    const game = findTeamGame(games, args.nflTeamId);
    if (!game) {
      throw new SurvivorPickError(
        "That NFL Team is not on the week slate for this Pool Week",
      );
    }
    if (
      game.resultAuthority === "verified" &&
      game.verifiedResult?.status === "CANC"
    ) {
      throw new SurvivorPickError(
        "That game was canceled — choose a different team for this Pool Week",
      );
    }

    const earliestKickoff = Math.min(
      ...games.map((g) => g.scheduledKickoffMs),
    );
    const weeklyCutoffMs =
      pool.pickLockMode === "weeklyCutoff"
        ? computeWeeklyCutoffMs(earliestKickoff)
        : null;

    if (
      isSurvivorPickLocked({
        pickLockMode: pool.pickLockMode,
        game,
        weeklyCutoffMs,
        nowMs,
      })
    ) {
      // Do not echo team identity in the rejection (Hidden / lock boundary).
      throw new SurvivorPickError(
        "Pick Lock has been reached for this Survivor Pick — changes are rejected",
      );
    }

    const existingPick = await ctx.db
      .query("survivorPicks")
      .withIndex("by_poolId_and_entryId_and_week", (q) =>
        q
          .eq("poolId", pool._id)
          .eq("entryId", entry._id)
          .eq("week", args.week),
      )
      .unique();

    if (existingPick?.locked) {
      throw new SurvivorPickError(
        "Pick Lock has been reached for this Survivor Pick — changes are rejected",
      );
    }

    // One-use: refuse if team reserved on another week (per entry).
    const conflict = await loadActiveReservation(
      ctx,
      pool._id,
      entry._id,
      args.nflTeamId,
    );
    if (conflict && conflict.week !== args.week) {
      throw new SurvivorPickError(SURVIVOR_ONE_USE_MESSAGE);
    }

    const provisional = args.week > pool.startWeek;

    if (existingPick) {
      const previousTeamId = existingPick.nflTeamId;
      if (previousTeamId !== undefined && previousTeamId !== args.nflTeamId) {
        await releaseReservation(
          ctx,
          pool._id,
          entry._id,
          previousTeamId,
          nowMs,
        );
        await reserveTeam(ctx, {
          poolId: pool._id,
          participantId: participant._id,
          entryId: entry._id,
          nflTeamId: args.nflTeamId,
          week: args.week,
          nowMs,
        });
      } else if (previousTeamId === undefined) {
        await reserveTeam(ctx, {
          poolId: pool._id,
          participantId: participant._id,
          entryId: entry._id,
          nflTeamId: args.nflTeamId,
          week: args.week,
          nowMs,
        });
      }
      await ctx.db.patch(existingPick._id, {
        nflTeamId: args.nflTeamId,
        gameId: game._id,
        entryId: entry._id,
        provisional,
        provenance: "authored",
        invalidated: undefined,
        invalidatedAtMs: undefined,
        updatedAtMs: nowMs,
      });
    } else {
      await reserveTeam(ctx, {
        poolId: pool._id,
        participantId: participant._id,
        entryId: entry._id,
        nflTeamId: args.nflTeamId,
        week: args.week,
        nowMs,
      });
      await ctx.db.insert("survivorPicks", {
        poolId: pool._id,
        participantId: participant._id,
        entryId: entry._id,
        week: args.week,
        nflTeamId: args.nflTeamId,
        gameId: game._id,
        locked: false,
        provenance: "authored",
        provisional,
        updatedAtMs: nowMs,
      });
    }

    if (!pool.rulesFrozen) {
      await ctx.db.patch(pool._id, { rulesFrozen: true });
    }

    await writeSanitizedAudit(ctx, {
      poolId: pool._id,
      actorParticipantId: participant._id,
      action: "survivor_pick_autosaved",
      week: args.week,
      locked: false,
      provisional,
    });

    const saveTrust: SaveTrustState = {
      status: "saved",
      savedAtMs: nowMs,
    };

    // Do not log nflTeamId — Hidden Pick values stay off application logs.
    log.info("survivor_pick_autosaved", {
      poolId: pool._id,
      entryId: entry._id,
      week: args.week,
      participantId: participant._id,
      provisional,
      rulesFrozen: true,
    });

    await maybeMarkSurvivorPlayingMilestone(ctx, participant._id, nowMs);

    return {
      poolId: pool._id,
      entryId: entry._id,
      week: args.week,
      nflTeamId: args.nflTeamId,
      locked: false as const,
      provenance: "authored" as const,
      provisional,
      saveTrust,
    };
  },
});

/**
 * Materialize Pick Locks for a Pool Week once kickoff / cutoff has passed so
 * Hidden Picks reveal with authored vs omission provenance.
 */
export const materializeSurvivorLocks = mutation({
  args: {
    poolId: v.id("pools"),
    week: v.number(),
  },
  handler: async (ctx, args) => {
    const participant = await requireParticipant(ctx);
    const pool = await ctx.db.get(args.poolId);
    if (!pool) {
      throw new SurvivorPickError("Pool not found");
    }
    await requirePoolMembership(ctx, pool._id, participant._id);
    if (pool.type !== "survivor") {
      return { lockedCount: 0, omissionCount: 0 };
    }

    const nowMs = Date.now();
    const games = await loadWeekGames(ctx, pool.seasonId, args.week);
    if (games.length === 0) {
      return { lockedCount: 0, omissionCount: 0 };
    }

    const earliestKickoff = Math.min(
      ...games.map((g) => g.scheduledKickoffMs),
    );
    const weeklyCutoffMs =
      pool.pickLockMode === "weeklyCutoff"
        ? computeWeeklyCutoffMs(earliestKickoff)
        : null;

    const allGamesLocked = games.every((g) =>
      isSurvivorPickLocked({
        pickLockMode: pool.pickLockMode,
        game: g,
        weeklyCutoffMs,
        nowMs,
      }),
    );

    for (const g of games) {
      if (
        g.kickoffLockReachedAtMs == null &&
        isSurvivorPickLocked({
          pickLockMode: pool.pickLockMode,
          game: g,
          weeklyCutoffMs,
          nowMs,
        })
      ) {
        await ctx.db.patch(g._id, {
          kickoffLockReachedAtMs: Math.min(nowMs, g.scheduledKickoffMs),
        });
      }
    }

    const picks = await ctx.db
      .query("survivorPicks")
      .withIndex("by_poolId_and_week", (q) =>
        q.eq("poolId", pool._id).eq("week", args.week),
      )
      .take(MAX_POOL_ENTRIES);

    let lockedCount = 0;
    for (const pick of picks) {
      if (pick.locked) continue;
      if (pick.provenance === "omission" || !pick.gameId) continue;
      const game = games.find((g) => g._id === pick.gameId);
      if (!game) continue;
      if (
        !isSurvivorPickLocked({
          pickLockMode: pool.pickLockMode,
          game,
          weeklyCutoffMs,
          nowMs,
        })
      ) {
        continue;
      }
      await ctx.db.patch(pick._id, {
        locked: true,
        lockedAtMs: nowMs,
      });
      lockedCount += 1;
    }

    let omissionCount = 0;
    if (allGamesLocked) {
      const entries = await listActivePoolEntries(ctx, pool._id);
      const pickByEntry = new Map(
        picks
          .filter((p) => p.entryId !== undefined)
          .map((p) => [p.entryId!, p] as const),
      );

      for (const entry of entries) {
        if (pickByEntry.has(entry._id)) continue;
        await ctx.db.insert("survivorPicks", {
          poolId: pool._id,
          participantId: entry.participantId,
          entryId: entry._id,
          week: args.week,
          locked: true,
          lockedAtMs: nowMs,
          provenance: "omission",
          provisional: false,
          updatedAtMs: nowMs,
        });
        omissionCount += 1;
      }
    }

    if ((lockedCount > 0 || omissionCount > 0) && !pool.rulesFrozen) {
      await ctx.db.patch(pool._id, { rulesFrozen: true });
    }

    log.info("survivor_locks_materialized", {
      poolId: pool._id,
      week: args.week,
      lockedCount,
      omissionCount,
    });

    return { lockedCount, omissionCount };
  },
});

/**
 * Own Survivor Pick for a week — author always sees their choice.
 */
export const getMySurvivorPick = query({
  args: {
    poolId: v.id("pools"),
    week: v.number(),
    entryId: v.optional(v.id("poolEntries")),
  },
  handler: async (ctx, args) => {
    const participant = await requireParticipant(ctx);
    const pool = await ctx.db.get(args.poolId);
    if (!pool) {
      throw new SurvivorPickError("Pool not found");
    }
    await requirePoolMembership(ctx, pool._id, participant._id);

    const entry = await requireOwnedActiveEntry(ctx, {
      poolId: pool._id,
      participantId: participant._id,
      entryId: args.entryId,
    });

    const pick = await ctx.db
      .query("survivorPicks")
      .withIndex("by_poolId_and_entryId_and_week", (q) =>
        q
          .eq("poolId", pool._id)
          .eq("entryId", entry._id)
          .eq("week", args.week),
      )
      .unique();

    if (!pick || pick.provenance === "omission") {
      return pick?.provenance === "omission"
        ? {
            hasPick: false,
            locked: true,
            provenance: "omission" as const,
            nflTeamId: null,
            provisional: false,
            entryId: entry._id,
          }
        : null;
    }

    return {
      hasPick: true,
      locked: pick.locked,
      provenance: pick.provenance,
      nflTeamId: pick.nflTeamId,
      provisional: pick.provisional,
      updatedAtMs: pick.updatedAtMs,
      entryId: entry._id,
    };
  },
});
