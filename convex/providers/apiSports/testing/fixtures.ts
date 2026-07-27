import type { SportsDataContractFixture } from "../../sportsData/testing/contract";

const quotaHeaders = {
  "x-ratelimit-requests-limit": "7500",
  "x-ratelimit-requests-remaining": "7375",
  "x-ratelimit-limit": "300",
  "x-ratelimit-remaining": "298",
};

function statusFor(lifecycle: string): { short: string; long: string } {
  switch (lifecycle) {
    case "scheduled":
      return { short: "NS", long: "Not Started" };
    case "in_progress":
      return { short: "Q2", long: "Second Quarter" };
    case "interrupted":
      return { short: "INT", long: "Interrupted" };
    case "postponed":
      return { short: "PST", long: "Postponed" };
    case "canceled":
      return { short: "CANC", long: "Cancelled" };
    case "terminal":
      return { short: "FT", long: "Finished" };
    default:
      return { short: "FIXTURE_NEW", long: "Fixture New Status" };
  }
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: quotaHeaders,
  });
}

/**
 * Sanitized API-Sports-shaped responses for the shared provider contract.
 * Values are synthetic and the supplied fetch never performs network I/O.
 */
export function createSanitizedApiSportsFetch(
  fixture: SportsDataContractFixture,
): typeof fetch {
  const gameIds = new Map(
    fixture.games.map((game, index) => [
      game.providerAliases[0]?.id ?? `game-${index + 1}`,
      String(
        Number.isSafeInteger(Number(game.providerAliases[0]?.id))
          ? Number(game.providerAliases[0]?.id)
          : 10_001 + index,
      ),
    ]),
  );
  const gameRows = fixture.games.map((game, index) => ({
    game: {
      id: Number(gameIds.get(game.providerAliases[0]?.id ?? "") ?? 10_001 + index),
      stage: "Regular Season",
      week: `Week ${game.week}`,
      date: { timestamp: game.scheduledKickoffMs / 1_000 },
      status: statusFor(game.lifecycle),
    },
    league: {
      id: 1,
      season: String(game.seasonYear),
    },
    teams: {
      home: {
        id:
          fixture.teams.findIndex(
            (team) => team.abbreviation === game.homeTeamAbbreviation,
          ) + 1,
        name:
          fixture.teams.find(
            (team) => team.abbreviation === game.homeTeamAbbreviation,
          )?.name ?? game.homeTeamAbbreviation,
      },
      away: {
        id:
          fixture.teams.findIndex(
            (team) => team.abbreviation === game.awayTeamAbbreviation,
          ) + 1,
        name:
          fixture.teams.find(
            (team) => team.abbreviation === game.awayTeamAbbreviation,
          )?.name ?? game.awayTeamAbbreviation,
      },
    },
    scores: {
      home: { total: game.homeScore },
      away: { total: game.awayScore },
    },
  }));

  return (async (input) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input
          : input.url,
    );

    if (url.pathname === "/teams") {
      return json({
        errors: [],
        response: fixture.teams.map((team, index) => ({
          id: Number.isSafeInteger(Number(team.providerAliases[0]?.id))
            ? Number(team.providerAliases[0]?.id)
            : 20_001 + index,
          name: team.name,
          code: team.abbreviation,
          logo: team.logoUrl,
        })),
      });
    }

    if (url.pathname === "/status") {
      return json({
        errors: [],
        response: {
          requests: {
            current: fixture.health.quota.requestsUsed,
            limit_day: fixture.health.quota.dailyLimit ?? 7_500,
          },
        },
      });
    }

    if (url.pathname === "/games" && url.searchParams.has("season")) {
      const season = Number(url.searchParams.get("season"));
      const regularSeasonRows = gameRows.filter(
        (row) => Number(row.league.season) === season,
      );
      const postseasonDecoy = regularSeasonRows[0]
        ? {
            ...regularSeasonRows[0],
            game: {
              ...regularSeasonRows[0].game,
              id: regularSeasonRows[0].game.id + 50_000,
              stage: "Post Season",
              week: "Wild Card",
            },
          }
        : null;
      return json({
        errors: [],
        response: postseasonDecoy
          ? [...regularSeasonRows, postseasonDecoy]
          : regularSeasonRows,
      });
    }

    if (url.pathname === "/games" && url.searchParams.has("date")) {
      const liveIds = new Set(
        fixture.liveGameAliases.map((alias) => gameIds.get(alias)),
      );
      return json({
        errors: [],
        response: gameRows.filter((row) =>
          liveIds.has(String(row.game.id)),
        ),
      });
    }

    if (url.pathname === "/games" && url.searchParams.has("id")) {
      const id = url.searchParams.get("id");
      return json({
        errors: [],
        response: gameRows.filter((row) => String(row.game.id) === id),
      });
    }

    return new Response(null, { status: 404, statusText: "Not Found" });
  }) as typeof fetch;
}
