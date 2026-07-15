/**
 * Season Bootstrap availability: Pool Season becomes Available only after
 * schedule sync produced ≥1 usable Start Week slate (a regular-season week
 * with at least one NFL Game).
 */

export type BootstrapGameInput = {
  week: number;
  scheduledKickoffMs: number;
  lifecycle: string;
};

export type BootstrapAvailabilityResult = {
  status: "bootstrapping" | "available";
  usableStartWeek: number | null;
  reason: "usable_start_week" | "no_usable_start_week";
};

/**
 * A usable Start Week slate is the earliest regular-season week that has
 * at least one NFL Game after bootstrap sync.
 */
export function evaluateBootstrapAvailability(
  games: BootstrapGameInput[],
  _nowMs: number,
): BootstrapAvailabilityResult {
  const weeksWithGames = new Set<number>();
  for (const g of games) {
    if (g.week >= 1 && g.week <= 18) {
      weeksWithGames.add(g.week);
    }
  }

  if (weeksWithGames.size === 0) {
    return {
      status: "bootstrapping",
      usableStartWeek: null,
      reason: "no_usable_start_week",
    };
  }

  const usableStartWeek = Math.min(...weeksWithGames);
  return {
    status: "available",
    usableStartWeek,
    reason: "usable_start_week",
  };
}
