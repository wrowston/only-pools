/**
 * Weekly Cutoff Lock resolution — anchors on schedule history so postponing
 * the current earliest kickoff after Sunday 1pm ET cannot reopen locks.
 */

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  computeWeeklyCutoffMs,
  weeklyCutoffAnchorMs,
} from "./pickLock";

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
  const anchorMs = weeklyCutoffAnchorMs(
    args.games.map((game) => game.scheduledKickoffMs),
    historicalKickoffMs,
  );
  return anchorMs === null ? null : computeWeeklyCutoffMs(anchorMs);
}
