/**
 * Weekly Cutoff Lock resolution — history-aware so a reached Sunday 1pm ET
 * cutoff never reopens when the current earliest kickoff postpones, while
 * still allowing an *unreached* cutoff to move with the slate.
 */

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { selectWeeklyCutoffMs } from "./pickLock";

type DbCtx = QueryCtx | MutationCtx;

const MAX_WEEK_SCHEDULE_HISTORY = 256;

export async function loadWeekScheduleHistoryKickoffs(
  ctx: DbCtx,
  seasonId: Id<"poolSeasons">,
  week: number,
): Promise<number[]> {
  const rows = await ctx.db
    .query("nflGameScheduleHistory")
    .withIndex("by_seasonId_and_week", (q) =>
      q.eq("seasonId", seasonId).eq("week", week),
    )
    .take(MAX_WEEK_SCHEDULE_HISTORY);
  return rows.map((row) => row.scheduledKickoffMs);
}

/**
 * Resolve the Weekly Cutoff instant for a Pool Week, or null when the Pool
 * does not use Weekly Cutoff Lock / has no slate.
 */
export async function resolveWeeklyCutoffMs(
  ctx: DbCtx,
  args: {
    pickLockMode: Doc<"pools">["pickLockMode"];
    seasonId: Id<"poolSeasons">;
    week: number;
    games: ReadonlyArray<Pick<Doc<"nflGames">, "scheduledKickoffMs">>;
    nowMs: number;
  },
): Promise<number | null> {
  if (args.pickLockMode !== "weeklyCutoff" || args.games.length === 0) {
    return null;
  }
  const historicalKickoffMs = await loadWeekScheduleHistoryKickoffs(
    ctx,
    args.seasonId,
    args.week,
  );
  return selectWeeklyCutoffMs({
    currentKickoffMs: args.games.map((game) => game.scheduledKickoffMs),
    historicalKickoffMs,
    nowMs: args.nowMs,
  });
}
