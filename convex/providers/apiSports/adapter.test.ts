import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import { defineSportsDataProviderContract } from "../sportsData/testing/contract";
import { ApiSportsProvider } from "./adapter";
import { createSanitizedApiSportsFetch } from "./testing/fixtures";

describe("ApiSportsProvider", () => {
  defineSportsDataProviderContract(
    "API-Sports adapter with sanitized responses",
    "api-sports",
    (fixture) =>
      new ApiSportsProvider({
        apiKey: "sanitized-fixture-key",
        fetch: createSanitizedApiSportsFetch(fixture),
        nowMs: () => Date.parse("2026-09-14T01:30:30Z"),
      }),
  );

  it("skips future schedule placeholders with nullable team names without losing usable games", async () => {
    const validRow = {
      game: {
        id: 77_770,
        stage: "Regular Season",
        week: "Week 1",
        date: { timestamp: 1_788_998_400 },
        status: { short: "NS", long: "Not Started" },
      },
      league: { id: 1, season: "2026" },
      teams: {
        home: { id: 12, name: "Green Bay Packers" },
        away: { id: 11, name: "Detroit Lions" },
      },
      scores: {
        home: { total: null },
        away: { total: null },
      },
    };
    const fetch: typeof globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          errors: [],
          response: [
            validRow,
            {
              ...validRow,
              game: {
                ...validRow.game,
                id: 77_771,
                week: "Week 18",
              },
              teams: {
                home: { id: 12, name: null },
                away: { id: 11, name: null },
              },
            },
          ],
        }),
        { status: 200 },
      );
    const provider = new ApiSportsProvider({
      apiKey: "sanitized-fixture-key",
      fetch,
      nowMs: () => Date.parse("2026-09-14T01:30:30Z"),
    });

    const games = await Effect.runPromise(
      provider.listSeasonGames(2026),
    );

    expect(games).toHaveLength(1);
    expect(games[0]).toMatchObject({
      providerAliases: [{ provider: "api-sports", id: "77770" }],
      homeTeamAbbreviation: "GB",
      awayTeamAbbreviation: "DET",
    });
  });

  it("preserves an unknown raw status without trusting it as lifecycle evidence", async () => {
    const fetch: typeof globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          errors: [],
          response: [
            {
              game: {
                id: 77_777,
                stage: "Regular Season",
                week: "Week 1",
                date: { timestamp: 1_788_998_400 },
                status: {
                  short: "NEW_STATUS",
                  long: "New Provider Status",
                },
              },
              league: { id: 1, season: "2026" },
              teams: {
                home: { id: 12, name: "Green Bay Packers" },
                away: { id: 11, name: "Detroit Lions" },
              },
              scores: {
                home: { total: null },
                away: { total: null },
              },
            },
          ],
        }),
        { status: 200 },
      );
    const provider = new ApiSportsProvider({
      apiKey: "sanitized-fixture-key",
      fetch,
      nowMs: () => Date.parse("2026-09-14T01:30:30Z"),
    });

    const [game] = await Effect.runPromise(
      provider.listSeasonGames(2026),
    );

    expect(game).toMatchObject({
      lifecycle: "unknown",
      providerStatus: {
        rawShort: "NEW_STATUS",
        rawLong: "New Provider Status",
        recognized: false,
        terminal: false,
      },
    });
  });

  it("preserves the returned preseason stage for qualification validation", async () => {
    const fetch: typeof globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          errors: [],
          response: [
            {
              game: {
                id: 77_776,
                stage: "Pre Season",
                week: "Preseason 1",
                date: { timestamp: 1_788_998_400 },
                status: { short: "NS", long: "Not Started" },
              },
              league: { id: 1, season: "2026" },
              teams: {
                home: { id: 12, name: "Green Bay Packers" },
                away: { id: 11, name: "Detroit Lions" },
              },
              scores: {
                home: { total: null },
                away: { total: null },
              },
            },
          ],
        }),
        { status: 200 },
      );
    const provider = new ApiSportsProvider({
      apiKey: "sanitized-fixture-key",
      fetch,
      nowMs: () => Date.parse("2026-09-14T01:30:30Z"),
    });

    const game = await Effect.runPromise(
      provider.getGame({ provider: "api-sports", id: "77776" }),
    );

    expect(game).toMatchObject({
      providerAliases: [{ provider: "api-sports", id: "77776" }],
      providerStage: "Pre Season",
      seasonPhase: "preseason",
    });
  });

  it("keeps unknown statuses in a provider-scoped date slate for downstream trust policy", async () => {
    const fetch: typeof globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          errors: [],
          response: [
            {
              game: {
                id: 77_778,
                stage: "Regular Season",
                week: "Week 1",
                date: { timestamp: 1_788_998_400 },
                status: {
                  short: "NEW_IN_PLAY",
                  long: "New In-Play Status",
                },
              },
              league: { id: 1, season: "2026" },
              teams: {
                home: { id: 12, name: "Green Bay Packers" },
                away: { id: 11, name: "Detroit Lions" },
              },
              scores: {
                home: { total: 7 },
                away: { total: 3 },
              },
            },
          ],
        }),
        { status: 200 },
      );
    const provider = new ApiSportsProvider({
      apiKey: "sanitized-fixture-key",
      fetch,
      nowMs: () => Date.parse("2026-09-14T01:30:30Z"),
    });

    const games = await Effect.runPromise(provider.listLiveGames());

    expect(games).toHaveLength(1);
    expect(games[0]).toMatchObject({
      lifecycle: "unknown",
      providerStatus: {
        rawShort: "NEW_IN_PLAY",
        recognized: false,
      },
    });
  });

  it("quarantines malformed live rows without blocking valid siblings", async () => {
    const requestedUrls: string[] = [];
    const validRow = {
      game: {
        id: 77_779,
        stage: "Regular Season",
        week: "Week 1",
        date: { timestamp: 1_788_998_400 },
        status: { short: "Q2", long: "Second Quarter" },
      },
      league: { id: 1, season: "2026" },
      teams: {
        home: { id: 12, name: "Green Bay Packers" },
        away: { id: 11, name: "Detroit Lions" },
      },
      scores: {
        home: { total: 14 },
        away: { total: 10 },
      },
    };
    const fetch: typeof globalThis.fetch = async (input) => {
      requestedUrls.push(String(input));
      return new Response(
        JSON.stringify({
          errors: [],
          response: [
            validRow,
            { game: { id: 88_888 }, scores: "malformed" },
            {
              ...validRow,
              game: { ...validRow.game, id: 99_999 },
              teams: {
                home: { id: 100, name: "Unknown Franchise" },
                away: validRow.teams.away,
              },
            },
          ],
        }),
        { status: 200 },
      );
    };
    const provider = new ApiSportsProvider({
      apiKey: "sanitized-fixture-key",
      fetch,
      nowMs: () => Date.parse("2026-09-14T01:30:30Z"),
    });

    const result = await Effect.runPromise(
      provider.listLiveGamesWithFailures(),
    );

    expect(result.games).toHaveLength(1);
    expect(result.games[0]).toMatchObject({
      providerAliases: [{ provider: "api-sports", id: "77779" }],
      lifecycle: "in_progress",
      homeScore: 14,
      awayScore: 10,
    });
    expect(result.failures).toHaveLength(2);
    expect(result.failures.map((failure) => failure.rowIndex)).toEqual([
      1, 2,
    ]);
    expect(requestedUrls).toHaveLength(1);
    expect(new URL(requestedUrls[0]!).searchParams.get("live")).toBe(
      "all",
    );
  });

  it("maps every recognized status to neutral lifecycle and terminal evidence", async () => {
    const cases = [
      ["NS", "scheduled", false],
      ["Q1", "in_progress", false],
      ["Q2", "in_progress", false],
      ["HT", "in_progress", false],
      ["Q3", "in_progress", false],
      ["Q4", "in_progress", false],
      ["OT", "in_progress", false],
      ["BT", "in_progress", false],
      ["INT", "interrupted", false],
      ["SUSP", "interrupted", false],
      ["PST", "postponed", false],
      ["POST", "postponed", false],
      ["CANC", "canceled", true],
      ["CAN", "canceled", true],
      ["ABD", "canceled", true],
      ["FT", "terminal", true],
      ["AOT", "terminal", true],
    ] as const;
    const fetch: typeof globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          errors: [],
          response: cases.map(([short], index) => ({
            game: {
              id: 80_000 + index,
              stage: "Regular Season",
              week: `Week ${(index % 18) + 1}`,
              date: { timestamp: 1_788_998_400 + index },
              status: { short, long: `Fixture ${short}` },
            },
            league: { id: 1, season: "2026" },
            teams: {
              home: { id: 12, name: "Green Bay Packers" },
              away: { id: 11, name: "Detroit Lions" },
            },
            scores: {
              home: { total: null },
              away: { total: null },
            },
          })),
        }),
        { status: 200 },
      );
    const provider = new ApiSportsProvider({
      apiKey: "sanitized-fixture-key",
      fetch,
      nowMs: () => Date.parse("2026-09-14T01:30:30Z"),
    });

    const games = await Effect.runPromise(
      provider.listSeasonGames(2026),
    );

    expect(
      games.map((game) => [
        game.providerStatus.rawShort,
        game.lifecycle,
        game.providerStatus.terminal,
      ]),
    ).toEqual(cases);
    expect(
      games.every((game) => game.providerStatus.recognized),
    ).toBe(true);
  });
});
