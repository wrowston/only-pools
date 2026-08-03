import { describe, expect, it } from "vitest";
import {
  canonicalNflTeam,
  isNflTeamStableKey,
  nflGameStableKey,
  nflTeamStableKey,
} from "./identity";

describe("provider-independent competitive identity", () => {
  it("keys an NFL Team only by its canonical abbreviation", () => {
    expect(nflTeamStableKey("DET")).toBe("nfl-team:franchise-11");
  });

  it("matches canonical teams exactly without fuzzy abbreviation fallback", () => {
    expect(canonicalNflTeam("DET")?.stableKey).toBe(
      "nfl-team:franchise-11",
    );
    expect(canonicalNflTeam("det")).toBeNull();
    expect(canonicalNflTeam("LIONS")).toBeNull();
    expect(isNflTeamStableKey("nfl-team:franchise-11")).toBe(true);
    expect(isNflTeamStableKey("nfl-team:134939")).toBe(false);
  });

  it("keys an NFL Game by season, week, and canonical teams", () => {
    expect(
      nflGameStableKey({
        seasonYear: 2026,
        week: 4,
        awayTeamAbbreviation: "DET",
        homeTeamAbbreviation: "GB",
      }),
    ).toBe("nfl-game:2026:w4:franchise-11@franchise-12");
  });

  it("cannot change when a provider id or kickoff changes", () => {
    const identity = {
      seasonYear: 2026,
      week: 4,
      awayTeamAbbreviation: "DET" as const,
      homeTeamAbbreviation: "GB" as const,
    };

    const before = {
      ...identity,
      providerAlias: { provider: "api-sports", id: "100" },
      scheduledKickoffMs: Date.parse("2026-09-27T17:00:00Z"),
    };
    const after = {
      ...identity,
      providerAlias: { provider: "api-sports", id: "replacement-200" },
      scheduledKickoffMs: Date.parse("2026-09-27T20:25:00Z"),
    };

    expect(nflGameStableKey(before)).toBe(nflGameStableKey(after));
  });
});
