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
