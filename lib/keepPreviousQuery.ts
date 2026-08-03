/**
 * Module-level keep-previous cache for warm section navigations.
 * When Board ↔ Standings remount, prewarm usually hits Convex client cache;
 * this covers brief undefined gaps and week/filter switches.
 */

const cache = new Map<string, unknown>();

export function rememberQueryValue<T>(key: string, value: T): void {
  cache.set(key, value);
}

export function peekQueryValue<T>(key: string): T | undefined {
  return cache.get(key) as T | undefined;
}

export function clearQueryValue(key: string): void {
  cache.delete(key);
}

/** Drop all kept values (e.g. on sign-out or account switch). */
export function clearKeepPreviousQuery(): void {
  cache.clear();
}

export function resetKeepPreviousQueryForTests(): void {
  clearKeepPreviousQuery();
}

/**
 * Prefer live query result; fall back to last settled value for the same key.
 * Returns whether we are showing stale/previous data while a new fetch is in flight.
 */
export function resolveKeepPrevious<T>(
  key: string,
  live: T | undefined,
): { value: T | undefined; isPrevious: boolean } {
  if (live !== undefined) {
    rememberQueryValue(key, live);
    return { value: live, isPrevious: false };
  }
  const previous = peekQueryValue<T>(key);
  return { value: previous, isPrevious: previous !== undefined };
}
