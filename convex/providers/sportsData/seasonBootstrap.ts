import * as Effect from "effect/Effect";

import type {
  SportsDataGame,
  SportsDataProvider,
  SportsDataTeam,
} from "./types";

export const SEASON_BOOTSTRAP_STAGE_LIMITS = {
  teams: 40,
  games: 300,
  aliases: 400,
  validationFailureRows: 200,
} as const;

export type SeasonBootstrapSnapshotCounts = Readonly<{
  teams: number;
  games: number;
  teamAliases: number;
  gameAliases: number;
}>;

export function seasonBootstrapSnapshotCounts(
  teams: readonly SportsDataTeam[],
  games: readonly SportsDataGame[],
): SeasonBootstrapSnapshotCounts {
  return {
    teams: teams.length,
    games: games.length,
    teamAliases: teams.reduce(
      (count, team) => count + team.providerAliases.length,
      0,
    ),
    gameAliases: games.reduce(
      (count, game) => count + game.providerAliases.length,
      0,
    ),
  };
}

export function exceedsSeasonBootstrapStageLimits(
  counts: SeasonBootstrapSnapshotCounts,
): boolean {
  return (
    counts.teams > SEASON_BOOTSTRAP_STAGE_LIMITS.teams ||
    counts.games > SEASON_BOOTSTRAP_STAGE_LIMITS.games ||
    counts.teamAliases + counts.gameAliases >
      SEASON_BOOTSTRAP_STAGE_LIMITS.aliases
  );
}

/**
 * Describe the two provider reads needed by Season Bootstrap without executing
 * them. The Convex action/script edge owns execution of this lazy Effect.
 */
export function fetchSeasonBootstrapSnapshot<Error>(
  provider: SportsDataProvider<Error>,
  seasonYear: number,
) {
  return Effect.all(
    {
      teams: provider.listTeams(),
      games: provider.listSeasonGames(seasonYear),
    },
    { concurrency: "unbounded" },
  );
}
