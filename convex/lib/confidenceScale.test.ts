import { describe, expect, it } from "vitest";
import {
  CONFIDENCE_SCALE_MAX,
  confidenceValuesForGameCount,
  defaultConfidenceRanking,
  isUniqueConfidenceAssignment,
  isValidTiebreakerPrediction,
  orderPickSheetGames,
} from "./confidenceScale";

describe("confidenceValuesForGameCount", () => {
  it("uses highest N values from the season scale (14-game week → 3–16)", () => {
    expect(confidenceValuesForGameCount(14)).toEqual([
      3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
    ]);
  });

  it("uses full scale when week has scaleMax games", () => {
    expect(confidenceValuesForGameCount(CONFIDENCE_SCALE_MAX)).toEqual(
      Array.from({ length: 16 }, (_, i) => i + 1),
    );
  });

  it("rejects counts above the Confidence Scale", () => {
    expect(() => confidenceValuesForGameCount(17)).toThrow(/exceeds/i);
  });
});

describe("defaultConfidenceRanking", () => {
  it("assigns scale max to the first Pick Sheet game then descends", () => {
    expect(defaultConfidenceRanking(3)).toEqual([16, 15, 14]);
  });

  it("matches a two-game week", () => {
    expect(defaultConfidenceRanking(2)).toEqual([16, 15]);
  });
});

describe("orderPickSheetGames", () => {
  it("orders by kickoff then stableKey for shared kickoffs", () => {
    const kickoff = 1_000_000;
    const ordered = orderPickSheetGames([
      { scheduledKickoffMs: kickoff + 1000, stableKey: "nfl:z" },
      { scheduledKickoffMs: kickoff, stableKey: "nfl:b" },
      { scheduledKickoffMs: kickoff, stableKey: "nfl:a" },
    ]);
    expect(ordered.map((g) => g.stableKey)).toEqual([
      "nfl:a",
      "nfl:b",
      "nfl:z",
    ]);
  });
});

describe("isValidTiebreakerPrediction", () => {
  it("accepts whole numbers 0 through 200", () => {
    expect(isValidTiebreakerPrediction(0)).toBe(true);
    expect(isValidTiebreakerPrediction(200)).toBe(true);
    expect(isValidTiebreakerPrediction(47)).toBe(true);
  });

  it("rejects out of range and non-integers", () => {
    expect(isValidTiebreakerPrediction(-1)).toBe(false);
    expect(isValidTiebreakerPrediction(201)).toBe(false);
    expect(isValidTiebreakerPrediction(1.5)).toBe(false);
  });
});

describe("isUniqueConfidenceAssignment (acceptance scenario 23)", () => {
  it("accepts a permutation of the allowed values", () => {
    expect(isUniqueConfidenceAssignment([14, 16, 15], [16, 15, 14])).toBe(true);
  });

  it("rejects duplicates and values outside the allowed set", () => {
    expect(isUniqueConfidenceAssignment([16, 16, 14], [16, 15, 14])).toBe(
      false,
    );
    expect(isUniqueConfidenceAssignment([16, 15, 13], [16, 15, 14])).toBe(
      false,
    );
  });
});
