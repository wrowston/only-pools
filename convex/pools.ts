import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { AuthError, requireParticipant } from "./lib/auth";
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
} from "./lib/quotas";

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
    });

    await ctx.db.insert("poolMemberships", {
      poolId,
      participantId: participant._id,
      role: "owner",
      status: "active",
    });

    const invite = await mintOrdinaryPoolInvite(ctx, {
      poolId,
      createdByParticipantId: participant._id,
      nowMs,
    });

    return {
      poolId,
      status: "active" as const,
      startWeek: args.startWeek,
      seasonId: season._id,
      inviteUrl: invite.url,
      expiresAtMs: invite.expiresAtMs,
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
    const nowMs = Date.now();

    const seasonGames = await ctx.db
      .query("nflGames")
      .withIndex("by_seasonId", (q) => q.eq("seasonId", pool.seasonId))
      .take(512);
    const availableWeekSet = new Set<number>();
    for (const g of seasonGames) {
      if (g.week >= pool.startWeek && g.week <= 18) {
        availableWeekSet.add(g.week);
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
        .take(200);

      const myPick = picks.find((p) => p.participantId === participant._id);
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

      const reservations = await ctx.db
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

      const memberships = await ctx.db
        .query("poolMemberships")
        .withIndex("by_poolId", (q) => q.eq("poolId", pool._id))
        .take(120);

      for (const m of memberships) {
        if (m.status !== "active") continue;
        if (m.participantId === participant._id) continue;
        const member = await ctx.db.get(m.participantId);
        const pick = picks.find((p) => p.participantId === m.participantId);
        const hasPick =
          pick !== undefined && pick.provenance === "authored";
        const locked = pick?.locked === true;

        if (locked && pick) {
          let teamAbbreviation: string | null = null;
          let teamLogoUrl: string | null = null;
          if (pick.provenance === "authored" && pick.nflTeamId) {
            const team = await ctx.db.get(pick.nflTeamId);
            teamAbbreviation = team?.abbreviation ?? null;
            teamLogoUrl = team?.logoUrl ?? null;
          }
          participantPickStates.push({
            participantId: m.participantId,
            displayName: member?.displayName ?? "Participant",
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
            participantId: m.participantId,
            displayName: member?.displayName ?? "Participant",
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

      const mySet = await ctx.db
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
        .take(120);
      const allPicks = await ctx.db
        .query("confidencePicks")
        .withIndex("by_poolId_and_week", (q) =>
          q.eq("poolId", pool._id).eq("week", week),
        )
        .take(2000);

      const memberships = await ctx.db
        .query("poolMemberships")
        .withIndex("by_poolId", (q) => q.eq("poolId", pool._id))
        .take(120);

      for (const m of memberships) {
        if (m.status !== "active") continue;
        if (m.participantId === participant._id) continue;
        const member = await ctx.db.get(m.participantId);
        const set = allSets.find((s) => s.participantId === m.participantId);
        const picks = allPicks.filter(
          (p) => p.participantId === m.participantId,
        );
        const hasPick =
          set !== undefined &&
          (set.origin === "authored" || set.origin === "automatic");
        const anyLocked = picks.some((p) => p.locked);

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
            participantId: m.participantId,
            displayName: member?.displayName ?? "Participant",
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
            participantId: m.participantId,
            displayName: member?.displayName ?? "Participant",
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
