import { describe, expect, it } from "vitest";
import teamsFixture from "./fixtures/teams_nfl.json";
import eventsFixture from "./fixtures/events_season_2025_sample.json";
import {
  mapProviderStatusToLifecycle,
  normalizeSeasonEvents,
  normalizeTeams,
  type SportsDbEvent,
  type SportsDbTeam,
} from "./adapter";

describe("TheSportsDB adapter (acceptance scenarios 7/28)", () => {
  it("maps teams to provider-independent NFL Team shapes with SportsDB ids as aliases only", () => {
    const teams = normalizeTeams(teamsFixture.teams as SportsDbTeam[]);

    expect(teams).toHaveLength(6);
    const lions = teams.find((t) => t.abbreviation === "DET");
    expect(lions).toEqual({
      stableKey: "nfl-team:134939",
      name: "Detroit Lions",
      abbreviation: "DET",
      logoUrl:
        "https://r2.thesportsdb.com/images/media/team/badge/lgsgkr1546168257.png",
      aliases: { sportsDbTeamId: "134939" },
    });
    // No raw SportsDB field names leak into the normalized shape.
    expect(lions).not.toHaveProperty("idTeam");
    expect(lions).not.toHaveProperty("strTeam");
  });

  it("maps status codes to NFL Game lifecycle without exposing provider codes", () => {
    expect(mapProviderStatusToLifecycle("NS")).toBe("scheduled");
    expect(mapProviderStatusToLifecycle("Q1")).toBe("in_progress");
    expect(mapProviderStatusToLifecycle("Q2")).toBe("in_progress");
    expect(mapProviderStatusToLifecycle("Q3")).toBe("in_progress");
    expect(mapProviderStatusToLifecycle("Q4")).toBe("in_progress");
    expect(mapProviderStatusToLifecycle("HT")).toBe("in_progress");
    expect(mapProviderStatusToLifecycle("OT")).toBe("in_progress");
    expect(mapProviderStatusToLifecycle("FT")).toBe("terminal");
    expect(mapProviderStatusToLifecycle("AOT")).toBe("terminal");
    expect(mapProviderStatusToLifecycle("CANC")).toBe("canceled");
    expect(mapProviderStatusToLifecycle("PST")).toBe("postponed");
    expect(mapProviderStatusToLifecycle("XYZ")).toBe("unknown");
    expect(mapProviderStatusToLifecycle(null)).toBe("unknown");
  });

  it("normalizes regular-season events only and discards preseason rounds", () => {
    const games = normalizeSeasonEvents(
      eventsFixture.events as SportsDbEvent[],
      "2025",
    );

    expect(games.every((g) => g.week >= 1 && g.week <= 18)).toBe(true);
    expect(games.some((g) => g.aliases.sportsDbEventId === "2261152")).toBe(
      false,
    );
    expect(games).toHaveLength(9);

    const week1Ns = games.find((g) => g.aliases.sportsDbEventId === "2262001");
    expect(week1Ns).toMatchObject({
      stableKey: "nfl-game:2025:2262001",
      seasonLabel: "2025",
      week: 1,
      homeTeamStableKey: "nfl-team:134946",
      awayTeamStableKey: "nfl-team:134921",
      scheduledKickoffMs: Date.parse("2025-09-07T17:00:00Z"),
      lifecycle: "scheduled",
      homeScore: null,
      awayScore: null,
      aliases: { sportsDbEventId: "2262001" },
    });
    expect(week1Ns).not.toHaveProperty("idEvent");
    expect(week1Ns).not.toHaveProperty("strStatus");
  });

  it("maps terminal, in-progress, postponed, canceled, and unknown lifecycles from fixtures", () => {
    const games = normalizeSeasonEvents(
      eventsFixture.events as SportsDbEvent[],
      "2025",
    );
    const byId = Object.fromEntries(
      games.map((g) => [g.aliases.sportsDbEventId, g]),
    );

    expect(byId["2262002"].lifecycle).toBe("terminal");
    expect(byId["2262002"].homeScore).toBe(24);
    expect(byId["2262002"].awayScore).toBe(16);
    expect(byId["2262100"].lifecycle).toBe("in_progress");
    expect(byId["2262200"].lifecycle).toBe("in_progress");
    expect(byId["2262300"].lifecycle).toBe("in_progress");
    expect(byId["2262400"].lifecycle).toBe("terminal");
    expect(byId["2262500"].lifecycle).toBe("postponed");
    expect(byId["2262600"].lifecycle).toBe("canceled");
    expect(byId["2262700"].lifecycle).toBe("unknown");
  });
});
