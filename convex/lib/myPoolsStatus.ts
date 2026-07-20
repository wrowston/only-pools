/**
 * Compact My Pools membership status — board week, pick readiness, standing.
 * Scoped reads only (one week + season standing rows); never entire-season picks.
 * Competitive identity is pool entry — status aggregates across the viewer's
 * active entries in the pool.
 */

import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import {
  listActiveEntriesForParticipant,
  listActivePoolEntries,
} from "./poolEntries";
import { MAX_ENTRIES_PER_USER, MAX_POOL_ENTRIES } from "./quotas";

export type MyPoolsPickStatus =
  | "needs_pick"
  | "pick_saved"
  | "pick_locked"
  | "not_eligible";

export type MyPoolsNextAction =
  | "make_pick"
  | "open_week_board"
  | "view_standings"
  | "view_pool";

export type MyPoolsStanding =
  | {
      kind: "survivor";
      eligibility: "alive" | "eliminated" | "winner";
      eliminatedWeek: number | null;
      aliveCount: number;
      memberCount: number;
    }
  | {
      kind: "confidence";
      seasonRank: number | null;
      seasonPoints: number;
      memberCount: number;
    };

export type MyPoolsMembershipStatus = {
  boardWeek: number;
  pickStatus: MyPoolsPickStatus;
  nextAction: MyPoolsNextAction;
  standing: MyPoolsStanding;
};

/**
 * Earliest week still in play for the Pool, else the latest week with games.
 */
export function resolveBoardWeek(args: {
  startWeek: number;
  earliestKickoffByWeek: Map<number, number>;
  nowMs: number;
}): number {
  const weeks = [...args.earliestKickoffByWeek.keys()]
    .filter((w) => w >= args.startWeek && w <= 18)
    .sort((a, b) => a - b);
  if (weeks.length === 0) return args.startWeek;

  let current = weeks[0]!;
  for (const week of weeks) {
    const earliest = args.earliestKickoffByWeek.get(week)!;
    if (earliest <= args.nowMs) {
      current = week;
    } else if (args.earliestKickoffByWeek.get(weeks[0]!)! > args.nowMs) {
      return weeks[0]!;
    } else {
      return current;
    }
  }
  return current;
}

export async function loadEarliestKickoffByWeek(
  ctx: QueryCtx,
  seasonId: Id<"poolSeasons">,
): Promise<Map<number, number>> {
  const games = await ctx.db
    .query("nflGames")
    .withIndex("by_seasonId", (q) => q.eq("seasonId", seasonId))
    .take(512);
  const earliestByWeek = new Map<number, number>();
  for (const game of games) {
    const prev = earliestByWeek.get(game.week);
    if (prev === undefined || game.scheduledKickoffMs < prev) {
      earliestByWeek.set(game.week, game.scheduledKickoffMs);
    }
  }
  return earliestByWeek;
}

async function loadEntryStandings(
  ctx: QueryCtx,
  poolId: Id<"pools">,
  entries: Doc<"poolEntries">[],
): Promise<Map<Id<"poolEntries">, Doc<"seasonStandings">>> {
  const result = new Map<Id<"poolEntries">, Doc<"seasonStandings">>();
  for (const entry of entries) {
    const standing = await ctx.db
      .query("seasonStandings")
      .withIndex("by_poolId_and_entryId", (q) =>
        q.eq("poolId", poolId).eq("entryId", entry._id),
      )
      .unique();
    if (standing) result.set(entry._id, standing);
  }
  return result;
}

function aggregateSurvivorEligibility(
  standings: Doc<"seasonStandings">[],
): {
  eligibility: "alive" | "eliminated" | "winner";
  eliminatedWeek: number | null;
} {
  if (standings.length === 0) {
    return { eligibility: "alive", eliminatedWeek: null };
  }
  if (standings.some((s) => s.eligibility === "alive")) {
    return { eligibility: "alive", eliminatedWeek: null };
  }
  if (standings.some((s) => s.eligibility === "winner")) {
    return { eligibility: "winner", eliminatedWeek: null };
  }
  let earliest: number | null = null;
  for (const s of standings) {
    if (s.eliminatedWeek === undefined) continue;
    if (earliest === null || s.eliminatedWeek < earliest) {
      earliest = s.eliminatedWeek;
    }
  }
  return { eligibility: "eliminated", eliminatedWeek: earliest };
}

async function countAliveEntries(
  ctx: QueryCtx,
  poolId: Id<"pools">,
): Promise<{ aliveCount: number; entryCount: number }> {
  const entries = await listActivePoolEntries(ctx, poolId);
  const standings = await ctx.db
    .query("seasonStandings")
    .withIndex("by_poolId", (q) => q.eq("poolId", poolId))
    .take(MAX_POOL_ENTRIES);
  const standingByEntry = new Map(
    standings
      .filter((s) => s.entryId !== undefined)
      .map((s) => [s.entryId!, s] as const),
  );
  let aliveCount = 0;
  for (const entry of entries) {
    const standing = standingByEntry.get(entry._id);
    if (!standing || standing.eligibility !== "eliminated") {
      aliveCount += 1;
    }
  }
  return { aliveCount, entryCount: entries.length };
}

/**
 * Aggregate pick readiness across active entries.
 * needs_pick if any eligible entry still needs a pick for the board week.
 */
export function aggregatePickStatuses(
  statuses: MyPoolsPickStatus[],
): MyPoolsPickStatus {
  if (statuses.length === 0) return "needs_pick";
  if (statuses.every((s) => s === "not_eligible")) return "not_eligible";
  const eligible = statuses.filter((s) => s !== "not_eligible");
  if (eligible.some((s) => s === "needs_pick")) return "needs_pick";
  if (eligible.every((s) => s === "pick_locked")) return "pick_locked";
  return "pick_saved";
}

