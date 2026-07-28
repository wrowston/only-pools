import type { ApiSportsGame } from "../providers/apiSports";

export const QUALIFICATION_KICKOFF_TOLERANCE_MS = 30 * 60_000;

export type QualificationCandidateRejection =
  | "external_id_mismatch"
  | "season_year_mismatch"
  | "kickoff_mismatch"
  | "identity_mismatch"
  | "home_away_reversal"
  | "phase_mismatch";

/**
 * Validates the normalized game actually returned by API-Sports. The requested
 * alias is never treated as proof that the response describes that game.
 */
export function qualificationCandidateRejection(input: {
  expectedExternalId: string;
  expectedSeasonYear: number;
  expectedKickoffMs: number;
  expectedHomeTeam: string;
  expectedAwayTeam: string;
  game: ApiSportsGame;
}): QualificationCandidateRejection | null {
  const actualAlias = input.game.providerAliases.find(
    (alias) => alias.provider === "api-sports",
  )?.id;
  if (actualAlias !== input.expectedExternalId) {
    return "external_id_mismatch";
  }
  if (input.game.seasonYear !== input.expectedSeasonYear) {
    return "season_year_mismatch";
  }
  if (
    Math.abs(
      input.game.scheduledKickoffMs - input.expectedKickoffMs,
    ) > QUALIFICATION_KICKOFF_TOLERANCE_MS
  ) {
    return "kickoff_mismatch";
  }
  if (
    input.game.homeTeamAbbreviation === input.expectedAwayTeam &&
    input.game.awayTeamAbbreviation === input.expectedHomeTeam
  ) {
    return "home_away_reversal";
  }
  if (
    input.game.homeTeamAbbreviation !== input.expectedHomeTeam ||
    input.game.awayTeamAbbreviation !== input.expectedAwayTeam
  ) {
    return "identity_mismatch";
  }
  if (input.game.seasonPhase !== "preseason") {
    return "phase_mismatch";
  }
  return null;
}
