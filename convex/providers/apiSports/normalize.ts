import * as Effect from "effect/Effect";

import { ApiSportsDecodeError } from "../../effect/errors";
import type {
  ApiSportsGameWire,
  ApiSportsTeamWire,
} from "../../effect/apiSports/schemas";
import {
  CANONICAL_NFL_TEAM_LIST,
  CANONICAL_NFL_TEAMS,
  type CanonicalNflTeamAbbreviation,
} from "../sportsData/catalog";
import { nflGameStableKey } from "../sportsData/identity";
import type {
  NflGameLifecycle,
  SportsDataGame,
  SportsDataTeam,
} from "../sportsData/types";

export type ApiSportsStatusObservation = Readonly<{
  rawShort: string;
  rawLong: string;
  recognized: boolean;
  terminal: boolean;
}>;

export type ApiSportsGame = SportsDataGame &
  Readonly<{
    providerStatus: ApiSportsStatusObservation;
    providerStage: string;
    seasonPhase:
      | "preseason"
      | "regular_season"
      | "postseason"
      | "unknown";
  }>;

const abbreviationsByName = new Map(
  CANONICAL_NFL_TEAM_LIST.map((team) => [
    team.name.toLowerCase(),
    team.abbreviation,
  ]),
);

const providerCodeAliases: Readonly<
  Record<string, CanonicalNflTeamAbbreviation>
> = {
  JAC: "JAX",
  KC: "KC",
  LA: "LAR",
  OAK: "LV",
  SD: "LAC",
  STL: "LAR",
  WSH: "WAS",
};

function teamCodeAbbreviation(
  team: Pick<ApiSportsTeamWire, "code">,
): CanonicalNflTeamAbbreviation | null {
  const code = team.code?.trim().toUpperCase();
  if (!code) return null;
  if (code in CANONICAL_NFL_TEAMS) {
    return code as CanonicalNflTeamAbbreviation;
  }
  return providerCodeAliases[code] ?? null;
}

function gameTeamAbbreviation(
  team: ApiSportsGameWire["teams"]["home"],
): CanonicalNflTeamAbbreviation | null {
  const name = team.name?.trim().toLowerCase();
  return name ? abbreviationsByName.get(name) ?? null : null;
}

function poolWeek(rawWeek: string): number | null {
  const matches = [...rawWeek.matchAll(/\d+/g)];
  const candidate = matches.at(-1)?.[0];
  if (!candidate) return null;
  const week = Number(candidate);
  return Number.isInteger(week) && week >= 1 && week <= 18 ? week : null;
}

function seasonYear(rawSeason: string | number): number | null {
  const season = Number(rawSeason);
  return Number.isInteger(season) && season >= 2000 && season <= 3000
    ? season
    : null;
}

function seasonPhase(
  rawStage: string,
): ApiSportsGame["seasonPhase"] {
  const normalized = rawStage.trim().toLowerCase();
  if (normalized === "pre season" || normalized === "preseason") {
    return "preseason";
  }
  if (normalized === "regular season") return "regular_season";
  if (normalized === "post season" || normalized === "postseason") {
    return "postseason";
  }
  return "unknown";
}

function statusObservation(
  rawShort: string,
  rawLong: string,
): {
  lifecycle: NflGameLifecycle;
  providerStatus: ApiSportsStatusObservation;
} {
  const short = rawShort.trim().toUpperCase();
  let lifecycle: NflGameLifecycle;

  switch (short) {
    case "NS":
      lifecycle = "scheduled";
      break;
    case "Q1":
    case "Q2":
    case "HT":
    case "Q3":
    case "Q4":
    case "OT":
    case "BT":
      lifecycle = "in_progress";
      break;
    case "INT":
    case "SUSP":
      lifecycle = "interrupted";
      break;
    case "PST":
    case "POST":
      lifecycle = "postponed";
      break;
    case "CANC":
    case "CAN":
    case "ABD":
      lifecycle = "canceled";
      break;
    case "FT":
    case "AOT":
      lifecycle = "terminal";
      break;
    default:
      return {
        lifecycle: "unknown",
        providerStatus: {
          rawShort,
          rawLong,
          recognized: false,
          terminal: false,
        },
      };
  }

  return {
    lifecycle,
    providerStatus: {
      rawShort,
      rawLong,
      recognized: true,
      terminal: lifecycle === "terminal" || lifecycle === "canceled",
    },
  };
}

