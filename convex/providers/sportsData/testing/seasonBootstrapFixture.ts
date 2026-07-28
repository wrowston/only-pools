import { CANONICAL_NFL_TEAM_LIST } from "../catalog";
import { nflGameStableKey } from "../identity";
import type { SportsDataGame, SportsDataTeam } from "../types";

export const SEASON_BOOTSTRAP_FIXTURE_YEAR = 2026;
export const SEASON_BOOTSTRAP_FIXTURE_OBSERVED_AT_MS = Date.parse(
  "2026-07-01T00:00:00Z",
);

export function completeSeasonBootstrapTeams(): SportsDataTeam[] {
  return CANONICAL_NFL_TEAM_LIST.map((team, index) => ({
    ...team,
    providerAliases: [
      { provider: "api-sports", id: String(10_000 + index) },
    ],
  }));
}

export function completeSeasonBootstrapGames(): SportsDataGame[] {
  const abbreviations = CANONICAL_NFL_TEAM_LIST.map(
    (team) => team.abbreviation,
  );
  const games: SportsDataGame[] = [];
  let rotation = [...abbreviations];

  for (let round = 0; round < 17; round += 1) {
    for (let pairing = 0; pairing < 16; pairing += 1) {
      const first = rotation[pairing]!;
      const second = rotation[rotation.length - 1 - pairing]!;
      const awayTeamAbbreviation =
        (round + pairing) % 2 === 0 ? first : second;
      const homeTeamAbbreviation =
        awayTeamAbbreviation === first ? second : first;
      const week =
        round < 16 ? round + 1 : pairing < 8 ? 17 : 18;
      const stableKey = nflGameStableKey({
        seasonYear: SEASON_BOOTSTRAP_FIXTURE_YEAR,
        week,
        awayTeamAbbreviation,
        homeTeamAbbreviation,
      });
      const gameIndex = games.length;

      games.push({
        stableKey,
        seasonYear: SEASON_BOOTSTRAP_FIXTURE_YEAR,
        week,
        awayTeamAbbreviation,
        homeTeamAbbreviation,
        awayTeamProviderAlias: {
          provider: "api-sports",
          id: String(
            10_000 + abbreviations.indexOf(awayTeamAbbreviation),
          ),
        },
        homeTeamProviderAlias: {
          provider: "api-sports",
          id: String(
            10_000 + abbreviations.indexOf(homeTeamAbbreviation),
          ),
        },
        scheduledKickoffMs:
          Date.parse("2026-09-01T00:00:00Z") +
          week * 7 * 24 * 60 * 60 * 1_000 +
          pairing * 60 * 60 * 1_000,
        lifecycle: "scheduled",
        awayScore: null,
        homeScore: null,
        observedAtMs: SEASON_BOOTSTRAP_FIXTURE_OBSERVED_AT_MS,
        providerAliases: [
          {
            provider: "api-sports",
            id: String(20_000 + gameIndex),
          },
        ],
      });
    }

    rotation = [
      rotation[0]!,
      rotation[rotation.length - 1]!,
      ...rotation.slice(1, -1),
    ];
  }

  return games;
}
