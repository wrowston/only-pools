import { describe, expect, it } from "vitest";
import {
  buildSurvivorWeekFingerprint,
  decideSurvivorTerminalOutcome,
  resolveSurvivorPickOutcome,
} from "./survivorScoring";

describe("resolveSurvivorPickOutcome (scenario 32)", () => {
  const verifiedWin = {
    gameId: "g1",
    homeTeamId: "kc",
    awayTeamId: "buf",
    resultAuthority: "verified",
    homeScore: 27,
    awayScore: 24,
    verifiedStatus: "FT",
  };

  it("keeps Alive on verified win", () => {
    expect(
      resolveSurvivorPickOutcome({
        pick: {
          participantId: "p1",
          week: 1,
          nflTeamId: "kc",
          gameId: "g1",
          provenance: "authored",
          provisional: false,
        },
        game: verifiedWin,
        weekFullyLocked: true,
      }),
    ).toBe("win");
  });

  it("eliminates on verified loss", () => {
    expect(
      resolveSurvivorPickOutcome({
        pick: {
          participantId: "p1",
          week: 1,
          nflTeamId: "buf",
          gameId: "g1",
          provenance: "authored",
          provisional: false,
        },
        game: verifiedWin,
        weekFullyLocked: true,
      }),
    ).toBe("loss");
  });

  it("eliminates on verified tie", () => {
    expect(
      resolveSurvivorPickOutcome({
        pick: {
          participantId: "p1",
          week: 1,
          nflTeamId: "kc",
          gameId: "g1",
          provenance: "authored",
          provisional: false,
        },
        game: {
          ...verifiedWin,
          homeScore: 17,
          awayScore: 17,
        },
        weekFullyLocked: true,
      }),
    ).toBe("tie");
  });

  it("eliminates on missing required pick when week is fully locked", () => {
    expect(
      resolveSurvivorPickOutcome({
        pick: {
          participantId: "p1",
          week: 1,
          provenance: "omission",
          provisional: false,
        },
        game: null,
        weekFullyLocked: true,
      }),
    ).toBe("missing_pick");
  });

  it("stays pending when pick game is not yet Verified", () => {
    expect(
      resolveSurvivorPickOutcome({
        pick: {
          participantId: "p1",
          week: 1,
          nflTeamId: "kc",
          gameId: "g1",
          provenance: "authored",
          provisional: false,
        },
        game: {
          ...verifiedWin,
          resultAuthority: "confirmation_pending",
        },
        weekFullyLocked: true,
      }),
    ).toBe("pending");
  });

  it("never treats provisional authority as official", () => {
    expect(
      resolveSurvivorPickOutcome({
        pick: {
          participantId: "p1",
          week: 1,
          nflTeamId: "kc",
          gameId: "g1",
          provenance: "authored",
          provisional: false,
        },
        game: {
          ...verifiedWin,
          resultAuthority: "projected",
        },
        weekFullyLocked: true,
      }),
    ).toBe("pending");
  });
});

describe("decideSurvivorTerminalOutcome (scenario 34)", () => {
  it("names sole Alive as Winner after a settled week", () => {
    expect(
      decideSurvivorTerminalOutcome({
        week: 3,
        finalWeek: 18,
        weekSettled: true,
        enteredAliveIds: ["a", "b"],
        afterWeek: [
          { participantId: "a", eligibility: "alive" },
          { participantId: "b", eligibility: "eliminated" },
        ],
      }),
    ).toEqual({ kind: "sole_winner", winnerParticipantId: "a" });
  });

  it("names joint winners when every Alive entrant is eliminated", () => {
    expect(
      decideSurvivorTerminalOutcome({
        week: 2,
        finalWeek: 18,
        weekSettled: true,
        enteredAliveIds: ["a", "b"],
        afterWeek: [
          { participantId: "a", eligibility: "eliminated" },
          { participantId: "b", eligibility: "eliminated" },
        ],
      }),
    ).toEqual({
      kind: "joint_winners",
      winnerParticipantIds: ["a", "b"],
    });
  });

  it("names joint winners when multiple Alive remain after final week", () => {
    expect(
      decideSurvivorTerminalOutcome({
        week: 18,
        finalWeek: 18,
        weekSettled: true,
        enteredAliveIds: ["a", "b", "c"],
        afterWeek: [
          { participantId: "a", eligibility: "alive" },
          { participantId: "b", eligibility: "alive" },
          { participantId: "c", eligibility: "eliminated" },
        ],
      }),
    ).toEqual({
      kind: "joint_winners",
      winnerParticipantIds: ["a", "b"],
    });
  });

  it("does not crown winners from an unsettled week", () => {
    expect(
      decideSurvivorTerminalOutcome({
        week: 1,
        finalWeek: 18,
        weekSettled: false,
        enteredAliveIds: ["a"],
        afterWeek: [{ participantId: "a", eligibility: "alive" }],
      }),
    ).toEqual({ kind: "none" });
  });
});

describe("survivor scoring fingerprint idempotency", () => {
  it("is stable for identical authoritative inputs", () => {
    const args = {
      poolId: "pool1",
      week: 1,
      priorEligibility: [
        { participantId: "b", eligibility: "alive" },
        { participantId: "a", eligibility: "alive" },
      ],
      picks: [
        {
          participantId: "b",
          nflTeamId: "buf",
          gameId: "g1",
          provenance: "authored",
        },
        {
          participantId: "a",
          nflTeamId: "kc",
          gameId: "g1",
          provenance: "authored",
        },
      ],
      verifiedGames: [
        { gameId: "g1", homeScore: 27, awayScore: 24, status: "FT" },
      ],
      weekFullyLocked: true,
    };
    expect(buildSurvivorWeekFingerprint(args)).toBe(
      buildSurvivorWeekFingerprint({
        ...args,
        priorEligibility: [...args.priorEligibility].reverse(),
        picks: [...args.picks].reverse(),
      }),
    );
  });

  it("changes when a Verified Result score changes", () => {
    const base = {
      poolId: "pool1",
      week: 1,
      priorEligibility: [{ participantId: "a", eligibility: "alive" }],
      picks: [
        {
          participantId: "a",
          nflTeamId: "kc",
          gameId: "g1",
          provenance: "authored",
        },
      ],
      verifiedGames: [
        { gameId: "g1", homeScore: 27, awayScore: 24, status: "FT" },
      ],
      weekFullyLocked: true,
    };
    const changed = {
      ...base,
      verifiedGames: [
        { gameId: "g1", homeScore: 20, awayScore: 24, status: "FT" },
      ],
    };
    expect(buildSurvivorWeekFingerprint(base)).not.toBe(
      buildSurvivorWeekFingerprint(changed),
    );
  });
});
