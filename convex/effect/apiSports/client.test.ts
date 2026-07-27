import * as Cause from "effect/Cause";
import * as Exit from "effect/Exit";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ApiSportsDecodeError,
  ApiSportsHttpError,
  ApiSportsRateLimitError,
  ApiSportsTransportError,
} from "../errors";
import { runEffectExit } from "../run";
import { createApiSportsClient } from "./client";

const originalFetch = globalThis.fetch;

function apiSportsGameWire(id: number) {
  return {
    game: {
      id,
      stage: "Regular Season",
      week: "Week 11",
      date: { timestamp: 1_700_529_300 },
      status: { short: "FT", long: "Finished" },
    },
    league: { id: 1, season: "2023" },
    teams: {
      home: { id: 17, name: "Kansas City Chiefs" },
      away: { id: 12, name: "Philadelphia Eagles" },
    },
    scores: {
      home: { total: 17 },
      away: { total: 21 },
    },
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("API-Sports Effect client", () => {
  it("decodes unknown team responses and authenticates without putting the key in the URL", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          get: "teams",
          parameters: { league: "1" },
          errors: [],
          results: 1,
          response: [
            {
              id: 17,
              name: "Kansas City Chiefs",
              code: "KC",
              logo: "https://media.api-sports.io/teams/17.png",
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const client = createApiSportsClient({
      apiKey: "fixture-secret-key",
      nowMs: () => Date.parse("2026-09-14T01:30:30Z"),
    });

    const exit = await runEffectExit(client.fetchTeams());

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.data).toEqual([
        {
          id: 17,
          name: "Kansas City Chiefs",
          code: "KC",
          logo: "https://media.api-sports.io/teams/17.png",
        },
      ]);
    }
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://v1.american-football.api-sports.io/teams?league=1&season=2026",
      {
        method: "GET",
        headers: { "x-apisports-key": "fixture-secret-key" },
      },
    );
    expect(
      (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0],
    ).not.toContain("fixture-secret-key");
  });

  it("returns a typed rate-limit failure with daily and per-minute quota metadata", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 429,
        statusText: "Too Many Requests",
        headers: {
          "x-ratelimit-requests-limit": "7500",
          "x-ratelimit-requests-remaining": "0",
          "x-ratelimit-limit": "300",
          "x-ratelimit-remaining": "0",
        },
      }),
    );
    const client = createApiSportsClient({
      apiKey: "fixture-secret-key",
      nowMs: () => Date.parse("2026-09-14T01:30:30Z"),
    });

    const exit = await runEffectExit(client.fetchTeams());

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const error = Cause.squash(exit.cause);
      expect(error).toBeInstanceOf(ApiSportsRateLimitError);
      expect(error).toMatchObject({
        _tag: "ApiSportsRateLimitError",
        status: 429,
        quota: {
          dailyLimit: 7500,
          dailyRemaining: 0,
          minuteLimit: 300,
          minuteRemaining: 0,
        },
      });
      expect(JSON.stringify(error)).not.toContain("fixture-secret-key");
      expect(String(error)).not.toContain("fixture-secret-key");
    }
  });

  it("recognizes a provider-declared quota failure in a successful HTTP envelope", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          errors: {
            rateLimit: "Request limit reached",
          },
          response: [],
        }),
        {
          status: 200,
          headers: {
            "x-ratelimit-requests-limit": "7500",
            "x-ratelimit-requests-remaining": "0",
            "x-ratelimit-limit": "300",
            "x-ratelimit-remaining": "0",
          },
        },
      ),
    );
    const client = createApiSportsClient({
      apiKey: "fixture-secret-key",
      nowMs: () => Date.parse("2026-09-14T01:30:30Z"),
    });

    const exit = await runEffectExit(client.fetchTeams());

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const error = Cause.squash(exit.cause);
      expect(error).toBeInstanceOf(ApiSportsRateLimitError);
      expect(error).toMatchObject({
        _tag: "ApiSportsRateLimitError",
        status: 200,
        quota: {
          dailyRemaining: 0,
          minuteRemaining: 0,
        },
      });
    }
  });

  it("redacts the credential even when an untrusted HTTP status text repeats it", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "fixture-secret-key unavailable",
      headers: new Headers(),
    } satisfies Partial<Response>);
    const client = createApiSportsClient({
      apiKey: "fixture-secret-key",
    });

    const exit = await runEffectExit(client.fetchTeams());

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const error = Cause.squash(exit.cause);
      expect(error).toBeInstanceOf(ApiSportsHttpError);
      expect(JSON.stringify(error)).not.toContain("fixture-secret-key");
      expect(String(error)).not.toContain("fixture-secret-key");
    }
  });

  it("returns a credential-safe typed transport failure", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(
        new Error("network rejected fixture-secret-key"),
      );
    const client = createApiSportsClient({
      apiKey: "fixture-secret-key",
    });

    const exit = await runEffectExit(client.fetchTeams());

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const error = Cause.squash(exit.cause);
      expect(error).toBeInstanceOf(ApiSportsTransportError);
      expect(error).toMatchObject({
        _tag: "ApiSportsTransportError",
        endpoint: "/teams",
      });
      expect(JSON.stringify(error)).not.toContain("fixture-secret-key");
      expect(String(error)).not.toContain("fixture-secret-key");
    }
  });

  it("returns a credential-safe typed decode failure for malformed unknown data", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          errors: [],
          response: [
            {
              id: "fixture-secret-key",
              name: "Malformed Team",
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const client = createApiSportsClient({
      apiKey: "fixture-secret-key",
    });

    const exit = await runEffectExit(client.fetchTeams());

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const error = Cause.squash(exit.cause);
      expect(error).toBeInstanceOf(ApiSportsDecodeError);
      expect(error).toMatchObject({
        _tag: "ApiSportsDecodeError",
        endpoint: "/teams",
      });
      expect(JSON.stringify(error)).not.toContain("fixture-secret-key");
      expect(String(error)).not.toContain("fixture-secret-key");
    }
  });

  it("decodes a complete Pool Season schedule response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          errors: [],
          response: [apiSportsGameWire(7693)],
        }),
        { status: 200 },
      ),
    );
    const client = createApiSportsClient({
      apiKey: "fixture-secret-key",
    });

    const exit = await runEffectExit(client.fetchSeasonGames(2023));

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.data[0]?.game).toMatchObject({
        id: 7693,
        stage: "Regular Season",
        week: "Week 11",
      });
    }
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://v1.american-football.api-sports.io/games?league=1&season=2023",
      expect.any(Object),
    );
  });

  it("follows optional paging metadata so a Pool Season schedule is complete", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (input) => {
      const url = new URL(String(input));
      const page = Number(url.searchParams.get("page") ?? "1");
      return new Response(
        JSON.stringify({
          errors: [],
          paging: { current: page, total: 2 },
          response: [apiSportsGameWire(7_693 + page)],
        }),
        { status: 200 },
      );
    });
    const client = createApiSportsClient({
      apiKey: "fixture-secret-key",
    });

    const exit = await runEffectExit(client.fetchSeasonGames(2023));

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.data.map((row) => row.game.id)).toEqual([
        7_694, 7_695,
      ]);
    }
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      "https://v1.american-football.api-sports.io/games?league=1&season=2023&page=2",
      expect.any(Object),
    );
  });

  it("requests the current UTC date slate for conservative live filtering", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({ errors: [], response: [] }), {
        status: 200,
      }),
    );
    const client = createApiSportsClient({
      apiKey: "fixture-secret-key",
      nowMs: () => Date.parse("2026-09-14T01:30:30Z"),
    });

    const exit = await runEffectExit(client.fetchLiveGames());

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      "https://v1.american-football.api-sports.io/games?league=1&date=2026-09-13",
      expect.any(Object),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      "https://v1.american-football.api-sports.io/games?league=1&date=2026-09-14",
      expect.any(Object),
    );
  });

  it("supports targeted NFL Game lookup", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ errors: [], response: [] }), {
        status: 200,
      }),
    );
    const client = createApiSportsClient({
      apiKey: "fixture-secret-key",
    });

    const exit = await runEffectExit(client.fetchGame("7693"));

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.data).toEqual([]);
    }
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://v1.american-football.api-sports.io/games?id=7693",
      expect.any(Object),
    );
  });

  it("decodes account-free health data and both quota windows", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          errors: [],
          response: {
            account: {
              firstname: "must not escape",
              email: "must-not-escape@example.com",
            },
            requests: { current: 125, limit_day: 7500 },
          },
        }),
        {
          status: 200,
          headers: {
            "x-ratelimit-requests-limit": "7500",
            "x-ratelimit-requests-remaining": "7375",
            "x-ratelimit-limit": "300",
            "x-ratelimit-remaining": "298",
          },
        },
      ),
    );
    const client = createApiSportsClient({
      apiKey: "fixture-secret-key",
    });

    const exit = await runEffectExit(client.fetchStatus());

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.data).toEqual({
        requests: { current: 125, limit_day: 7500 },
      });
      expect(exit.value.quota).toEqual({
        dailyLimit: 7500,
        dailyRemaining: 7375,
        minuteLimit: 300,
        minuteRemaining: 298,
      });
      expect(JSON.stringify(exit.value)).not.toContain("must-not-escape");
    }
  });
});
