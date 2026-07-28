import { describe, expect, it } from "vitest";
import {
  CANONICAL_NFL_TEAM_ABBREVIATIONS,
  CANONICAL_NFL_TEAM_LIST,
  CANONICAL_NFL_TEAMS,
} from "./catalog";

describe("canonical NFL Team catalog", () => {
  it("contains exactly the approved 32 canonical abbreviations", () => {
    expect(CANONICAL_NFL_TEAM_ABBREVIATIONS).toEqual([
      "ARI",
      "ATL",
      "BAL",
      "BUF",
      "CAR",
      "CHI",
      "CIN",
      "CLE",
      "DAL",
      "DEN",
      "DET",
      "GB",
      "HOU",
      "IND",
      "JAX",
      "KC",
      "LAC",
      "LAR",
      "LV",
      "MIA",
      "MIN",
      "NE",
      "NO",
      "NYG",
      "NYJ",
      "PHI",
      "PIT",
      "SEA",
      "SF",
      "TB",
      "TEN",
      "WAS",
    ]);
    expect(Object.keys(CANONICAL_NFL_TEAMS)).toHaveLength(32);
  });

  it("retains canonical team data without provider identity fields", () => {
    expect(CANONICAL_NFL_TEAMS.DET).toMatchObject({
      stableKey: "nfl-team:franchise-11",
      abbreviation: "DET",
      name: "Detroit Lions",
    });
    expect(Object.keys(CANONICAL_NFL_TEAMS.DET).sort()).toEqual(
      ["abbreviation", "logoUrl", "name", "stableKey"].sort(),
    );
  });

  it("keeps one safe, unique static badge URL per NFL Team", () => {
    const urls = CANONICAL_NFL_TEAM_LIST.map(({ logoUrl }) => new URL(logoUrl));

    expect(new Set(urls.map(({ href }) => href)).size).toBe(32);
    expect(new Set(urls.map(({ origin }) => origin)).size).toBe(1);
    expect(
      urls.every(
        (url) =>
          url.protocol === "https:" &&
          url.pathname.startsWith("/images/media/team/badge/") &&
          url.pathname.endsWith(".png") &&
          url.search === "" &&
          url.hash === "",
      ),
    ).toBe(true);
  });
});
