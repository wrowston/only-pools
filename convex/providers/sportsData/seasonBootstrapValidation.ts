import {
  CANONICAL_NFL_TEAM_ABBREVIATIONS,
  CANONICAL_NFL_TEAMS,
  type CanonicalNflTeamAbbreviation,
} from "./catalog";
import { nflGameStableKey } from "./identity";
import type {
  SportsDataGame,
  SportsDataProviderName,
  SportsDataTeam,
} from "./types";

export const SEASON_BOOTSTRAP_INVARIANTS = {
  version: "nfl-regular-season-v1",
  teamCount: 32,
  regularSeasonGameCount: 272,
  weeks: Object.freeze(
    Array.from({ length: 18 }, (_, index) => index + 1),
  ),
} as const;

export type SeasonBootstrapValidationFailureCode =
  | "invalid_season_year"
  | "provider_configuration_failure"
  | "provider_fetch_failure"
  | "provider_snapshot_too_large"
  | "validation_report_truncated"
  | "team_count_mismatch"
  | "game_count_mismatch"
  | "missing_week"
  | "invalid_week"
  | "season_mismatch"
  | "missing_team_identity"
  | "unknown_team_identity"
  | "duplicate_team_identity"
  | "ambiguous_team_identity"
  | "missing_game_identity"
  | "duplicate_game_identity"
  | "ambiguous_game_identity"
  | "duplicate_weekly_team_assignment"
  | "same_home_and_away_team"
  | "invalid_kickoff"
  | "missing_provider_alias"
  | "unknown_provider_alias"
  | "duplicate_provider_alias"
  | "ambiguous_provider_alias";

export type SeasonBootstrapValidationFailure = Readonly<{
  code: SeasonBootstrapValidationFailureCode;
  scope: "season" | "team" | "game" | "alias";
  entityKey?: string;
  message: string;
}>;

export type SeasonBootstrapValidationReport = Readonly<{
  invariantsVersion: typeof SEASON_BOOTSTRAP_INVARIANTS.version;
  valid: boolean;
  /**
   * Ticket #36 may activate only snapshots for which this persisted flag is
   * true. Ticket #35 never activates a snapshot itself.
   */
  activationEligible: boolean;
  /** True when only the bounded leading subset of failures is returned/stored. */
  failuresTruncated: boolean;
  counts: Readonly<{
    teams: number;
    expectedTeams: number;
    games: number;
    expectedGames: number;
    weeks: number;
    expectedWeeks: number;
    teamAliases: number;
    gameAliases: number;
    failures: number;
  }>;
  failures: readonly SeasonBootstrapValidationFailure[];
}>;

type ValidationInput = Readonly<{
  seasonYear: number;
  sourceProvider: SportsDataProviderName;
  teams: readonly SportsDataTeam[];
  games: readonly SportsDataGame[];
}>;

type AliasOwner = Readonly<{
  entityKey: string;
  occurrence: number;
}>;

function addFailure(
  failures: SeasonBootstrapValidationFailure[],
  failure: SeasonBootstrapValidationFailure,
): void {
  failures.push(failure);
}

function canonicalAbbreviation(
  value: string,
): CanonicalNflTeamAbbreviation | null {
  return Object.prototype.hasOwnProperty.call(CANONICAL_NFL_TEAMS, value)
    ? (value as CanonicalNflTeamAbbreviation)
    : null;
}

function validateProviderAliases(input: {
  sourceProvider: SportsDataProviderName;
  entityKey: string;
  scope: "team" | "game";
  aliases: readonly Readonly<{
    provider: SportsDataProviderName;
    id: string;
  }>[];
  ownersByAlias: Map<string, AliasOwner>;
  failures: SeasonBootstrapValidationFailure[];
}): number {
  let matchingAliasCount = 0;
  const aliasesOnEntity = new Set<string>();

  for (const alias of input.aliases) {
    const id = alias.id.trim();
    if (alias.provider !== input.sourceProvider) {
      addFailure(input.failures, {
        code: "unknown_provider_alias",
        scope: "alias",
        entityKey: input.entityKey,
        message: `${input.scope} ${input.entityKey} has alias for unapproved provider ${alias.provider}`,
      });
      continue;
    }
    if (id.length === 0) {
      addFailure(input.failures, {
        code: "missing_provider_alias",
        scope: "alias",
        entityKey: input.entityKey,
        message: `${input.scope} ${input.entityKey} has an empty ${input.sourceProvider} alias`,
      });
      continue;
    }

    matchingAliasCount += 1;
    const aliasKey = `${alias.provider}:${id}`;
    if (aliasesOnEntity.has(aliasKey)) {
      addFailure(input.failures, {
        code: "duplicate_provider_alias",
        scope: "alias",
        entityKey: input.entityKey,
        message: `${input.scope} ${input.entityKey} repeats provider alias ${aliasKey}`,
      });
      continue;
    }
    aliasesOnEntity.add(aliasKey);

    const existing = input.ownersByAlias.get(aliasKey);
    if (existing && existing.entityKey !== input.entityKey) {
      addFailure(input.failures, {
        code: "ambiguous_provider_alias",
        scope: "alias",
        entityKey: aliasKey,
        message: `Provider alias ${aliasKey} identifies both ${existing.entityKey} and ${input.entityKey}`,
      });
      continue;
    }
    input.ownersByAlias.set(aliasKey, {
      entityKey: input.entityKey,
      occurrence: (existing?.occurrence ?? 0) + 1,
    });
  }

  if (matchingAliasCount === 0) {
    addFailure(input.failures, {
      code: "missing_provider_alias",
      scope: "alias",
      entityKey: input.entityKey,
      message: `${input.scope} ${input.entityKey} has no approved ${input.sourceProvider} alias`,
    });
  }

  return matchingAliasCount;
}

