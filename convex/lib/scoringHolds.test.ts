import { describe, expect, it } from "vitest";

import {
  scoringHoldCandidateKey,
  selectScoringHoldDependency,
} from "./scoringHolds";

describe("scoring hold policy", () => {
  it("creates a stable candidate key from game and corrected evidence", () => {
    expect(
      scoringHoldCandidateKey({
        gameId: "game_1",
        homeScore: 20,
        awayScore: 28,
        observedAtMs: 1_000,
        status: "FT",
      }),
    ).toBe("game_1:20:28:FT");
    expect(
      scoringHoldCandidateKey({
        gameId: "game_1",
        homeScore: 20,
        awayScore: 28,
        observedAtMs: 99_000,
        status: "FT",
      }),
    ).toBe("game_1:20:28:FT");
  });

  it("selects the first deterministic dependency priority", () => {
    expect(
      selectScoringHoldDependency({
        laterGameLockReached: true,
        laterWeeklyCutoffReached: true,
        laterSettledPoolWeek: true,
        laterSurvivorLock: true,
        laterNonProvisionalSurvivorPick: true,
        laterConfidenceLock: true,
      }),
    ).toBe("later_game_lock");
    expect(
      selectScoringHoldDependency({
        laterGameLockReached: false,
        laterWeeklyCutoffReached: false,
        laterSettledPoolWeek: false,
        laterSurvivorLock: false,
        laterNonProvisionalSurvivorPick: false,
        laterConfidenceLock: true,
      }),
    ).toBe("locked_confidence_pick");
  });
});
