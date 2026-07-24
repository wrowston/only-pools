import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { AuthError, requireParticipant } from "./lib/auth";
import { markOwnerPoolCreated } from "./helpPrompt";
import { createLogger } from "./lib/log";
import {
  assertRulesEditable,
  assertValidStartWeekSlate,
} from "./lib/poolRules";
import {
  computeWeeklyCutoffMs,
  isSurvivorPickLocked,
} from "./lib/pickLock";
import { defaultConfidenceRanking } from "./lib/confidenceScale";
import { deriveFreshness } from "./lib/freshness";
import { isPoolArchived } from "./lib/poolArchive";
import { mintOrdinaryPoolInvite } from "./lib/mintOrdinaryInvite";
import {
  MAX_MEMBERSHIPS_PER_SEASON,
  MAX_OWNED_POOLS,
  MAX_POOL_ENTRIES,
} from "./lib/quotas";
import {
  assertValidMaxEntriesPerUser,
  countActivePoolEntries,
  createPrimaryEntry,
  displayIndexByEntryId,
  entryDisplayName,
  entryHasAnyPicks,
  listActiveEntriesForParticipant,
  listActivePoolEntries,
  nextEntryNumber,
  PoolEntryError,
  poolMaxEntriesPerUser,
} from "./lib/poolEntries";
import { isAdmissionClosed } from "./lib/membershipCutoff";
import {
  loadEarliestKickoffByWeek,
  resolveBoardWeek,
} from "./lib/myPoolsStatus";

const log = createLogger("pools");

const poolTypeValidator = v.union(
  v.literal("survivor"),
  v.literal("confidence"),
);
const pickLockModeValidator = v.union(
  v.literal("gameKickoff"),
  v.literal("weeklyCutoff"),
);

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
    maxEntriesPerUser: v.optional(v.number()),
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

    const maxEntriesPerUser = args.maxEntriesPerUser ?? 1;
    try {
      assertValidMaxEntriesPerUser(maxEntriesPerUser);
    } catch (err) {
      if (err instanceof PoolEntryError) throw new PoolError(err.message);
      throw err;
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

    // ≤50 active memberships per season (create counts as a membership).
    const seasonMemberships = await ctx.db
      .query("poolMemberships")
      .withIndex("by_participantId", (q) =>
        q.eq("participantId", participant._id),
      )
      .take(MAX_MEMBERSHIPS_PER_SEASON + 20);
    let seasonActiveCount = 0;
    for (const row of seasonMemberships) {
      if (row.status !== "active") continue;
      const existingPool = await ctx.db.get(row.poolId);
      if (existingPool && existingPool.seasonId === season._id) {
        seasonActiveCount += 1;
      }
    }
    if (seasonActiveCount >= MAX_MEMBERSHIPS_PER_SEASON) {
      throw new PoolError(
        `At most ${MAX_MEMBERSHIPS_PER_SEASON} Pool memberships per season`,
      );
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
      archived: false,
      ownerParticipantId: participant._id,
      createdAtMs: nowMs,
      maxEntriesPerUser,
    });

    const membershipId = await ctx.db.insert("poolMemberships", {
      poolId,
      participantId: participant._id,
      role: "owner",
      status: "active",
    });

    await createPrimaryEntry(ctx, {
      poolId,
      participantId: participant._id,
      membershipId,
      nowMs,
    });

    const invite = await mintOrdinaryPoolInvite(ctx, {
      poolId,
      createdByParticipantId: participant._id,
      nowMs,
    });

    // Never log inviteUrl / credential — only pool metadata.
    log.info("pool_created", {
      poolId,
      type: args.type,
      startWeek: args.startWeek,
      seasonId: season._id,
      ownerParticipantId: participant._id,
      maxEntriesPerUser,
      pickLockMode: args.pickLockMode,
    });

    await markOwnerPoolCreated(ctx, participant._id, nowMs);

    return {
      poolId,
      status: "active" as const,
      startWeek: args.startWeek,
      seasonId: season._id,
      inviteUrl: invite.url,
      expiresAtMs: invite.expiresAtMs,
      maxEntriesPerUser,
    };
  },
});