function validateTeams(
  input: ValidationInput,
  failures: SeasonBootstrapValidationFailure[],
): number {
  const seenAbbreviations = new Map<string, number>();
  const seenStableKeys = new Map<string, number>();
  const ownersByAlias = new Map<string, AliasOwner>();
  let aliasCount = 0;

  for (const team of input.teams) {
    const abbreviation = String(team.abbreviation);
    const stableKey = String(team.stableKey);
    const canonical = canonicalAbbreviation(abbreviation);

    if (abbreviation.trim().length === 0 || stableKey.trim().length === 0) {
      addFailure(failures, {
        code: "missing_team_identity",
        scope: "team",
        entityKey: abbreviation || stableKey || "(missing)",
        message: "Staged NFL Team is missing its canonical identity",
      });
    } else if (canonical === null) {
      addFailure(failures, {
        code: "unknown_team_identity",
        scope: "team",
        entityKey: abbreviation,
        message: `NFL Team abbreviation ${abbreviation} is not an approved deterministic alias`,
      });
    } else if (CANONICAL_NFL_TEAMS[canonical].stableKey !== stableKey) {
      addFailure(failures, {
        code: "ambiguous_team_identity",
        scope: "team",
        entityKey: `${abbreviation}:${stableKey}`,
        message: `NFL Team ${abbreviation} conflicts with canonical stable key ${stableKey}`,
      });
    }

    const abbreviationCount =
      (seenAbbreviations.get(abbreviation) ?? 0) + 1;
    seenAbbreviations.set(abbreviation, abbreviationCount);
    if (abbreviationCount === 2) {
      addFailure(failures, {
        code: "duplicate_team_identity",
        scope: "team",
        entityKey: abbreviation,
        message: `Canonical NFL Team abbreviation ${abbreviation} appears more than once`,
      });
    }

    const stableKeyCount = (seenStableKeys.get(stableKey) ?? 0) + 1;
    seenStableKeys.set(stableKey, stableKeyCount);
    if (stableKeyCount === 2) {
      addFailure(failures, {
        code: "duplicate_team_identity",
        scope: "team",
        entityKey: stableKey,
        message: `Canonical NFL Team stable key ${stableKey} appears more than once`,
      });
    }

    aliasCount += validateProviderAliases({
      sourceProvider: input.sourceProvider,
      entityKey: stableKey || abbreviation || "(missing)",
      scope: "team",
      aliases: team.providerAliases,
      ownersByAlias,
      failures,
    });
  }

  for (const abbreviation of CANONICAL_NFL_TEAM_ABBREVIATIONS) {
    if (!seenAbbreviations.has(abbreviation)) {
      addFailure(failures, {
        code: "missing_team_identity",
        scope: "team",
        entityKey: abbreviation,
        message: `Canonical NFL Team ${abbreviation} is missing from the staged snapshot`,
      });
    }
  }

  return aliasCount;
}

