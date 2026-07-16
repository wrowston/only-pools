/**
 * Compact My Pools membership status — board week, pick readiness, standing.
 * Scoped reads only (one week + season standing row); never entire-season picks.
 */

import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

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

async function countActiveMembers(
  ctx: QueryCtx,
  poolId: Id<"pools">,
): Promise<number> {
  const rows = await ctx.db
    .query("poolMemberships")
    .withIndex("by_poolId", (q) => q.eq("poolId", poolId))
    .take(120);
  return rows.filter((m) => m.status === "active").length;
}

async function loadViewerStanding(
  ctx: QueryCtx,
  poolId: Id<"pools">,
  participantId: Id<"participants">,
): Promise<Doc<"seasonStandings"> | null> {
  return await ctx.db
    .query("seasonStandings")
    .withIndex("by_poolId_and_participantId", (q) =>
      q.eq("poolId", poolId).eq("participantId", participantId),
    )
    .unique();
}

async function countAliveMembers(
  ctx: QueryCtx,
  poolId: Id<"pools">,
  memberCount: number,
): Promise<number> {
  const standings = await ctx.db
    .query("seasonStandings")
    .withIndex("by_poolId", (q) => q.eq("poolId", poolId))
    .take(120);
  const eliminated = standings.filter(
    (s) => s.eligibility === "eliminated",
  ).length;
  // Members without a standing row are treated as Alive.
  return Math.max(0, memberCount - eliminated);
}

async function survivorPickStatus(
  ctx: QueryCtx,
  args: {
    poolId: Id<"pools">;
    participantId: Id<"participants">;
    boardWeek: number;
    eligibility: "alive" | "eliminated" | "winner";
  },
): Promise<MyPoolsPickStatus> {
  if (args.eligibility === "eliminated" || args.eligibility === "winner") {
    return "not_eligible";
  }
  const pick = await ctx.db
    .query("survivorPicks")
    .withIndex("by_poolId_and_participantId_and_week", (q) =>
      q
        .eq("poolId", args.poolId)
        .eq("participantId", args.participantId)
        .eq("week", args.boardWeek),
    )
    .unique();
  if (!pick || pick.provenance !== "authored") {
    return "needs_pick";
  }
  return pick.locked ? "pick_locked" : "pick_saved";
}

async function confidencePickStatus(
  ctx: QueryCtx,
  args: {
    poolId: Id<"pools">;
    participantId: Id<"participants">;
    boardWeek: number;
  },
): Promise<MyPoolsPickStatus> {
  const set = await ctx.db
    .query("confidencePickSets")
    .withIndex("by_poolId_and_participantId_and_week", (q) =>
      q
        .eq("poolId", args.poolId)
        .eq("participantId", args.participantId)
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
  const memberCount = await countActiveMembers(ctx, args.pool._id);
  const standingRow = await loadViewerStanding(
    ctx,
    args.pool._id,
    args.participantId,
  );

  let standing: MyPoolsStanding;
  let pickStatus: MyPoolsPickStatus;

  if (args.pool.type === "survivor") {
    const eligibility = standingRow?.eligibility ?? "alive";
    const aliveCount = await countAliveMembers(
      ctx,
      args.pool._id,
      memberCount,
    );
    standing = {
      kind: "survivor",
      eligibility,
      eliminatedWeek: standingRow?.eliminatedWeek ?? null,
      aliveCount,
      memberCount,
    };
    pickStatus = await survivorPickStatus(ctx, {
      poolId: args.pool._id,
      participantId: args.participantId,
      boardWeek: args.boardWeek,
      eligibility,
    });
  } else {
    standing = {
      kind: "confidence",
      seasonRank: standingRow?.seasonRank ?? null,
      seasonPoints: standingRow?.seasonPoints ?? 0,
      memberCount,
    };
    pickStatus = await confidencePickStatus(ctx, {
      poolId: args.pool._id,
      participantId: args.participantId,
      boardWeek: args.boardWeek,
    });
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
