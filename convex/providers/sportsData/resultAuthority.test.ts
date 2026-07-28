import { describe, expect, it } from "vitest";

import { immediateVerifiedResult } from "./resultAuthority";

const OBSERVED_AT_MS = Date.UTC(2026, 8, 13, 20);

describe("immediate API-Sports terminal result authority", () => {
  it.each(["FT", "AOT"] as const)(
    "accepts the first coherent %s observation",
    (rawShort) => {
      expect(
        immediateVerifiedResult({
          observedAtMs: OBSERVED_AT_MS,
          lifecycle: "terminal",
          homeScore: 27,
          awayScore: 24,
          providerStatus: {
            rawShort,
            recognized: true,
            terminal: true,
          },
        }),
      ).toEqual({
        accepted: true,
        result: {
          homeScore: 27,
          awayScore: 24,
          verifiedAtMs: OBSERVED_AT_MS,
          status: rawShort,
        },
      });
    },
  );

  it.each([
    [27.5, 24],
    [-1, 24],
    [27, Number.NaN],
    [null, 24],
  ])("rejects incoherent terminal scores %s-%s", (homeScore, awayScore) => {
    expect(
      immediateVerifiedResult({
        observedAtMs: OBSERVED_AT_MS,
        lifecycle: "terminal",
        homeScore,
        awayScore,
        providerStatus: {
          rawShort: "FT",
          recognized: true,
          terminal: true,
        },
      }),
    ).toEqual({ accepted: false, reason: "incoherent_scores" });
  });

  it("accepts cancellation without provider scores and canonicalizes it for existing No-Contest rules", () => {
    expect(
      immediateVerifiedResult({
        observedAtMs: OBSERVED_AT_MS,
        lifecycle: "canceled",
        homeScore: null,
        awayScore: null,
        providerStatus: {
          rawShort: "CANC",
          recognized: true,
          terminal: true,
        },
      }),
    ).toEqual({
      accepted: true,
      result: {
        homeScore: 0,
        awayScore: 0,
        verifiedAtMs: OBSERVED_AT_MS,
        status: "CANC",
      },
    });
  });

  it("rejects lifecycle/status combinations that are not trusted terminal evidence", () => {
    expect(
      immediateVerifiedResult({
        observedAtMs: OBSERVED_AT_MS,
        lifecycle: "in_progress",
        homeScore: 27,
        awayScore: 24,
        providerStatus: {
          rawShort: "Q4",
          recognized: true,
          terminal: false,
        },
      }),
    ).toEqual({ accepted: false, reason: "not_terminal" });
  });
});