function validateGames(
  input: ValidationInput,
  failures: SeasonBootstrapValidationFailure[],
): { aliasCount: number; weekCount: number } {
  const seenGameKeys = new Map<string, number>();
  const gameByWeekAndTeam = new Map<string, string>();
  const ownersByAlias = new Map<string, AliasOwner>();
  const teamAbbreviationsByAlias = new Map<string, Set<string>>();
  for (const team of input.teams) {
    for (const alias of team.providerAliases) {
      if (alias.provider !== input.sourceProvider) continue;
      const aliasKey = `${alias.provider}:${alias.id.trim()}`;
      const owners =
        teamAbbreviationsByAlias.get(aliasKey) ?? new Set<string>();
      owners.add(String(team.abbreviation));
      teamAbbreviationsByAlias.set(aliasKey, owners);
    }
  }
  const validWeeks = new Set<number>();
  let aliasCount = 0;
  const validSeason = isSeasonBootstrapYear(input.seasonYear);
  const earliestKickoffMs = validSeason
    ? Date.UTC(input.seasonYear, 6, 1)
    : Number.NaN;
  const latestKickoffMs = validSeason
    ? Date.UTC(input.seasonYear + 1, 2, 1)
    : Number.NaN;

  for (const game of input.games) {
    const stableKey = String(game.stableKey);
    const home = canonicalAbbreviation(
      String(game.homeTeamAbbreviation),
    );
    const away = canonicalAbbreviation(
      String(game.awayTeamAbbreviation),
    );

    if (stableKey.trim().length === 0) {
      addFailure(failures, {
        code: "missing_game_identity",
        scope: "game",
        entityKey: "(missing)",
        message: "Staged NFL Game is missing its canonical stable key",
      });
    }

    const stableKeyCount = (seenGameKeys.get(stableKey) ?? 0) + 1;
    seenGameKeys.set(stableKey, stableKeyCount);
    if (stableKeyCount === 2) {
      addFailure(failures, {
        code: "duplicate_game_identity",
        scope: "game",
        entityKey: stableKey,
        message: `Canonical NFL Game identity ${stableKey} appears more than once`,
      });
    }

    if (game.seasonYear !== input.seasonYear) {
      addFailure(failures, {
        code: "season_mismatch",
        scope: "game",
        entityKey: stableKey,
        message: `NFL Game ${stableKey} belongs to ${game.seasonYear}, not requested season ${input.seasonYear}`,
      });
    }

    if (!Number.isSafeInteger(game.week) || game.week < 1 || game.week > 18) {
      addFailure(failures, {
        code: "invalid_week",
        scope: "game",
        entityKey: stableKey,
        message: `NFL Game ${stableKey} has invalid regular-season Pool Week ${game.week}`,
      });
    } else {
      validWeeks.add(game.week);
    }

    if (home === null || away === null) {
      addFailure(failures, {
        code: "unknown_team_identity",
        scope: "game",
        entityKey: stableKey,
        message: `NFL Game ${stableKey} references an unknown canonical NFL Team`,
      });
    } else {
      for (const [side, abbreviation, alias] of [
        ["home", home, game.homeTeamProviderAlias],
        ["away", away, game.awayTeamProviderAlias],
      ] as const) {
        if (!alias || alias.id.trim().length === 0) {
          addFailure(failures, {
            code: "missing_provider_alias",
            scope: "game",
            entityKey: `${stableKey}:${side}`,
            message: `NFL Game ${stableKey} is missing ${side} NFL Team provider identity evidence`,
          });
          continue;
        }
        const aliasKey = `${alias.provider}:${alias.id.trim()}`;
        if (alias.provider !== input.sourceProvider) {
          addFailure(failures, {
            code: "unknown_provider_alias",
            scope: "game",
            entityKey: `${stableKey}:${side}`,
            message: `NFL Game ${stableKey} has ${side} NFL Team identity from unapproved provider ${alias.provider}`,
          });
          continue;
        }
        const owners = teamAbbreviationsByAlias.get(aliasKey);
        if (!owners) {
          addFailure(failures, {
            code: "unknown_team_identity",
            scope: "game",
            entityKey: `${stableKey}:${side}:${aliasKey}`,
            message: `NFL Game ${stableKey} ${side} provider alias ${aliasKey} does not identify a staged NFL Team`,
          });
        } else if (owners.size !== 1 || !owners.has(abbreviation)) {
          addFailure(failures, {
            code: "ambiguous_team_identity",
            scope: "game",
            entityKey: `${stableKey}:${side}:${aliasKey}`,
            message: `NFL Game ${stableKey} says ${abbreviation} is ${side}, but provider alias ${aliasKey} identifies ${[...owners].join(", ")}`,
          });
        }
      }

      if (home === away) {
        addFailure(failures, {
          code: "same_home_and_away_team",
          scope: "game",
          entityKey: stableKey,
          message: `NFL Game ${stableKey} assigns ${home} as both home and away`,
        });
      } else if (
        Number.isSafeInteger(game.week) &&
        game.week >= 1 &&
        game.week <= 18
      ) {
        for (const abbreviation of [home, away]) {
          const teamWeekKey = `${game.week}:${abbreviation}`;
          const existingGameKey =
            gameByWeekAndTeam.get(teamWeekKey);
          if (existingGameKey) {
            addFailure(failures, {
              code: "duplicate_weekly_team_assignment",
              scope: "game",
              entityKey: teamWeekKey,
              message: `NFL Team ${abbreviation} appears in both ${existingGameKey} and ${stableKey} during Pool Week ${game.week}`,
            });
          } else {
            gameByWeekAndTeam.set(teamWeekKey, stableKey);
          }
        }
      }
      if (
        validSeason &&
        Number.isSafeInteger(game.week) &&
        game.week >= 1 &&
        game.week <= 18
      ) {
        const expectedStableKey = nflGameStableKey({
          seasonYear: input.seasonYear,
          week: game.week,
          homeTeamAbbreviation: home,
          awayTeamAbbreviation: away,
        });
        if (expectedStableKey !== stableKey) {
          addFailure(failures, {
            code: "ambiguous_game_identity",
            scope: "game",
            entityKey: stableKey,
            message: `NFL Game stable key ${stableKey} conflicts with canonical identity ${expectedStableKey}`,
          });
        }
      }
    }

    if (
      !Number.isSafeInteger(game.scheduledKickoffMs) ||
      game.scheduledKickoffMs < earliestKickoffMs ||
      game.scheduledKickoffMs >= latestKickoffMs
    ) {
      addFailure(failures, {
        code: "invalid_kickoff",
        scope: "game",
        entityKey: stableKey,
        message: `NFL Game ${stableKey} has incoherent kickoff ${String(game.scheduledKickoffMs)}`,
      });
    }

    aliasCount += validateProviderAliases({
      sourceProvider: input.sourceProvider,
      entityKey: stableKey || "(missing)",
      scope: "game",
      aliases: game.providerAliases,
      ownersByAlias,
      failures,
    });
  }

  for (const week of SEASON_BOOTSTRAP_INVARIANTS.weeks) {
    if (!validWeeks.has(week)) {
      addFailure(failures, {
        code: "missing_week",
        scope: "season",
        entityKey: String(week),
        message: `Regular-season Pool Week ${week} is missing from the staged snapshot`,
      });
    }
  }

  return { aliasCount, weekCount: validWeeks.size };
}