async function assertPoolAdmissionOpen(
  ctx: MutationCtx | QueryCtx,
  pool: Doc<"pools">,
  nowMs: number,
): Promise<void> {
  const games = await loadWeekGames(ctx, pool.seasonId, pool.startWeek);
  const earliestKickoffMs =
    games.length === 0
      ? null
      : Math.min(...games.map((g) => g.scheduledKickoffMs));
  if (
    isAdmissionClosed({
      nowMs,
      admissionClosedAtMs: pool.admissionClosedAtMs,
      earliestKickoffMs,
    })
  ) {
    throw new PoolError("Pool admission is closed — entries cannot change");
  }
}

/**
 * Owner may raise/lower max entries per user while admission is open.
 * Never below any member's current active entry count.
 */
export const updateMaxEntriesPerUser = mutation({
  args: {
    poolId: v.id("pools"),
    maxEntriesPerUser: v.number(),
  },
  returns: v.object({
    poolId: v.id("pools"),
    maxEntriesPerUser: v.number(),
  }),
  handler: async (ctx, args) => {
    const participant = await requireParticipant(ctx);
    const pool = await ctx.db.get(args.poolId);
    if (!pool) throw new PoolError("Pool not found");
    await requirePoolMembership(ctx, pool._id, participant._id);
    await requirePoolOwner(ctx, pool, participant._id);
    if (isPoolArchived(pool)) {
      throw new PoolError(
        "Archived Pools are read-only — restore before editing",
      );
    }
    try {
      assertValidMaxEntriesPerUser(args.maxEntriesPerUser);
    } catch (err) {
      if (err instanceof PoolEntryError) throw new PoolError(err.message);
      throw err;
    }

    const nowMs = Date.now();
    await assertPoolAdmissionOpen(ctx, pool, nowMs);

    const memberships = await ctx.db
      .query("poolMemberships")
      .withIndex("by_poolId", (q) => q.eq("poolId", pool._id))
      .take(MAX_POOL_ENTRIES);
    let highestHeld = 0;
    for (const membership of memberships) {
      if (membership.status !== "active") continue;
      const held = await listActiveEntriesForParticipant(
        ctx,
        pool._id,
        membership.participantId,
      );
      if (held.length > highestHeld) highestHeld = held.length;
    }
    if (args.maxEntriesPerUser < highestHeld) {
      throw new PoolError(
        `Cannot set maxEntriesPerUser below ${highestHeld} — a member already holds that many entries`,
      );
    }

    await ctx.db.patch(pool._id, {
      maxEntriesPerUser: args.maxEntriesPerUser,
    });
    return { poolId: pool._id, maxEntriesPerUser: args.maxEntriesPerUser };
  },
});

