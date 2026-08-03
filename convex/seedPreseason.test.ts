/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test,
} from "vitest";

import { internal } from "./_generated/api";
import { CANONICAL_NFL_TEAM_LIST } from "./providers/sportsData/catalog";
import type { SportsDataGameObservation } from "./providers/sportsData/types";
import schema from "./schema";
import {
  PRESEASON_FINAL_WEEK,
  assertCompletePreseasonSlate,
  selectPreseasonSeedGames,
  validatePreseasonSeedGames,
  type PreseasonSeedGame,
} from "./seedPreseason";

const modules = import.meta.glob("./**/*.ts");
const NOW_MS = Date.UTC(2026, 6, 28);
const HOUR_MS = 60 * 60 * 1_000;

function seedGame(
  week: number,
  homeTeamAbbreviation: string,
  awayTeamAbbreviation: string,
): PreseasonSeedGame {
  return {
    stableKey: `nfl-game:2026:w${week}:fixture`,
    week,
    homeTeamAbbreviation,
    awayTeamAbbreviation,
    homeTeamProviderExternalId: `home-${week}`,
    awayTeamProviderExternalId: `away-${week}`,
    scheduledKickoffMs: NOW_MS + week * HOUR_MS,
    providerGameExternalId: `game-${week}`,
    observedAtMs: NOW_MS,
  };
}

function completeSlate(): PreseasonSeedGame[] {
  const abbreviations = CANONICAL_NFL_TEAM_LIST.map(
    (team) => team.abbreviation,
  );
  return [1, 2, 3].flatMap((week) =>
    Array.from({ length: 16 }, (_, index) => {
      const away = abbreviations[index * 2]!;
      const home = abbreviations[index * 2 + 1]!;
      return {
        stableKey: `nfl-game:2026:w${week}:${away}@${home}`,
        week,
        homeTeamAbbreviation: home,
        awayTeamAbbreviation: away,
        homeTeamProviderExternalId: `team-${home}`,
        awayTeamProviderExternalId: `team-${away}`,
        scheduledKickoffMs: NOW_MS + week * HOUR_MS,
        providerGameExternalId: `game-${week}-${index}`,
        observedAtMs: NOW_MS,
      };
    }),
  );
}

function observation(input: {
  week: number;
  homeTeamAbbreviation: "ARI" | "ATL" | "BAL" | "BUF" | "CAR" | "CHI";
  awayTeamAbbreviation: "ARI" | "ATL" | "BAL" | "BUF" | "CAR" | "CHI";
  phase?: "preseason" | "regular_season";
}): SportsDataGameObservation {
  return {
    stableKey:
      `nfl-game:2026:w${input.week}:franchise-1@franchise-2`,
    seasonYear: 2026,
    week: input.week,
    homeTeamAbbreviation: input.homeTeamAbbreviation,
    awayTeamAbbreviation: input.awayTeamAbbreviation,
    homeTeamProviderAlias: {
      provider: "api-sports",
      id: `team-${input.homeTeamAbbreviation}`,
    },
    awayTeamProviderAlias: {
      provider: "api-sports",
      id: `team-${input.awayTeamAbbreviation}`,
    },
    scheduledKickoffMs: NOW_MS + input.week * HOUR_MS,
    lifecycle: "scheduled",
    homeScore: null,
    awayScore: null,
    observedAtMs: NOW_MS,
    providerAliases: [
      { provider: "api-sports", id: `game-${input.week}` },
    ],
    providerStage:
      input.phase === "regular_season"
        ? "Regular Season"
        : "Pre Season",
    seasonPhase: input.phase ?? "preseason",
    providerStatus: {
      rawShort: "NS",
      rawLong: "Not Started",
      recognized: true,
      terminal: false,
    },
  };
}

