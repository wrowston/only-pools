import * as Effect from "effect/Effect";
import { expect, it } from "vitest";
import { CANONICAL_NFL_TEAM_LIST } from "../catalog";
import { nflGameStableKey } from "../identity";
import type { InMemorySportsDataFixture } from "../inMemory";
import type {
  SportsDataGame,
  SportsDataProvider,
  SportsDataProviderHealth,
  SportsDataProviderName,
  SportsDataTeam,
} from "../types";

export type SportsDataContractFixture = InMemorySportsDataFixture;

const observedAtMs = Date.parse("2026-09-14T01:30:30Z");

const teams: readonly SportsDataTeam[] = CANONICAL_NFL_TEAM_LIST.map(
  (team, index) => ({
    ...team,
    providerAliases: [
      { provider: "in-memory" as const, id: `team-${index + 1}` },
    ],
  }),
);

const games: readonly SportsDataGame[] = [
  {
    stableKey: nflGameStableKey({
      seasonYear: 2026,
      week: 1,
      awayTeamAbbreviation: "DET",
      homeTeamAbbreviation: "GB",
    }),
    seasonYear: 2026,
    week: 1,
    awayTeamAbbreviation: "DET",
    homeTeamAbbreviation: "GB",
    scheduledKickoffMs: Date.parse("2026-09-11T00:20:00Z"),
    lifecycle: "scheduled",
    awayScore: null,
    homeScore: null,
    observedAtMs,
    providerAliases: [{ provider: "in-memory", id: "game-2026-1" }],
  },
  {
    stableKey: nflGameStableKey({
      seasonYear: 2026,
      week: 1,
      awayTeamAbbreviation: "BUF",
      homeTeamAbbreviation: "KC",
    }),
    seasonYear: 2026,
    week: 1,
    awayTeamAbbreviation: "BUF",
    homeTeamAbbreviation: "KC",
    scheduledKickoffMs: Date.parse("2026-09-14T00:20:00Z"),
    lifecycle: "in_progress",
    awayScore: 14,
    homeScore: 10,
    observedAtMs,
    providerAliases: [{ provider: "in-memory", id: "game-2026-live" }],
  },
  {
    stableKey: nflGameStableKey({
      seasonYear: 2025,
      week: 18,
      awayTeamAbbreviation: "SF",
      homeTeamAbbreviation: "SEA",
    }),
    seasonYear: 2025,
    week: 18,
    awayTeamAbbreviation: "SF",
    homeTeamAbbreviation: "SEA",
    scheduledKickoffMs: Date.parse("2026-01-04T21:25:00Z"),
    lifecycle: "terminal",
    awayScore: 27,
    homeScore: 21,
    observedAtMs,
    providerAliases: [{ provider: "in-memory", id: "game-2025-18" }],
  },
];

const health: SportsDataProviderHealth = {
  provider: "in-memory",
  status: "available",
  checkedAtMs: observedAtMs,
  lastSuccessfulRequestAtMs: observedAtMs,
  quota: {
    dailyLimit: 7_500,
    requestsUsed: 125,
    requestsRemaining: 7_375,
    minuteLimit: 300,
    requestsUsedThisMinute: 2,
    requestsRemainingThisMinute: 298,
    resetsAtMs: Date.parse("2026-09-15T00:00:00Z"),
  },
};

export const SPORTS_DATA_CONTRACT_FIXTURE: SportsDataContractFixture = {
  teams,
  games,
  liveGameAliases: ["game-2026-live"],
  health,
};

export function sportsDataContractFixtureFor(
  provider: SportsDataProviderName,
): SportsDataContractFixture {
  return {
    teams: SPORTS_DATA_CONTRACT_FIXTURE.teams.map((team) => ({
      ...team,
      providerAliases: team.providerAliases.map((alias) => ({
        ...alias,
        provider,
      })),
    })),
    games: SPORTS_DATA_CONTRACT_FIXTURE.games.map((game) => ({
      ...game,
      providerAliases: game.providerAliases.map((alias) => ({
        ...alias,
        provider,
      })),
    })),
    liveGameAliases: SPORTS_DATA_CONTRACT_FIXTURE.liveGameAliases,
    health: { ...SPORTS_DATA_CONTRACT_FIXTURE.health, provider },
  };
}

function withReplacementProviderAliases(
  fixture: SportsDataContractFixture,
): SportsDataContractFixture {
  const replacements = new Map<string, string>();
  let nextAlias = 900_001;
  const replaceAlias = (id: string): string => {
    const existing = replacements.get(id);
    if (existing) return existing;
    const replacement = String(nextAlias++);
    replacements.set(id, replacement);
    return replacement;
  };

  return {
    ...fixture,
    teams: fixture.teams.map((team) => ({
      ...team,
      providerAliases: team.providerAliases.map((alias) => ({
        ...alias,
        id: replaceAlias(alias.id),
      })),
    })),
    games: fixture.games.map((game) => ({
      ...game,
      providerAliases: game.providerAliases.map((alias) => ({
        ...alias,
        id: replaceAlias(alias.id),
      })),
    })),
    liveGameAliases: fixture.liveGameAliases.map(replaceAlias),
  };
}