export const listMyPoolEntries = query({
  args: {
    poolId: v.id("pools"),
    /** Client wall clock for admission-open checks (queries must not use Date.now). */
    nowMs: v.number(),
  },
  returns: v.object({
    poolId: v.id("pools"),
    maxEntriesPerUser: v.number(),
    admissionClosed: v.boolean(),
    canManageEntries: v.boolean(),
    entries: v.array(
      v.object({
        entryId: v.id("poolEntries"),
        entryNumber: v.number(),
        displayIndex: v.number(),
        status: v.literal("active"),
        hasPicks: v.boolean(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const participant = await requireParticipant(ctx);
    const pool = await ctx.db.get(args.poolId);
    if (!pool) throw new PoolError("Pool not found");
    await requirePoolMembership(ctx, pool._id, participant._id);

    const games = await loadWeekGames(ctx, pool.seasonId, pool.startWeek);
    const earliestKickoffMs =
      games.length === 0
        ? null
        : Math.min(...games.map((g) => g.scheduledKickoffMs));
    const admissionClosed = isAdmissionClosed({
      nowMs: args.nowMs,
      admissionClosedAtMs: pool.admissionClosedAtMs,
      earliestKickoffMs,
    });

    const entries = await listActiveEntriesForParticipant(
      ctx,
      pool._id,
      participant._id,
    );
    const detailed = [];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]!;
      detailed.push({
        entryId: e._id,
        entryNumber: e.entryNumber,
        displayIndex: i + 1,
        status: "active" as const,
        hasPicks: await entryHasAnyPicks(ctx, e._id),
      });
    }
    return {
      poolId: pool._id,
      maxEntriesPerUser: poolMaxEntriesPerUser(pool),
      admissionClosed,
      canManageEntries: !admissionClosed,
      entries: detailed,
    };
  },
});

export const addPoolEntry = mutation({
  args: { poolId: v.id("pools") },
  returns: v.object({
    entryId: v.id("poolEntries"),
    entryNumber: v.number(),
  }),
  handler: async (ctx, args) => {
    const participant = await requireParticipant(ctx);
    const pool = await ctx.db.get(args.poolId);
    if (!pool) throw new PoolError("Pool not found");
    if (pool.status !== "active") {
      throw new PoolError("Cannot add entries to a Completed Pool");
    }
    if (isPoolArchived(pool)) {
      throw new PoolError("Archived Pools are read-only");
    }
    const membership = await requirePoolMembership(
      ctx,
      pool._id,
      participant._id,
    );

    const nowMs = Date.now();
    await assertPoolAdmissionOpen(ctx, pool, nowMs);

    const max = poolMaxEntriesPerUser(pool);
    const held = await listActiveEntriesForParticipant(
      ctx,
      pool._id,
      participant._id,
    );
    if (held.length >= max) {
      throw new PoolError(
        `This Pool allows at most ${max} entries per participant`,
      );
    }

    const poolEntryCount = await countActivePoolEntries(ctx, pool._id);
    if (poolEntryCount >= MAX_POOL_ENTRIES) {
      throw new PoolError(
        `This Pool has reached its entry limit (${MAX_POOL_ENTRIES})`,
      );
    }

    const entryNumber = await nextEntryNumber(
      ctx,
      pool._id,
      participant._id,
    );
    const entryId = await ctx.db.insert("poolEntries", {
      poolId: pool._id,
      participantId: participant._id,
      membershipId: membership._id,
      entryNumber,
      status: "active",
      createdAtMs: nowMs,
    });
    return { entryId, entryNumber };
  },
});

export const dropPoolEntry = mutation({
  args: {
    poolId: v.id("pools"),
    entryId: v.id("poolEntries"),
  },
  returns: v.object({ entryId: v.id("poolEntries"), status: v.literal("ended") }),
  handler: async (ctx, args) => {
    const participant = await requireParticipant(ctx);
    const pool = await ctx.db.get(args.poolId);
    if (!pool) throw new PoolError("Pool not found");
    await requirePoolMembership(ctx, pool._id, participant._id);

    const nowMs = Date.now();
    await assertPoolAdmissionOpen(ctx, pool, nowMs);

    const entry = await ctx.db.get(args.entryId);
    if (
      !entry ||
      entry.poolId !== pool._id ||
      entry.participantId !== participant._id ||
      entry.status !== "active"
    ) {
      throw new PoolError("Entry not found");
    }

    const held = await listActiveEntriesForParticipant(
      ctx,
      pool._id,
      participant._id,
    );
    if (held.length <= 1) {
      throw new PoolError(
        "Cannot drop your last entry — use Leave pool instead",
      );
    }

    if (await entryHasAnyPicks(ctx, entry._id)) {
      throw new PoolError("Cannot drop an entry that already has picks");
    }

    await ctx.db.patch(entry._id, {
      status: "ended",
      endedAtMs: nowMs,
    });
    return { entryId: entry._id, status: "ended" as const };
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

    if (isPoolArchived(pool)) {
      throw new PoolError(
        "Archived Pools are read-only — restore before editing rules",
      );
    }

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
 * Survivor: own pick visible; opponents Hidden until Pick Lock. Owner/Admin
 * see completion (hasPick) without Hidden Pick team identity.
 * Confidence: own predictions/values visible; opponents Hidden until lock.
 */
export const getWeekBoard = query({
  args: {
    poolId: v.id("pools"),
    week: v.optional(v.number()),
    entryId: v.optional(v.id("poolEntries")),
  },
  handler: async (ctx, args) => {
    const participant = await requireParticipant(ctx);
    const pool = await ctx.db.get(args.poolId);
    if (!pool) {
      throw new PoolError("Pool not found");
    }

    await requirePoolMembership(ctx, pool._id, participant._id);

    let boardEntryId = args.entryId;
    if (boardEntryId === undefined) {
      const mine = await listActiveEntriesForParticipant(
        ctx,
        pool._id,
        participant._id,
      );
      boardEntryId = mine[0]?._id;
    } else {
      const entry = await ctx.db.get(boardEntryId);
      if (
        !entry ||
        entry.poolId !== pool._id ||
        entry.participantId !== participant._id ||
        entry.status !== "active"
      ) {
        throw new PoolError("Entry not found");
      }
    }

    const nowMs = Date.now();
    const earliestKickoffByWeek = await loadEarliestKickoffByWeek(
      ctx,
      pool.seasonId,
    );
    const week =
      args.week ??
      resolveBoardWeek({
        startWeek: pool.startWeek,
        earliestKickoffByWeek,
        nowMs,
      });
    const games = await loadWeekGames(ctx, pool.seasonId, week);
    const season = await ctx.db.get(pool.seasonId);

    const availableWeekSet = new Set<number>();
    for (const weekNumber of earliestKickoffByWeek.keys()) {
      if (weekNumber >= pool.startWeek && weekNumber <= 18) {
        availableWeekSet.add(weekNumber);
      }
    }
    availableWeekSet.add(week);
    availableWeekSet.add(pool.startWeek);
    const availableWeeks = [...availableWeekSet].sort((a, b) => a - b);

    const earliestKickoff =
      games.length > 0
        ? Math.min(...games.map((g) => g.scheduledKickoffMs))
        : null;
    const weeklyCutoffMs =
      pool.pickLockMode === "weeklyCutoff" && earliestKickoff !== null
        ? computeWeeklyCutoffMs(earliestKickoff)
        : null;

    const slate = [];
    for (const game of games) {
      const home = await ctx.db.get(game.homeTeamId);
      const away = await ctx.db.get(game.awayTeamId);
      const gameLocked = isSurvivorPickLocked({
        pickLockMode: pool.pickLockMode,
        game,
        weeklyCutoffMs,
        nowMs,
      });
      slate.push({
        gameId: game._id,
        week: game.week,
        scheduledKickoffMs: game.scheduledKickoffMs,
        lifecycle: game.lifecycle,
        locked: gameLocked,
        homeTeam: home
          ? {
              id: home._id,
              name: home.name,
              abbreviation: home.abbreviation,
              logoUrl: home.logoUrl ?? null,
            }
          : null,
        awayTeam: away
          ? {
              id: away._id,
              name: away.name,
              abbreviation: away.abbreviation,
              logoUrl: away.logoUrl ?? null,
            }
          : null,
        /** Projected scores — never official until Verified Result. */
        projectedHomeScore: game.homeScore,
        projectedAwayScore: game.awayScore,
        resultAuthority: game.resultAuthority ?? "none",
        isOfficial: (game.resultAuthority ?? "none") === "verified",
        verifiedResult: game.verifiedResult ?? null,
        lastObservedAtMs: game.lastObservedAtMs ?? null,
      });
    }

    slate.sort((a, b) => a.scheduledKickoffMs - b.scheduledKickoffMs);

    let mySurvivorPick: {
      nflTeamId: Id<"nflTeams"> | null;
      locked: boolean;
      provenance: "authored" | "omission";
      provisional: boolean;
      updatedAtMs: number;
    } | null = null;

    /** Active one-use reservations for the viewer (own history only). */
    const myReservedTeams: Array<{
      nflTeamId: Id<"nflTeams">;
      week: number;
      abbreviation: string | null;
    }> = [];

    type ParticipantPickState =
      | {
          participantId: Id<"participants">;
          displayName: string;
          hasPick: boolean;
          locked: false;
        }
      | {
          participantId: Id<"participants">;
          displayName: string;
          hasPick: boolean;
          locked: true;
          nflTeamId?: Id<"nflTeams"> | null;
          provenance: "authored" | "automatic" | "omission";
          teamAbbreviation?: string | null;
          teamLogoUrl?: string | null;
          picks?: Array<{
            gameId: Id<"nflGames">;
            pickedTeamId: Id<"nflTeams"> | null;
            confidenceValue: number;
            provenance: "authored" | "automatic" | "omission";
            teamAbbreviation: string | null;
            teamLogoUrl: string | null;
          }>;
          tiebreakerPrediction?: number | null;
        };

    const participantPickStates: ParticipantPickState[] = [];

    let myConfidencePickSet: {
      origin: "untouched" | "authored" | "automatic";
      tiebreakerPrediction: number | null;
      tiebreakerLocked: boolean;
      tiebreakerGameId: Id<"nflGames"> | null;
      defaultRanking: number[];
      picks: Array<{
        gameId: Id<"nflGames">;
        pickedTeamId: Id<"nflTeams"> | null;
        confidenceValue: number;
        locked: boolean;
        provenance: "authored" | "automatic" | "omission";
      }>;
    } | null = null;

    if (pool.type === "survivor") {
      const picks = await ctx.db
        .query("survivorPicks")
        .withIndex("by_poolId_and_week", (q) =>
          q.eq("poolId", pool._id).eq("week", week),
        )
        .take(MAX_POOL_ENTRIES);

      const myPick =
        boardEntryId !== undefined
          ? picks.find((p) => p.entryId === boardEntryId)
          : picks.find((p) => p.participantId === participant._id);
      if (myPick) {
        mySurvivorPick = {
          nflTeamId:
            myPick.provenance === "omission"
              ? null
              : (myPick.nflTeamId ?? null),
          locked: myPick.locked,
          provenance: myPick.provenance,
          provisional: myPick.provisional,
          updatedAtMs: myPick.updatedAtMs,
        };
      }

      const reservations =
        boardEntryId !== undefined
          ? await ctx.db
              .query("survivorTeamReservations")
              .withIndex("by_entryId", (q) => q.eq("entryId", boardEntryId))
              .take(64)
          : await ctx.db
              .query("survivorTeamReservations")
              .withIndex("by_poolId_and_participantId", (q) =>
                q.eq("poolId", pool._id).eq("participantId", participant._id),
              )
              .take(64);
      for (const reservation of reservations) {
        if (reservation.released) continue;
        const team = await ctx.db.get(reservation.nflTeamId);
        myReservedTeams.push({
          nflTeamId: reservation.nflTeamId,
          week: reservation.week,
          abbreviation: team?.abbreviation ?? null,
        });
      }

      const entries = await listActivePoolEntries(ctx, pool._id);
      const displayIndexes = displayIndexByEntryId(entries);

      for (const entry of entries) {
        if (entry.participantId === participant._id) continue;
        const member = await ctx.db.get(entry.participantId);
        const pick = picks.find((p) => p.entryId === entry._id);
        const hasPick =
          pick !== undefined && pick.provenance === "authored";
        const locked = pick?.locked === true;
        const label = entryDisplayName(
          member?.displayName ?? "Participant",
          displayIndexes.get(entry._id) ?? 1,
        );

        if (locked && pick) {
          let teamAbbreviation: string | null = null;
          let teamLogoUrl: string | null = null;
          if (pick.provenance === "authored" && pick.nflTeamId) {
            const team = await ctx.db.get(pick.nflTeamId);
            teamAbbreviation = team?.abbreviation ?? null;
            teamLogoUrl = team?.logoUrl ?? null;
          }
          participantPickStates.push({
            participantId: entry.participantId,
            displayName: label,
            hasPick,
            locked: true,
            nflTeamId:
              pick.provenance === "authored" ? (pick.nflTeamId ?? null) : null,
            provenance: pick.provenance,
            teamAbbreviation,
            teamLogoUrl,
          });
        } else {
          // Hidden: completion only — never nflTeamId / abbreviation.
          participantPickStates.push({
            participantId: entry.participantId,
            displayName: label,
            hasPick,
            locked: false,
          });
        }
      }
    } else if (pool.type === "confidence") {
      const sheet = await ctx.db
        .query("confidencePickSheets")
        .withIndex("by_poolId_and_week", (q) =>
          q.eq("poolId", pool._id).eq("week", week),
        )
        .unique();

      const mySet =
        boardEntryId !== undefined
          ? await ctx.db
              .query("confidencePickSets")
              .withIndex("by_poolId_and_entryId_and_week", (q) =>
                q
                  .eq("poolId", pool._id)
                  .eq("entryId", boardEntryId)
                  .eq("week", week),
              )
              .unique()
          : await ctx.db
              .query("confidencePickSets")
              .withIndex("by_poolId_and_participantId_and_week", (q) =>
                q
                  .eq("poolId", pool._id)
                  .eq("participantId", participant._id)
                  .eq("week", week),
              )
              .unique();

      if (sheet && mySet) {
        const myPicks = await ctx.db
          .query("confidencePicks")
          .withIndex("by_pickSetId", (q) => q.eq("pickSetId", mySet._id))
          .take(64);
        myConfidencePickSet = {
          origin: mySet.origin,
          tiebreakerPrediction: mySet.tiebreakerPrediction ?? null,
          tiebreakerLocked: mySet.tiebreakerLocked,
          tiebreakerGameId: sheet.tiebreakerGameId,
          defaultRanking: defaultConfidenceRanking(
            sheet.gameIds.length,
            sheet.scaleMax,
          ),
          picks: myPicks.map((p) => ({
            gameId: p.gameId,
            pickedTeamId: p.pickedTeamId ?? null,
            confidenceValue: p.confidenceValue,
            locked: p.locked,
            provenance: p.provenance,
          })),
        };
      } else if (sheet) {
        myConfidencePickSet = {
          origin: "untouched",
          tiebreakerPrediction: null,
          tiebreakerLocked: false,
          tiebreakerGameId: sheet.tiebreakerGameId,
          defaultRanking: defaultConfidenceRanking(
            sheet.gameIds.length,
            sheet.scaleMax,
          ),
          picks: [],
        };
      }

      const allSets = await ctx.db
        .query("confidencePickSets")
        .withIndex("by_poolId_and_week", (q) =>
          q.eq("poolId", pool._id).eq("week", week),
        )
        .take(MAX_POOL_ENTRIES);
      const allPicks = await ctx.db
        .query("confidencePicks")
        .withIndex("by_poolId_and_week", (q) =>
          q.eq("poolId", pool._id).eq("week", week),
        )
        .take(MAX_POOL_ENTRIES * 20);

      const entries = await listActivePoolEntries(ctx, pool._id);
      const displayIndexes = displayIndexByEntryId(entries);

      for (const entry of entries) {
        if (entry.participantId === participant._id) continue;
        const member = await ctx.db.get(entry.participantId);
        const set = allSets.find((s) => s.entryId === entry._id);
        const picks = allPicks.filter((p) => p.entryId === entry._id);
        const hasPick =
          set !== undefined &&
          (set.origin === "authored" || set.origin === "automatic");
        const anyLocked = picks.some((p) => p.locked);
        const label = entryDisplayName(
          member?.displayName ?? "Participant",
          displayIndexes.get(entry._id) ?? 1,
        );

        if (anyLocked && set) {
          const revealedPicks = [];
          for (const pick of picks.filter((p) => p.locked)) {
            let teamAbbreviation: string | null = null;
            let teamLogoUrl: string | null = null;
            if (pick.pickedTeamId) {
              const team = await ctx.db.get(pick.pickedTeamId);
              teamAbbreviation = team?.abbreviation ?? null;
              teamLogoUrl = team?.logoUrl ?? null;
            }
            revealedPicks.push({
              gameId: pick.gameId,
              pickedTeamId: pick.pickedTeamId ?? null,
              confidenceValue: pick.confidenceValue,
              provenance: pick.provenance,
              teamAbbreviation,
              teamLogoUrl,
            });
          }
          participantPickStates.push({
            participantId: entry.participantId,
            displayName: label,
            hasPick,
            locked: true,
            provenance: set.origin === "untouched" ? "omission" : set.origin,
            picks: revealedPicks,
            tiebreakerPrediction: set.tiebreakerLocked
              ? (set.tiebreakerPrediction ?? null)
              : undefined,
          });
        } else {
          participantPickStates.push({
            participantId: entry.participantId,
            displayName: label,
            hasPick,
            locked: false,
          });
        }
      }
    }

    const lastObservedAtMs = games
      .map((g) => g.lastObservedAtMs)
      .filter((ms): ms is number => ms !== undefined)
      .reduce<number | null>(
        (max, ms) => (max === null || ms > max ? ms : max),
        null,
      );

    // Prefer league-live health for the season; fall back to game observation age.
    const liveHealth = await ctx.db
      .query("syncSurfaceHealth")
      .withIndex("by_surface_and_scopeKey", (q) =>
        q.eq("surface", "league_live").eq("scopeKey", `live:${pool.seasonId}`),
      )
      .unique();

    const syncFreshness = liveHealth
      ? deriveFreshness({
          surface: "league_live",
          lastSuccessAtMs: liveHealth.lastSuccessAtMs ?? null,
          nowMs,
          providerException: liveHealth.providerException,
        })
      : lastObservedAtMs !== null
        ? deriveFreshness({
            surface: "league_live",
            lastSuccessAtMs: lastObservedAtMs,
            nowMs,
          })
        : {
            state: "fresh" as const,
            raisesParticipantBanner: false,
          };

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
      availableWeeks,
      slate,
      mySurvivorPick,
      myReservedTeams,
      myConfidencePickSet,
      participantPickStates,
      /**
       * Sync freshness for later Operator Incident wiring (ticket 13).
       * Late alone must not raise a participant banner.
       */
      syncFreshness: {
        state: syncFreshness.state,
        raisesParticipantBanner: syncFreshness.raisesParticipantBanner,
        lastObservedAtMs,
      },
    };
  },
});
