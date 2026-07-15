import { describe, expect, it } from "vitest";
import {
  assignCompetitionRanks,
  buildConfidenceWeekFingerprint,
  compareWeeklyTiebreaker,
  computePossibleRemainingPoints,
  computeWeeklyPoints,
  rankWeeklyStandings,
  resolveConfidencePickOutcome,
  weekFullyResolved,
} from "./confidenceScoring";

describe("resolveConfidencePickOutcome (scenario 15)", () => {
  const verifiedHomeWin = {
    gameId: "g1",
    homeTeamId: "kc",
    awayTeamId: "buf",
    resultAuthority: "verified",
    homeScore: 27,
    awayScore: 24,
    verifiedStatus: "FT",
  };

  it("awards the assigned confidence value on a correct pick", () => {
    expect(
      resolveConfidencePickOutcome({
        pick: {
          gameId: "g1",
          pickedTeamId: "kc",
          confidenceValue: 16,
          provenance: "authored",
          locked: true,
        },
        game: verifiedHomeWin,
      }),
    ).toEqual({ outcome: "correct", pointsEarned: 16 });
  });

  it("awards zero on an incorrect pick without redistributing", () => {
    expect(
      resolveConfidencePickOutcome({
        pick: {
          gameId: "g1",
          pickedTeamId: "buf",
          confidenceValue: 16,
          provenance: "authored",
          locked: true,
        },
        game: verifiedHomeWin,
      }),
    ).toEqual({ outcome: "incorrect", pointsEarned: 0 });
  });

  it("awards zero for a blank locked omission", () => {
    expect(
      resolveConfidencePickOutcome({
        pick: {
          gameId: "g1",
          confidenceValue: 12,
          provenance: "omission",
          locked: true,
        },
        game: verifiedHomeWin,
      }),
    ).toEqual({ outcome: "omission_zero", pointsEarned: 0 });
  });

  it("awards zero on a verified tie without redistributing", () => {
    expect(
      resolveConfidencePickOutcome({
        pick: {
          gameId: "g1",
          pickedTeamId: "kc",
          confidenceValue: 14,
          provenance: "authored",
          locked: true,
        },
        game: {
          ...verifiedHomeWin,
          homeScore: 17,
          awayScore: 17,
        },
      }),
    ).toEqual({ outcome: "tied_zero", pointsEarned: 0 });
  });

  it("awards zero on a canceled Verified Result without redistributing", () => {
    expect(
      resolveConfidencePickOutcome({
        pick: {
          gameId: "g1",
          pickedTeamId: "kc",
          confidenceValue: 15,
          provenance: "authored",
          locked: true,
        },
        game: {
          ...verifiedHomeWin,
          homeScore: 0,
          awayScore: 0,
          verifiedStatus: "CANC",
        },
      }),
    ).toEqual({ outcome: "canceled_zero", pointsEarned: 0 });
  });

  it("stays pending until the game is Verified", () => {
    expect(
      resolveConfidencePickOutcome({
        pick: {
          gameId: "g1",
          pickedTeamId: "kc",
          confidenceValue: 16,
          provenance: "authored",
          locked: true,
        },
        game: {
          ...verifiedHomeWin,
          resultAuthority: "projected",
        },
      }),
    ).toEqual({ outcome: "pending", pointsEarned: 0 });
  });
});

describe("computePossibleRemainingPoints (official-only)", () => {
  it("includes unlocked blanks and unresolved valid picks; excludes locked omissions and known incorrect", () => {
    const points = computePossibleRemainingPoints([
      {
        pick: {
          gameId: "g1",
          pickedTeamId: "kc",
          confidenceValue: 16,
          provenance: "authored",
          locked: true,
        },
        game: {
          gameId: "g1",
          homeTeamId: "kc",
          awayTeamId: "buf",
          resultAuthority: "verified",
          homeScore: 27,
          awayScore: 24,
          verifiedStatus: "FT",
        },
      },
      {
        pick: {
          gameId: "g2",
          pickedTeamId: "phi",
          confidenceValue: 15,
          provenance: "authored",
          locked: true,
        },
        game: {
          gameId: "g2",
          homeTeamId: "phi",
          awayTeamId: "dal",
          resultAuthority: "none",
          homeScore: null,
          awayScore: null,
        },
      },
      {
        pick: {
          gameId: "g3",
          confidenceValue: 14,
          provenance: "omission",
          locked: true,
        },
        game: {
          gameId: "g3",
          homeTeamId: "sf",
          awayTeamId: "sea",
          resultAuthority: "none",
          homeScore: null,
          awayScore: null,
        },
      },
      {
        pick: {
          gameId: "g4",
          confidenceValue: 13,
          provenance: "authored",
          locked: false,
        },
        game: {
          gameId: "g4",
          homeTeamId: "bal",
          awayTeamId: "cin",
          resultAuthority: "none",
          homeScore: null,
          awayScore: null,
        },
      },
      {
        pick: {
          gameId: "g5",
          pickedTeamId: "dal",
          confidenceValue: 12,
          provenance: "authored",
          locked: true,
        },
        game: {
          gameId: "g5",
          homeTeamId: "phi",
          awayTeamId: "dal",
          resultAuthority: "verified",
          homeScore: 21,
          awayScore: 10,
          verifiedStatus: "FT",
        },
      },
    ]);
    // g2 unresolved valid (15) + g4 unlocked blank (13); g1 earned, g3 omission, g5 incorrect
    expect(points).toBe(28);
  });
});

describe("computeWeeklyPoints (scenario 15)", () => {
  it("sums earned values only from verified outcomes", () => {
    expect(
      computeWeeklyPoints([
        { pointsEarned: 16 },
        { pointsEarned: 0 },
        { pointsEarned: 0 },
        { pointsEarned: 14 },
      ]),
    ).toBe(30);
  });
});