describe("preseason seed selection", () => {
  test("selects only normalized 2026 preseason weeks 1–3", () => {
    const selected = selectPreseasonSeedGames(
      [
        observation({
          week: 1,
          homeTeamAbbreviation: "ARI",
          awayTeamAbbreviation: "ATL",
        }),
        observation({
          week: 2,
          homeTeamAbbreviation: "BAL",
          awayTeamAbbreviation: "BUF",
        }),
        observation({
          week: 3,
          homeTeamAbbreviation: "CAR",
          awayTeamAbbreviation: "CHI",
        }),
        observation({
          week: 1,
          homeTeamAbbreviation: "ARI",
          awayTeamAbbreviation: "ATL",
          phase: "regular_season",
        }),
      ],
      NOW_MS,
    );

    expect(selected).toHaveLength(3);
    expect(selected.map((game) => game.week)).toEqual([1, 2, 3]);
    expect(selected[0]).toMatchObject({
      providerGameExternalId: "game-1",
      homeTeamProviderExternalId: "team-ARI",
      awayTeamProviderExternalId: "team-ATL",
    });
  });

  test("requires at least one valid future game in every preseason week", () => {
    expect(() =>
      validatePreseasonSeedGames(
        [
          seedGame(1, "ARI", "ATL"),
          seedGame(2, "BAL", "BUF"),
        ],
        NOW_MS,
      ),
    ).toThrow("weeks 1, 2, and 3");

    const games = [
      seedGame(1, "ARI", "ATL"),
      seedGame(2, "BAL", "BUF"),
      seedGame(3, "CAR", "CHI"),
    ];
    games[2] = {
      ...games[2]!,
      scheduledKickoffMs: NOW_MS,
    };
    expect(() =>
      validatePreseasonSeedGames(games, NOW_MS),
    ).toThrow("future kickoffs");
  });

  test("refuses an in-scope row without exact API-Sports aliases", () => {
    const games = [
      observation({
        week: 1,
        homeTeamAbbreviation: "ARI",
        awayTeamAbbreviation: "ATL",
      }),
      observation({
        week: 2,
        homeTeamAbbreviation: "BAL",
        awayTeamAbbreviation: "BUF",
      }),
      observation({
        week: 3,
        homeTeamAbbreviation: "CAR",
        awayTeamAbbreviation: "CHI",
      }),
    ];
    games[1] = {
      ...games[1]!,
      providerAliases: [],
    };

    expect(() =>
      selectPreseasonSeedGames(games, NOW_MS),
    ).toThrow("exact API-Sports aliases");
  });

  test("requires all 48 games and all 32 teams in every week", () => {
    const games = validatePreseasonSeedGames(completeSlate(), NOW_MS);
    expect(assertCompletePreseasonSlate(games)).toHaveLength(48);
    expect(() =>
      assertCompletePreseasonSlate(games.slice(1)),
    ).toThrow("48 games");
  });
});

describe("preseason pool persistence", () => {
  const previousDeploymentKind = process.env.DEPLOYMENT_KIND;

  beforeAll(() => {
    process.env.DEPLOYMENT_KIND = "development";
  });

  afterAll(() => {
    if (previousDeploymentKind === undefined) {
      delete process.env.DEPLOYMENT_KIND;
    } else {
      process.env.DEPLOYMENT_KIND = previousDeploymentKind;
    }
  });

  test("creates and restores an idempotent week-3 Survivor pool", async () => {
    const t = convexTest(schema, modules);
    const ownerClerkUserId = "user_preseason_test";
    const ownerParticipantId = await t.run(async (ctx) => {
      return await ctx.db.insert("participants", {
        tokenIdentifier: "test|preseason-owner",
        clerkUserId: ownerClerkUserId,
        displayName: "Preseason Owner",
        emailVerified: true,
        phoneVerified: true,
        ageConfirmed: true,
        suspended: false,
      });
    });
    const games = [
      seedGame(1, "ARI", "ATL"),
      seedGame(2, "BAL", "BUF"),
      seedGame(3, "CAR", "CHI"),
    ];

    const first = await t.mutation(
      internal.seedPreseason.persistApiSportsPreseasonPool,
      {
        ownerParticipantId,
        poolName: "Preseason Test",
        games,
        nowMs: NOW_MS,
      },
    );
    expect(first.created).toEqual({
      season: true,
      pool: true,
      membership: true,
      entry: true,
    });
    expect(
      await t.run(async (ctx) => {
        const [pool, season] = await Promise.all([
          ctx.db.get(first.poolId),
          ctx.db.get(first.seasonId),
        ]);
        return {
          finalWeek: pool?.finalWeek,
          seasonStatus: season?.status,
          competitionPhase: season?.competitionPhase,
        };
      }),
    ).toEqual({
      finalWeek: PRESEASON_FINAL_WEEK,
      seasonStatus: "available",
      competitionPhase: "preseason",
    });

    await t.run(async (ctx) => {
      await ctx.db.patch(first.poolId, { finalWeek: undefined });
    });
    const second = await t.mutation(
      internal.seedPreseason.persistApiSportsPreseasonPool,
      {
        ownerParticipantId,
        poolName: "Preseason Test",
        games,
        nowMs: NOW_MS,
      },
    );
    expect(second.poolId).toBe(first.poolId);
    expect(second.entryId).toBe(first.entryId);
    expect(second.created).toEqual({
      season: false,
      pool: false,
      membership: false,
      entry: false,
    });
    expect(
      await t.run(async (ctx) => (await ctx.db.get(second.poolId))?.finalWeek),
    ).toBe(PRESEASON_FINAL_WEEK);
  });
});