export function normalizeApiSportsTeams(
  rows: readonly ApiSportsTeamWire[],
  options: {
    mode?: "strict" | "bootstrap-candidates";
  } = {},
): Effect.Effect<readonly SportsDataTeam[], ApiSportsDecodeError> {
  return Effect.gen(function* () {
    const mode = options.mode ?? "strict";
    const teams = new Map<
      CanonicalNflTeamAbbreviation,
      SportsDataTeam
    >();
    const candidates: SportsDataTeam[] = [];

    for (const row of rows) {
      const byName =
        abbreviationsByName.get(row.name.trim().toLowerCase()) ?? null;
      const byCode = teamCodeAbbreviation(row);
      if (byName !== null && byCode !== null && byName !== byCode) {
        return yield* new ApiSportsDecodeError({
          endpoint: "/teams",
          detail: `NFL Team ${row.id} has conflicting deterministic aliases: name maps to ${byName}, code maps to ${byCode}`,
        });
      }
      const abbreviation = byName ?? byCode;
      if (abbreviation === null) {
        return yield* new ApiSportsDecodeError({
          endpoint: "/teams",
          detail: `NFL Team ${row.id} has no approved deterministic alias`,
        });
      }

      const team: SportsDataTeam = {
        ...CANONICAL_NFL_TEAMS[abbreviation],
        providerAliases: [
          { provider: "api-sports", id: String(row.id) },
        ],
      };
      candidates.push(team);
      if (!teams.has(abbreviation)) {
        teams.set(abbreviation, team);
      }
    }

    if (mode === "bootstrap-candidates") {
      return candidates;
    }

    if (teams.size !== CANONICAL_NFL_TEAM_LIST.length) {
      return yield* new ApiSportsDecodeError({
        endpoint: "/teams",
        detail: `expected 32 current NFL Teams, normalized ${teams.size}`,
      });
    }

    return CANONICAL_NFL_TEAM_LIST.map((team) => teams.get(team.abbreviation)!);
  });
}

export function normalizeApiSportsGame(
  row: ApiSportsGameWire,
  observedAtMs: number,
): Effect.Effect<ApiSportsGame, ApiSportsDecodeError> {
  return Effect.gen(function* () {
    const season = seasonYear(row.league.season);
    const week = poolWeek(row.game.week);
    const homeTeamAbbreviation = gameTeamAbbreviation(row.teams.home);
    const awayTeamAbbreviation = gameTeamAbbreviation(row.teams.away);
    const scheduledKickoffMs = row.game.date.timestamp * 1_000;

    if (
      row.league.id !== 1 ||
      season === null ||
      week === null ||
      homeTeamAbbreviation === null ||
      awayTeamAbbreviation === null ||
      !Number.isSafeInteger(scheduledKickoffMs)
    ) {
      return yield* new ApiSportsDecodeError({
        endpoint: "/games",
        detail: `NFL Game ${row.game.id} could not be normalized`,
      });
    }

    const { lifecycle, providerStatus } = statusObservation(
      row.game.status.short,
      row.game.status.long,
    );
    return {
      stableKey: nflGameStableKey({
        seasonYear: season,
        week,
        homeTeamAbbreviation,
        awayTeamAbbreviation,
      }),
      seasonYear: season,
      week,
      homeTeamAbbreviation,
      awayTeamAbbreviation,
      homeTeamProviderAlias: {
        provider: "api-sports",
        id: String(row.teams.home.id),
      },
      awayTeamProviderAlias: {
        provider: "api-sports",
        id: String(row.teams.away.id),
      },
      scheduledKickoffMs,
      lifecycle,
      homeScore: row.scores.home.total,
      awayScore: row.scores.away.total,
      observedAtMs,
      providerAliases: [
        { provider: "api-sports", id: String(row.game.id) },
      ],
      providerStage: row.game.stage.trim(),
      seasonPhase: seasonPhase(row.game.stage),
      providerStatus,
    };
  });
}

export function normalizeApiSportsGames(
  rows: readonly ApiSportsGameWire[],
  observedAtMs: number,
): Effect.Effect<readonly ApiSportsGame[], ApiSportsDecodeError> {
  const usableRows = rows.filter(
    (row) =>
      row.teams.home.name !== null &&
      row.teams.away.name !== null,
  );
  return Effect.all(
    usableRows.map((row) =>
      normalizeApiSportsGame(row, observedAtMs),
    ),
    { concurrency: "unbounded" },
  );
}
