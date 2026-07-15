import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { AuthError, requireParticipant } from "./lib/auth";
import {
  assertRulesEditable,
  assertValidStartWeekSlate,
} from "./lib/poolRules";

const poolTypeValidator = v.union(
  v.literal("survivor"),
  v.literal("confidence"),
);
const pickLockModeValidator = v.union(
  v.literal("gameKickoff"),
  v.literal("weeklyCutoff"),
);

const MAX_OWNED_POOLS = 10;

class PoolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PoolError";
  }
}

async function requireAvailableSeason(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"poolSeasons">> {
  const seasons = await ctx.db
    .query("poolSeasons")
    .withIndex("by_status", (q) => q.eq("status", "available"))
    .take(1);
  const season = seasons[0];
  if (!season) {
    throw new PoolError("No Available Season — Create Pool is disabled");
  }
  return season;
}

async function loadWeekGames(
  ctx: QueryCtx | MutationCtx,
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

async function requirePoolMembership(
  ctx: QueryCtx | MutationCtx,
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

async function requirePoolOwner(
  ctx: QueryCtx | MutationCtx,
  pool: Doc<"pools">,
  participantId: Id<"participants">,
): Promise<void> {
  if (pool.ownerParticipantId !== participantId) {
    throw new AuthError("Only the Pool Owner may change Pool Ruleset");
  }
}

/**
 * Create an immediately Active Survivor or Confidence Pool for the Available
 * Season. Caller becomes Pool Owner via membership — never trust client role.
 */
export const createPool = mutation({
  args: {
    name: v.string(),
    type: poolTypeValidator,
    startWeek: v.number(),
    pickLockMode: pickLockModeValidator,
  },
  handler: async (ctx, args) => {
    const participant = await requireParticipant(ctx);
    const season = await requireAvailableSeason(ctx);

    const trimmed = args.name.trim();
    if (trimmed.length === 0) {
      throw new PoolError("Pool name is required");
    }
    if (args.startWeek < 1 || args.startWeek > 18) {
      throw new PoolError("Start Week must be a regular-season week 1–18");
    }

    const owned = await ctx.db
      .query("pools")
      .withIndex("by_ownerParticipantId", (q) =>
        q.eq("ownerParticipantId", participant._id),
      )
      .take(MAX_OWNED_POOLS + 1);
    if (owned.length >= MAX_OWNED_POOLS) {
      throw new PoolError(`Pool Owner may create at most ${MAX_OWNED_POOLS} Pools`);
    }

    const nowMs = Date.now();
    const games = await loadWeekGames(ctx, season._id, args.startWeek);
    assertValidStartWeekSlate({ games, nowMs });

    const poolId = await ctx.db.insert("pools", {
      name: trimmed,
      type: args.type,
      seasonId: season._id,
      startWeek: args.startWeek,
      pickLockMode: args.pickLockMode,
      status: "active",
      rulesFrozen: false,
      ownerParticipantId: participant._id,
      createdAtMs: nowMs,
    });

    await ctx.db.insert("poolMemberships", {
      poolId,
      participantId: participant._id,
      role: "owner",
      status: "active",
    });

    return {
      poolId,
      status: "active" as const,
      startWeek: args.startWeek,
      seasonId: season._id,
    };
  },
});

/**
 * Edit Start Week, Pick Lock mode, or name until rules freeze.
 * Pool Type and Pool Season are never editable.
 */
export const updatePoolRules = mutation({
  args: {
    poolId: v.id("pools"),
    startWeek: v.optional(v.number()),
    pickLockMode: v.optional(pickLockModeValidator),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const participant = await requireParticipant(ctx);
    const pool = await ctx.db.get(args.poolId);
    if (!pool) {
      throw new PoolError("Pool not found");
    }

    await requirePoolMembership(ctx, pool._id, participant._id);
    await requirePoolOwner(ctx, pool, participant._id);

    const patch: {
      startWeek?: number;
      pickLockMode?: "gameKickoff" | "weeklyCutoff";
      name?: string;
    } = {};

    // Display name is not outcome-affecting — editable even after rules freeze.
    if (args.name !== undefined) {
      const trimmed = args.name.trim();
      if (trimmed.length === 0) {
        throw new PoolError("Pool name is required");
      }
      patch.name = trimmed;
    }

    const outcomeAffecting =
      args.pickLockMode !== undefined || args.startWeek !== undefined;
    if (outcomeAffecting) {
      assertRulesEditable(pool.rulesFrozen);
    }

    if (args.pickLockMode !== undefined) {
      patch.pickLockMode = args.pickLockMode;
    }

    if (args.startWeek !== undefined) {
      if (args.startWeek < 1 || args.startWeek > 18) {
        throw new PoolError("Start Week must be a regular-season week 1–18");
      }
      const games = await loadWeekGames(ctx, pool.seasonId, args.startWeek);
      assertValidStartWeekSlate({ games, nowMs: Date.now() });
      patch.startWeek = args.startWeek;
    }

    if (Object.keys(patch).length === 0) {
      return { poolId: pool._id };
    }

    await ctx.db.patch(pool._id, patch);
    return { poolId: pool._id };
  },
});

/**
 * Internal helper for tests / later pick tickets: mark rules frozen after
 * first accepted competitive edit or first Pick Lock.
 */
export const freezePoolRules = internalMutation({
  args: { poolId: v.id("pools") },
  handler: async (ctx, args) => {
    const pool = await ctx.db.get(args.poolId);
    if (!pool) {
      throw new PoolError("Pool not found");
    }
    await ctx.db.patch(pool._id, { rulesFrozen: true });
    return { poolId: pool._id, rulesFrozen: true as const };
  },
});

/**
 * Valid Start Weeks for the Available Season (published slate, not kicked off).
 */
export const listAvailableStartWeeks = query({
  args: {},
  handler: async (ctx) => {
    await requireParticipant(ctx);
    const seasons = await ctx.db
      .query("poolSeasons")
      .withIndex("by_status", (q) => q.eq("status", "available"))
      .take(1);
    const season = seasons[0];
    if (!season) {
      return { seasonId: null, weeks: [] as number[] };
    }

    const nowMs = Date.now();
    const games = await ctx.db
      .query("nflGames")
      .withIndex("by_seasonId", (q) => q.eq("seasonId", season._id))
      .take(512);

    const byWeek = new Map<number, number>();
    for (const g of games) {
      const prev = byWeek.get(g.week);
      if (prev === undefined || g.scheduledKickoffMs < prev) {
        byWeek.set(g.week, g.scheduledKickoffMs);
      }
    }

    const weeks = [...byWeek.entries()]
      .filter(([, earliest]) => earliest > nowMs)
      .map(([week]) => week)
      .sort((a, b) => a - b);

    return {
      seasonId: season._id,
      seasonLabel: season.label,
      weeks,
    };
  },
});

/**
 * Week Board: published NFL slate for a Pool week. Membership required.
 * Picks remain read-only placeholders until later tickets.
 */
export const getWeekBoard = query({
  args: {
    poolId: v.id("pools"),
    week: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const participant = await requireParticipant(ctx);
    const pool = await ctx.db.get(args.poolId);
    if (!pool) {
      throw new PoolError("Pool not found");
    }

    await requirePoolMembership(ctx, pool._id, participant._id);

    const week = args.week ?? pool.startWeek;
    const games = await loadWeekGames(ctx, pool.seasonId, week);
    const season = await ctx.db.get(pool.seasonId);

    const slate = [];
    for (const game of games) {
      const home = await ctx.db.get(game.homeTeamId);
      const away = await ctx.db.get(game.awayTeamId);
      slate.push({
        gameId: game._id,
        week: game.week,
        scheduledKickoffMs: game.scheduledKickoffMs,
        lifecycle: game.lifecycle,
        homeTeam: home
          ? {
              id: home._id,
              name: home.name,
              abbreviation: home.abbreviation,
            }
          : null,
        awayTeam: away
          ? {
              id: away._id,
              name: away.name,
              abbreviation: away.abbreviation,
            }
          : null,
        pickPlaceholder: "read_only" as const,
      });
    }

    slate.sort((a, b) => a.scheduledKickoffMs - b.scheduledKickoffMs);

    return {
      pool: {
        poolId: pool._id,
        name: pool.name,
        type: pool.type,
        startWeek: pool.startWeek,
        pickLockMode: pool.pickLockMode,
        rulesFrozen: pool.rulesFrozen,
        status: pool.status,
        seasonLabel: season?.label ?? null,
      },
      week,
      slate,
    };
  },
});
