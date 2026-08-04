/**
 * Canonical Convex args for `participants.myPools`.
 * Keep every subscriber (page, PoolPicker, prewarm) on this shape so soft
 * navigations hit the client cache instead of refetching under a skeleton.
 */
export function myPoolsQueryArgs(includeArchived = false): {
  includeArchived: boolean;
} {
  return { includeArchived };
}
