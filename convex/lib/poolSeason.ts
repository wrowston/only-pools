/** Legacy Pool Seasons are regular season unless explicitly marked otherwise. */
export function isRegularPoolSeason(season: {
  competitionPhase?: "regular_season" | "preseason";
}): boolean {
  return season.competitionPhase !== "preseason";
}

