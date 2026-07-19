/** Quotas from CONTEXT / multi-entry pool plan. */
export const MAX_OWNED_POOLS = 10;
export const MAX_MEMBERSHIPS_PER_SEASON = 50;
/** @deprecated Prefer MAX_POOL_ENTRIES — pool capacity is entry-shaped. */
export const MAX_POOL_MEMBERS = 100;
/** Hard cap on active competitive entries in one Pool. */
export const MAX_POOL_ENTRIES = 2000;
/** Hard ceiling for owner-configured max entries per participant. */
export const MAX_ENTRIES_PER_USER = 10;

export function effectiveMaxEntriesPerUser(
  maxEntriesPerUser: number | undefined,
): number {
  if (maxEntriesPerUser === undefined) return 1;
  return maxEntriesPerUser;
}