async function survivorPickStatusForEntry(
  ctx: QueryCtx,
  args: {
    poolId: Id<"pools">;
    entryId: Id<"poolEntries">;
    boardWeek: number;
    eligibility: "alive" | "eliminated" | "winner";
  },
): Promise<MyPoolsPickStatus> {
  if (args.eligibility === "eliminated" || args.eligibility === "winner") {
    return "not_eligible";
  }
  const pick = await ctx.db
    .query("survivorPicks")
    .withIndex("by_poolId_and_entryId_and_week", (q) =>
      q
        .eq("poolId", args.poolId)
        .eq("entryId", args.entryId)
        .eq("week", args.boardWeek),
    )
    .unique();
  if (!pick || pick.provenance !== "authored") {
    return "needs_pick";
  }
  return pick.locked ? "pick_locked" : "pick_saved";
}

async function confidencePickStatusForEntry(
  ctx: QueryCtx,
  args: {
    poolId: Id<"pools">;
    entryId: Id<"poolEntries">;
    boardWeek: number;
  },
): Promise<MyPoolsPickStatus> {
  const set = await ctx.db
    .query("confidencePickSets")
    .withIndex("by_poolId_and_entryId_and_week", (q) =>
      q
        .eq("poolId", args.poolId)
        .eq("entryId", args.entryId)
        .eq("week", args.boardWeek),
    )
    .unique();
  if (!set || set.origin === "untouched") {
    return "needs_pick";
  }
  const picks = await ctx.db
    .query("confidencePicks")
    .withIndex("by_pickSetId", (q) => q.eq("pickSetId", set._id))
    .take(64);
  if (picks.length === 0) {
    return "needs_pick";
  }
  const anyUnlocked = picks.some((p) => !p.locked);
  return anyUnlocked ? "pick_saved" : "pick_locked";
}

function deriveNextAction(args: {
  archived: boolean;
  poolStatus: Doc<"pools">["status"];
  pickStatus: MyPoolsPickStatus;
}): MyPoolsNextAction {
  if (args.archived) return "view_pool";
  if (args.poolStatus === "completed") return "view_standings";
  if (args.pickStatus === "not_eligible") return "view_standings";
  if (args.pickStatus === "needs_pick") return "make_pick";
  return "open_week_board";
}

/**
 * Build standing + pick + next-action fields for one My Pools membership row.
 */
export async function buildMembershipStatus(
  ctx: QueryCtx,
  args: {
    pool: Doc<"pools">;
    participantId: Id<"participants">;
    boardWeek: number;
  },
): Promise<MyPoolsMembershipStatus> {
  const entries = await listActiveEntriesForParticipant(
    ctx,
    args.pool._id,
    args.participantId,
  );
  // Legacy memberships without entries yet: treat as needing a pick / alive.
  const entryStandings = await loadEntryStandings(
    ctx,
    args.pool._id,
    entries,
  );

  let standing: MyPoolsStanding;
  let pickStatus: MyPoolsPickStatus;

  if (args.pool.type === "survivor") {
    const { aliveCount, entryCount } = await countAliveEntries(
      ctx,
      args.pool._id,
    );
    const aggregated = aggregateSurvivorEligibility([
      ...entryStandings.values(),
    ]);
    standing = {
      kind: "survivor",
      eligibility: aggregated.eligibility,
      eliminatedWeek: aggregated.eliminatedWeek,
      aliveCount,
      memberCount: entryCount,
    };

    if (entries.length === 0) {
      pickStatus = "needs_pick";
    } else {
      const perEntry: MyPoolsPickStatus[] = [];
      for (const entry of entries) {
        const row = entryStandings.get(entry._id);
        const eligibility = row?.eligibility ?? "alive";
        perEntry.push(
          await survivorPickStatusForEntry(ctx, {
            poolId: args.pool._id,
            entryId: entry._id,
            boardWeek: args.boardWeek,
            eligibility,
          }),
        );
      }
      pickStatus = aggregatePickStatuses(perEntry);
    }
  } else {
    const poolEntries = await listActivePoolEntries(ctx, args.pool._id);
    let bestRank: number | null = null;
    let bestPoints = 0;
    for (const row of entryStandings.values()) {
      const points = row.seasonPoints ?? 0;
      if (points > bestPoints) bestPoints = points;
      if (row.seasonRank !== undefined) {
        if (bestRank === null || row.seasonRank < bestRank) {
          bestRank = row.seasonRank;
        }
      }
    }
    standing = {
      kind: "confidence",
      seasonRank: bestRank,
      seasonPoints: bestPoints,
      memberCount: poolEntries.length,
    };

    if (entries.length === 0) {
      pickStatus = "needs_pick";
    } else {
      const perEntry: MyPoolsPickStatus[] = [];
      for (const entry of entries.slice(0, MAX_ENTRIES_PER_USER)) {
        perEntry.push(
          await confidencePickStatusForEntry(ctx, {
            poolId: args.pool._id,
            entryId: entry._id,
            boardWeek: args.boardWeek,
          }),
        );
      }
      pickStatus = aggregatePickStatuses(perEntry);
    }
  }

  return {
    boardWeek: args.boardWeek,
    pickStatus,
    nextAction: deriveNextAction({
      archived: args.pool.archived === true,
      poolStatus: args.pool.status,
      pickStatus,
    }),
    standing,
  };
}
