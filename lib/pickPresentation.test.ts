import { describe, expect, it } from "vitest";
import {
  officialWinnerTeamId,
  pickOutcomeLabel,
  pickOutcomeMark,
  resolvePickOutcome,
  teamPickAccessibleName,
} from "./pickPresentation";

describe("pick presentation — won/lost not color-only", () => {
  it("derives official winner from verified scores", () => {
    expect(
      officialWinnerTeamId({
        isOfficial: true,
        verifiedResult: { homeScore: 27, awayScore: 24, status: "FT" },
        homeTeamId: "home",
        awayTeamId: "away",
      }),
    ).toBe("home");
    expect(
      officialWinnerTeamId({
        isOfficial: true,
        verifiedResult: { homeScore: 20, awayScore: 31, status: "AOT" },
        homeTeamId: "home",
        awayTeamId: "away",
      }),
    ).toBe("away");
  });

  it("does not label ties, cancellations, or non-official scores", () => {
    expect(
      officialWinnerTeamId({
        isOfficial: true,
        verifiedResult: { homeScore: 17, awayScore: 17, status: "FT" },
        homeTeamId: "home",
        awayTeamId: "away",
      }),
    ).toBeNull();
    expect(
      officialWinnerTeamId({
        isOfficial: true,
        verifiedResult: { homeScore: 0, awayScore: 0, status: "CANC" },
        homeTeamId: "home",
        awayTeamId: "away",
      }),
    ).toBeNull();
    expect(
      officialWinnerTeamId({
        isOfficial: false,
        verifiedResult: { homeScore: 27, awayScore: 24, status: "FT" },
        homeTeamId: "home",
        awayTeamId: "away",
      }),
    ).toBeNull();
  });

  it("exposes text and mark labels for won and lost", () => {
    expect(pickOutcomeLabel("won")).toBe("Pick won");
    expect(pickOutcomeLabel("lost")).toBe("Pick lost");
    expect(pickOutcomeMark("won")).toBe("✓");
    expect(pickOutcomeMark("lost")).toBe("✕");
    expect(resolvePickOutcome({ pickedTeamId: "a", winnerTeamId: "a" })).toBe(
      "won",
    );
    expect(resolvePickOutcome({ pickedTeamId: "a", winnerTeamId: "b" })).toBe(
      "lost",
    );
  });

  it("includes outcome in accessible pick names", () => {
    expect(
      teamPickAccessibleName({
        teamAbbreviation: "KC",
        selected: true,
        locked: true,
        outcome: "won",
      }),
    ).toBe("KC, selected, locked, Pick won");
    expect(
      teamPickAccessibleName({
        teamAbbreviation: "BUF",
        selected: true,
        locked: true,
        outcome: "lost",
      }),
    ).toBe("BUF, selected, locked, Pick lost");
  });
});
