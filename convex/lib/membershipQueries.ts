import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { MAX_MEMBERSHIPS_PER_SEASON, MAX_POOL_ENTRIES } from "./quotas";

type DbCtx = QueryCtx | MutationCtx;

/**
 * Safety ceiling for scanning a participant's active memberships across
 * seasons. 40 seasons × per-season cap covers long-lived accounts without
 * reintroducing silent truncation from inactive (left/removed) rows.
 */
export const MAX_ACTIVE_MEMBERSHIPS_SCAN = MAX_MEMBERSHIPS_PER_SEASON * 40;

/**
 * Active memberships for a participant (all seasons). Status-scoped so
 * left/removed history cannot push live rows out of a bounded take window.
 */
export async function listActiveMembershipsForParticipant(
  ctx: DbCtx,
  participantId: Id<"participants">,
): Promise<Doc<"poolMemberships">[]> {
  return await ctx.db
    .query("poolMemberships")
    .withIndex("by_participantId_and_status", (q) =>
      q.eq("participantId", participantId).eq("status", "active"),
    )
    .take(MAX_ACTIVE_MEMBERSHIPS_SCAN);
}

/**
 * Count active memberships for one Pool Season. Prior-season actives and
 * left/removed rows must not undercount the current season quota.
 */
export async function countActiveSeasonMemberships(
  ctx: DbCtx,
  participantId: Id<"participants">,
  seasonId: Id<"poolSeasons">,
): Promise<number> {
  const active = await listActiveMembershipsForParticipant(ctx, participantId);
  let count = 0;
  for (const row of active) {
    const pool = await ctx.db.get(row.poolId);
    if (pool && pool.seasonId === seasonId) {
      count += 1;
    }
  }
  return count;
}

/**
 * Active memberships in one Pool — used for per-user entry-cap checks so
 * left/removed churn cannot hide a live member above the proposed max.
 */
export async function listActiveMembershipsForPool(
  ctx: DbCtx,
  poolId: Id<"pools">,
): Promise<Doc<"poolMemberships">[]> {
  return await ctx.db
    .query("poolMemberships")
    .withIndex("by_poolId_and_status", (q) =>
      q.eq("poolId", poolId).eq("status", "active"),
    )
    .take(MAX_POOL_ENTRIES);
}

/**
 * All membership rows for a Pool (active + removed + left). Uses collect so
 * admission churn beyond MAX_POOL_ENTRIES cannot hide members from the panel.
 * (Convex allows only one `.paginate()` per function, so multi-page loops are
 * not available here.)
 */
export async function listAllMembershipsForPool(
  ctx: DbCtx,
  poolId: Id<"pools">,
): Promise<Doc<"poolMemberships">[]> {
  return await ctx.db
    .query("poolMemberships")
    .withIndex("by_poolId", (q) => q.eq("poolId", poolId))
    .collect();
}
