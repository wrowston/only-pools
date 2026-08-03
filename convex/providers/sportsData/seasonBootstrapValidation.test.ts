import { describe, expect, it } from "vitest";

import {
  type CanonicalNflTeamAbbreviation,
} from "./catalog";
import type { SportsDataGame, SportsDataTeam } from "./types";
import {
  completeSeasonBootstrapGames,
  completeSeasonBootstrapTeams,
  SEASON_BOOTSTRAP_FIXTURE_YEAR,
} from "./testing/seasonBootstrapFixture";
import {
  SEASON_BOOTSTRAP_INVARIANTS,
  validateSeasonBootstrap,
} from "./seasonBootstrapValidation";

const seasonYear = SEASON_BOOTSTRAP_FIXTURE_YEAR;
const validTeams = completeSeasonBootstrapTeams;
const validGames = completeSeasonBootstrapGames;

function validate(
  overrides: {
    seasonYear?: number;
    teams?: readonly SportsDataTeam[];
    games?: readonly SportsDataGame[];
  } = {},
) {
  return validateSeasonBootstrap({
    seasonYear: overrides.seasonYear ?? seasonYear,
    sourceProvider: "api-sports",
    teams: overrides.teams ?? validTeams(),
    games: overrides.games ?? validGames(),
  });
}

describe("validateSeasonBootstrap", () => {
  it("accepts a complete snapshot against explicit versioned invariants", () => {
    const report = validate();

    expect(report).toEqual({
      invariantsVersion: SEASON_BOOTSTRAP_INVARIANTS.version,
      valid: true,
      activationEligible: true,
      failuresTruncated: false,
      counts: {
        teams: 32,
        expectedTeams: 32,
        games: 272,
        expectedGames: 272,
        weeks: 18,
        expectedWeeks: 18,
        teamAliases: 32,
        gameAliases: 272,
        failures: 0,
      },
      failures: [],
    });
  });

  it("reports completeness failures with counts and missing weeks", () => {
    const games = validGames().filter((game) => game.week !== 18);
    const report = validate({
      teams: validTeams().slice(0, 31),
      games,
    });

    expect(report.valid).toBe(false);
    expect(report.activationEligible).toBe(false);
    expect(report.counts).toMatchObject({
      teams: 31,
      games: games.length,
      weeks: 17,
    });
    expect(report.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "team_count_mismatch" }),
        expect.objectContaining({
          code: "missing_team_identity",
          entityKey: "WAS",
        }),
        expect.objectContaining({ code: "game_count_mismatch" }),
        expect.objectContaining({
          code: "missing_week",
          entityKey: "18",
        }),
      ]),
    );
  });

  it("rejects unknown, duplicate, missing, and ambiguous team identities without fuzzy matching", () => {
    const teams = validTeams();
    teams[0] = {
      ...teams[0]!,
      abbreviation: "PHX" as CanonicalNflTeamAbbreviation,
    };
    teams[1] = {
      ...teams[1]!,
      stableKey: teams[2]!.stableKey,
    };
    teams[3] = {
      ...teams[3]!,
      providerAliases: [],
    };
    teams[4] = {
      ...teams[4]!,
      providerAliases: teams[5]!.providerAliases,
    };

    const report = validate({ teams });

    expect(report.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "unknown_team_identity",
          entityKey: "PHX",
        }),
        expect.objectContaining({
          code: "ambiguous_team_identity",
        }),
        expect.objectContaining({
          code: "duplicate_team_identity",
        }),
        expect.objectContaining({
          code: "missing_provider_alias",
        }),
        expect.objectContaining({
          code: "ambiguous_provider_alias",
        }),
      ]),
    );
  });

  it("rejects invalid game identity, assignments, weeks, seasons, aliases, and kickoffs", () => {
    const games = validGames();
    games[0] = {
      ...games[0]!,
      homeTeamAbbreviation: games[0]!.awayTeamAbbreviation,
    };
    games[1] = { ...games[1]!, week: 19 };
    games[2] = { ...games[2]!, seasonYear: 2025 };
    games[3] = { ...games[3]!, stableKey: games[4]!.stableKey };
    games[4] = { ...games[4]!, scheduledKickoffMs: Number.NaN };
    games[5] = { ...games[5]!, providerAliases: [] };
    games[6] = {
      ...games[6]!,
      providerAliases: games[7]!.providerAliases,
    };

    const report = validate({ games });

    expect(report.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "same_home_and_away_team" }),
        expect.objectContaining({ code: "invalid_week" }),
        expect.objectContaining({ code: "season_mismatch" }),
        expect.objectContaining({ code: "ambiguous_game_identity" }),
        expect.objectContaining({ code: "duplicate_game_identity" }),
        expect.objectContaining({ code: "invalid_kickoff" }),
        expect.objectContaining({ code: "missing_provider_alias" }),
        expect.objectContaining({
          code: "ambiguous_provider_alias",
        }),
      ]),
    );
  });

  it("rejects a team assigned to more than one NFL Game in a Pool Week", () => {
    const games = validGames();
    games[1] = {
      ...games[1]!,
      awayTeamAbbreviation: games[0]!.awayTeamAbbreviation,
    };

    const report = validate({ games });

    expect(report.failures).toContainEqual(
      expect.objectContaining({
        code: "duplicate_weekly_team_assignment",
        entityKey: `1:${games[0]!.awayTeamAbbreviation}`,
      }),
    );
  });

  it("requires an explicit plausible season year", () => {
    const report = validate({ seasonYear: Number.NaN });

    expect(report.activationEligible).toBe(false);
    expect(report.failures).toContainEqual(
      expect.objectContaining({ code: "invalid_season_year" }),
    );
  });
});