/**
 * Shared observable contract. Provider adapters call this unchanged with their
 * own fixture-backed factory.
 */
export function defineSportsDataProviderContract(
  label: string,
  providerName: SportsDataProviderName,
  createProvider: (
    fixture: SportsDataContractFixture,
  ) => SportsDataProvider,
): void {
  const fixture = sportsDataContractFixtureFor(providerName);

  it(`${label} returns canonical NFL Teams through the neutral interface`, async () => {
    const provider = createProvider(fixture);

    const program = provider.listTeams();
    expect(Effect.isEffect(program)).toBe(true);
    const result = await Effect.runPromise(program);

    expect(result).toHaveLength(32);
    expect(result.find((team) => team.abbreviation === "DET")).toMatchObject({
      stableKey: "nfl-team:franchise-11",
      name: "Detroit Lions",
    });
    expect(result[0]).not.toHaveProperty("sportsDbTeamId");

    const replacementResult = await Effect.runPromise(
      createProvider(
        withReplacementProviderAliases(fixture),
      ).listTeams(),
    );
    expect(replacementResult.map((team) => team.stableKey)).toEqual(
      result.map((team) => team.stableKey),
    );
    expect(replacementResult.map((team) => team.providerAliases)).not.toEqual(
      result.map((team) => team.providerAliases),
    );
  });

  it(`${label} limits a Pool Season schedule to the requested season`, async () => {
    const provider = createProvider(fixture);

    const result = await Effect.runPromise(
      provider.listSeasonGames(2026),
    );

    expect(result.map((game) => game.stableKey)).toEqual([
      "nfl-game:2026:w1:franchise-11@franchise-12",
      "nfl-game:2026:w1:franchise-4@franchise-16",
    ]);
    expect(result.map((game) => game.lifecycle)).toEqual([
      "scheduled",
      "in_progress",
    ]);

    const replacementResult = await Effect.runPromise(
      createProvider(
        withReplacementProviderAliases(fixture),
      ).listSeasonGames(2026),
    );
    expect(replacementResult.map((game) => game.stableKey)).toEqual(
      result.map((game) => game.stableKey),
    );
    expect(replacementResult.map((game) => game.providerAliases)).not.toEqual(
      result.map((game) => game.providerAliases),
    );

    const [terminalGame] = await Effect.runPromise(
      provider.listSeasonGames(2025),
    );
    expect(terminalGame).toMatchObject({
      lifecycle: "terminal",
      awayScore: 27,
      homeScore: 21,
    });
  });

  it(`${label} returns only the provider's current live slate`, async () => {
    const provider = createProvider(fixture);

    const result = await Effect.runPromise(provider.listLiveGames());

    expect(result.map((game) => game.stableKey)).toEqual([
      "nfl-game:2026:w1:franchise-4@franchise-16",
    ]);
    expect(result[0]?.lifecycle).toBe("in_progress");
  });

  it(`${label} supports targeted lookup by replaceable provider alias`, async () => {
    const provider = createProvider(fixture);
    const foreignProvider =
      provider.name === "api-sports" ? "in-memory" : "api-sports";
    const [scheduledGame] = await Effect.runPromise(
      provider.listSeasonGames(2026),
    );
    const lookupAlias = scheduledGame?.providerAliases.find(
      (alias) => alias.provider === provider.name,
    );
    expect(lookupAlias).toBeDefined();

    await expect(
      Effect.runPromise(provider.getGame(lookupAlias!)),
    ).resolves.toMatchObject({
      stableKey: "nfl-game:2026:w1:franchise-11@franchise-12",
    });
    await expect(
      Effect.runPromise(
        provider.getGame({ provider: provider.name, id: "missing" }),
      ),
    ).resolves.toBeNull();
    await expect(
      Effect.runPromise(
        provider.getGame({
          provider: foreignProvider,
          id: "game-2026-1",
        }),
      ),
    ).resolves.toBeNull();
  });

  it(`${label} reports neutral provider health and quota metadata`, async () => {
    const provider = createProvider(fixture);

    const result = await Effect.runPromise(provider.getHealth());

    expect(result).toMatchObject({
      provider: provider.name,
      status: "available",
    });
    expect(result.checkedAtMs).toEqual(expect.any(Number));
    expect(result.quota).toHaveProperty("dailyLimit");
    expect(result.quota).toHaveProperty("requestsUsed");
    expect(result.quota).toHaveProperty("requestsRemaining");
    expect(result.quota).toHaveProperty("minuteLimit");
    expect(result.quota).toHaveProperty("requestsUsedThisMinute");
    expect(result.quota).toHaveProperty("requestsRemainingThisMinute");
    expect(result.quota).toHaveProperty("resetsAtMs");
    expect(result.quota).toMatchObject({
      dailyLimit: 7_500,
      requestsUsed: 125,
      requestsRemaining: 7_375,
      minuteLimit: 300,
      requestsUsedThisMinute: 2,
      requestsRemainingThisMinute: 298,
    });
    expect(result.quota.resetsAtMs).toBe(
      Date.parse("2026-09-15T00:00:00Z"),
    );
  });
}
