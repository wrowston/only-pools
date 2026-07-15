/**
 * Confidence Scale and Default Confidence Ranking helpers.
 * Season-wide scale ends at the maximum possible regular-season week games.
 * Under the current 32-team format that maximum is 16.
 */

/** Current NFL regular-season week ceiling (32-team format). */
export const CONFIDENCE_SCALE_MAX = 16;

export const TIEBREAKER_MIN = 0;
export const TIEBREAKER_MAX = 200;

/**
 * Highest N values from the Confidence Scale for a week with N required games.
 * With max 16 and N=14 → [3, 4, …, 16]. Caller assigns descending over Pick Sheet order.
 */
export function confidenceValuesForGameCount(
  gameCount: number,
  scaleMax: number = CONFIDENCE_SCALE_MAX,
): number[] {
  if (gameCount <= 0) {
    return [];
  }
  if (gameCount > scaleMax) {
    throw new Error(
      `Required game count ${gameCount} exceeds Confidence Scale max ${scaleMax}`,
    );
  }
  const lowest = scaleMax - gameCount + 1;
  const values: number[] = [];
  for (let v = lowest; v <= scaleMax; v++) {
    values.push(v);
  }
  return values;
}

/**
 * Default Confidence Ranking: scale max → first Pick Sheet game, then descend.
 * Returns parallel array of confidence values matching pickSheetGameIds order.
 */
export function defaultConfidenceRanking(
  pickSheetGameCount: number,
  scaleMax: number = CONFIDENCE_SCALE_MAX,
): number[] {
  const ascending = confidenceValuesForGameCount(pickSheetGameCount, scaleMax);
  return ascending.slice().reverse();
}

/**
 * Stable Pick Sheet order: chronological kickoff, then stableKey for ties.
 */
export function orderPickSheetGames<
  T extends { scheduledKickoffMs: number; stableKey: string },
>(games: T[]): T[] {
  return games.slice().sort((a, b) => {
    if (a.scheduledKickoffMs !== b.scheduledKickoffMs) {
      return a.scheduledKickoffMs - b.scheduledKickoffMs;
    }
    return a.stableKey.localeCompare(b.stableKey);
  });
}

export function isValidTiebreakerPrediction(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= TIEBREAKER_MIN &&
    value <= TIEBREAKER_MAX
  );
}

/**
 * Validate that `assignment` is a permutation of `allowedValues` (same multiset).
 */
export function isUniqueConfidenceAssignment(
  assignment: number[],
  allowedValues: number[],
): boolean {
  if (assignment.length !== allowedValues.length) {
    return false;
  }
  const sortedAssigned = assignment.slice().sort((a, b) => a - b);
  const sortedAllowed = allowedValues.slice().sort((a, b) => a - b);
  return sortedAssigned.every((v, i) => v === sortedAllowed[i]);
}