describe("compareWeeklyTiebreaker (scenario 18)", () => {
  it("ranks smaller absolute error ahead", () => {
    expect(
      compareWeeklyTiebreaker(
        { prediction: 45, actualTotal: 50 },
        { prediction: 60, actualTotal: 50 },
      ),
    ).toBeLessThan(0);
  });

  it("ranks the lower prediction ahead on equal distance", () => {
    expect(
      compareWeeklyTiebreaker(
        { prediction: 45, actualTotal: 50 },
        { prediction: 55, actualTotal: 50 },
      ),
    ).toBeLessThan(0);
  });

  it("ranks any valid prediction ahead of an omission", () => {
    expect(
      compareWeeklyTiebreaker(
        { prediction: 200, actualTotal: 50 },
        { prediction: null, actualTotal: 50 },
      ),
    ).toBeLessThan(0);
  });

  it("treats joint omissions as equal", () => {
    expect(
      compareWeeklyTiebreaker(
        { prediction: null, actualTotal: 50 },
        { prediction: null, actualTotal: 50 },
      ),
    ).toBe(0);
  });

  it("shares when the tiebreaker game is unusable", () => {
    expect(
      compareWeeklyTiebreaker(
        { prediction: 45, actualTotal: null },
        { prediction: 60, actualTotal: null },
      ),
    ).toBe(0);
  });
});

describe("rankWeeklyStandings (scenarios 17–18)", () => {
  it("orders by points then usable tiebreaker; shared ranks when unusable", () => {
    // actual=50: b err=5 beats a err=10; d has a prediction so beats omitted c
    const ranked = rankWeeklyStandings(
      [
        { participantId: "a", points: 30, tiebreakerPrediction: 40 },
        { participantId: "b", points: 30, tiebreakerPrediction: 55 },
        { participantId: "c", points: 20, tiebreakerPrediction: null },
        { participantId: "d", points: 20, tiebreakerPrediction: 10 },
      ],
      { actualTotal: 50, usable: true },
    );
    expect(ranked.map((r) => r.participantId)).toEqual(["b", "a", "d", "c"]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
  });

  it("shares competition rank when tiebreaker is canceled/unusable", () => {
    const ranked = rankWeeklyStandings(
      [
        { participantId: "a", points: 30, tiebreakerPrediction: 40 },
        { participantId: "b", points: 30, tiebreakerPrediction: 55 },
        { participantId: "c", points: 10, tiebreakerPrediction: null },
      ],
      { actualTotal: null, usable: false },
    );
    expect(ranked.map((r) => r.participantId)).toEqual(["a", "b", "c"]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 1, 3]);
  });
});

describe("assignCompetitionRanks", () => {
  it("produces 1, 2, 2, 4 competition ranks", () => {
    expect(
      assignCompetitionRanks([
        { key: "a", sortGroup: 0 },
        { key: "b", sortGroup: 1 },
        { key: "c", sortGroup: 1 },
        { key: "d", sortGroup: 2 },
      ]),
    ).toEqual([
      { key: "a", rank: 1 },
      { key: "b", rank: 2 },
      { key: "c", rank: 2 },
      { key: "d", rank: 4 },
    ]);
  });
});

describe("weekFullyResolved", () => {
  it("requires every required game to have a Verified Result", () => {
    expect(
      weekFullyResolved([
        { resultAuthority: "verified" },
        { resultAuthority: "verified" },
      ]),
    ).toBe(true);
    expect(
      weekFullyResolved([
        { resultAuthority: "verified" },
        { resultAuthority: "projected" },
      ]),
    ).toBe(false);
    expect(weekFullyResolved([])).toBe(false);
  });
});

describe("buildConfidenceWeekFingerprint (scenario 33)", () => {
  it("is stable for identical authoritative inputs", () => {
    const args = {
      poolId: "pool1",
      week: 1,
      picks: [
        {
          participantId: "p2",
          gameId: "g1",
          pickedTeamId: "kc",
          confidenceValue: 16,
          provenance: "authored",
          locked: true,
        },
        {
          participantId: "p1",
          gameId: "g1",
          pickedTeamId: "buf",
          confidenceValue: 16,
          provenance: "authored",
          locked: true,
        },
      ],
      pickSets: [
        { participantId: "p2", tiebreakerPrediction: 45 },
        { participantId: "p1", tiebreakerPrediction: undefined },
      ],
      verifiedGames: [
        {
          gameId: "g1",
          homeScore: 27,
          awayScore: 24,
          status: "FT",
        },
      ],
      gameLocks: [{ gameId: "g1", locked: true }],
    };
    expect(buildConfidenceWeekFingerprint(args)).toBe(
      buildConfidenceWeekFingerprint({
        ...args,
        picks: [...args.picks].reverse(),
        pickSets: [...args.pickSets].reverse(),
      }),
    );
  });

  it("changes when a Verified Result changes", () => {
    const base = {
      poolId: "pool1",
      week: 1,
      picks: [] as Array<{
        participantId: string;
        gameId: string;
        pickedTeamId?: string;
        confidenceValue: number;
        provenance: string;
        locked: boolean;
      }>,
      pickSets: [] as Array<{
        participantId: string;
        tiebreakerPrediction?: number;
      }>,
      verifiedGames: [
        { gameId: "g1", homeScore: 27, awayScore: 24, status: "FT" },
      ],
      gameLocks: [{ gameId: "g1", locked: true }],
    };
    expect(buildConfidenceWeekFingerprint(base)).not.toBe(
      buildConfidenceWeekFingerprint({
        ...base,
        verifiedGames: [
          { gameId: "g1", homeScore: 30, awayScore: 24, status: "FT" },
        ],
      }),
    );
  });
});