export function validateSeasonBootstrap(
  input: ValidationInput,
): SeasonBootstrapValidationReport {
  const failures: SeasonBootstrapValidationFailure[] = [];

  if (!isSeasonBootstrapYear(input.seasonYear)) {
    addFailure(failures, {
      code: "invalid_season_year",
      scope: "season",
      entityKey: String(input.seasonYear),
      message:
        "Season Bootstrap requires an explicit NFL season year between 2000 and 3000",
    });
  }

  if (input.teams.length !== SEASON_BOOTSTRAP_INVARIANTS.teamCount) {
    addFailure(failures, {
      code: "team_count_mismatch",
      scope: "season",
      message: `Expected ${SEASON_BOOTSTRAP_INVARIANTS.teamCount} NFL Teams, received ${input.teams.length}`,
    });
  }
  if (
    input.games.length !==
    SEASON_BOOTSTRAP_INVARIANTS.regularSeasonGameCount
  ) {
    addFailure(failures, {
      code: "game_count_mismatch",
      scope: "season",
      message: `Expected ${SEASON_BOOTSTRAP_INVARIANTS.regularSeasonGameCount} regular-season NFL Games, received ${input.games.length}`,
    });
  }

  const teamAliases = validateTeams(input, failures);
  const games = validateGames(input, failures);
  const valid = failures.length === 0;

  return {
    invariantsVersion: SEASON_BOOTSTRAP_INVARIANTS.version,
    valid,
    activationEligible: valid,
    failuresTruncated: false,
    counts: {
      teams: input.teams.length,
      expectedTeams: SEASON_BOOTSTRAP_INVARIANTS.teamCount,
      games: input.games.length,
      expectedGames:
        SEASON_BOOTSTRAP_INVARIANTS.regularSeasonGameCount,
      weeks: games.weekCount,
      expectedWeeks: SEASON_BOOTSTRAP_INVARIANTS.weeks.length,
      teamAliases,
      gameAliases: games.aliasCount,
      failures: failures.length,
    },
    failures,
  };
}

export function isSeasonBootstrapYear(seasonYear: number): boolean {
  return (
    Number.isSafeInteger(seasonYear) &&
    seasonYear >= 2000 &&
    seasonYear <= 3000
  );
}
