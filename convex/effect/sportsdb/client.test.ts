import { Cause, Exit } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SportsDbDecodeError, SportsDbHttpError } from "../errors";
import { runEffectExit } from "../run";
import {
  fetchEventLookupEffect,
  fetchLeagueLivescoreEffect,
  fetchNflTeamsEffect,
  fetchSeasonEventsEffect,
  sportsDbApiKey,
} from "./client";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function mockJsonResponse(body: unknown, init?: { ok?: boolean; status?: number; statusText?: string }) {
  const ok = init?.ok ?? true;
  const status = init?.status ?? (ok ? 200 : 500);
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    statusText: init?.statusText ?? (ok ? "OK" : "Internal Server Error"),
    json: async () => body,
  }) as typeof fetch;
}

describe("sportsDbApiKey", () => {
  it("uses THESPORTSDB_API_KEY when set", () => {
    expect(sportsDbApiKey({ THESPORTSDB_API_KEY: " paid-key " })).toBe("paid-key");
  });

  it("falls back to public key 123", () => {
    expect(sportsDbApiKey({})).toBe("123");
  });
});

describe("fetchNflTeamsEffect", () => {
  it("returns decoded teams on success", async () => {
    mockJsonResponse({
      teams: [
        {
          idTeam: "134920",
          strTeam: "Kansas City Chiefs",
          strTeamShort: "KC",
        },
      ],
    });

    const exit = await runEffectExit(fetchNflTeamsEffect("test-key"));
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toEqual([
        {
          idTeam: "134920",
          strTeam: "Kansas City Chiefs",
          strTeamShort: "KC",
        },
      ]);
    }
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://www.thesportsdb.com/api/v1/json/test-key/search_all_teams.php?l=NFL",
    );
  });

  it("returns empty array when teams is null", async () => {
    mockJsonResponse({ teams: null });
    const exit = await runEffectExit(fetchNflTeamsEffect("k"));
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toEqual([]);
    }
  });

  it("fails with SportsDbHttpError on non-OK response", async () => {
    mockJsonResponse({}, { ok: false, status: 503, statusText: "Service Unavailable" });
    const exit = await runEffectExit(fetchNflTeamsEffect("k"));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const error = Cause.squash(exit.cause);
      expect(error).toBeInstanceOf(SportsDbHttpError);
      expect(error).toMatchObject({
        _tag: "SportsDbHttpError",
        status: 503,
        statusText: "Service Unavailable",
      });
    }
  });

  it("fails with SportsDbDecodeError on malformed body", async () => {
    mockJsonResponse({ teams: [{ idTeam: 1, strTeam: "Bad" }] });
    const exit = await runEffectExit(fetchNflTeamsEffect("k"));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const error = Cause.squash(exit.cause);
      expect(error).toBeInstanceOf(SportsDbDecodeError);
      expect(error).toMatchObject({ _tag: "SportsDbDecodeError" });
    }
  });
});

describe("fetchSeasonEventsEffect", () => {
  it("returns decoded events", async () => {
    mockJsonResponse({
      events: [
        {
          idEvent: "100",
          idHomeTeam: "1",
          idAwayTeam: "2",
          strHomeTeam: "A",
          strAwayTeam: "B",
        },
      ],
    });
    const exit = await runEffectExit(fetchSeasonEventsEffect("2025", "k"));
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toHaveLength(1);
      expect(exit.value[0]?.idEvent).toBe("100");
    }
  });
});

describe("fetchLeagueLivescoreEffect", () => {
  it("prefers events then livescore", async () => {
    mockJsonResponse({
      livescore: [
        {
          idEvent: "live-1",
          idHomeTeam: "1",
          idAwayTeam: "2",
        },
      ],
    });
    const exit = await runEffectExit(fetchLeagueLivescoreEffect("k"));
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value[0]?.idEvent).toBe("live-1");
    }
  });
});

describe("fetchEventLookupEffect", () => {
  it("returns first event or null", async () => {
    mockJsonResponse({ events: null });
    const empty = await runEffectExit(fetchEventLookupEffect("999", "k"));
    expect(Exit.isSuccess(empty)).toBe(true);
    if (Exit.isSuccess(empty)) {
      expect(empty.value).toBeNull();
    }

    mockJsonResponse({
      events: [
        {
          idEvent: "999",
          idHomeTeam: "1",
          idAwayTeam: "2",
        },
      ],
    });
    const found = await runEffectExit(fetchEventLookupEffect("999", "k"));
    expect(Exit.isSuccess(found)).toBe(true);
    if (Exit.isSuccess(found)) {
      expect(found.value?.idEvent).toBe("999");
    }
  });
});
