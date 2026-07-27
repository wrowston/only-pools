import {
  CANONICAL_NFL_TEAMS,
  type CanonicalNflTeamAbbreviation,
  type NflTeamStableKey,
} from "./catalog";
import type { NflGameStableKey } from "./types";

export function nflTeamStableKey<
  Abbreviation extends CanonicalNflTeamAbbreviation,
>(abbreviation: Abbreviation): NflTeamStableKey {
  return CANONICAL_NFL_TEAMS[abbreviation].stableKey;
}

/**
 * Kickoff times and provider aliases intentionally do not participate in NFL
 * Game identity, so reschedules and provider record replacements preserve it.
 */
export function nflGameStableKey(input: {
  seasonYear: number;
  week: number;
  awayTeamAbbreviation: CanonicalNflTeamAbbreviation;
  homeTeamAbbreviation: CanonicalNflTeamAbbreviation;
}): NflGameStableKey {
  const awayTeamStableKey = nflTeamStableKey(input.awayTeamAbbreviation).slice(
    "nfl-team:".length,
  ) as `franchise-${number}`;
  const homeTeamStableKey = nflTeamStableKey(input.homeTeamAbbreviation).slice(
    "nfl-team:".length,
  ) as `franchise-${number}`;
  return `nfl-game:${input.seasonYear}:w${input.week}:${awayTeamStableKey}@${homeTeamStableKey}`;
}
