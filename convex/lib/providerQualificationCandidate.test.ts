import { describe, expect, it } from "vitest";

import type { ApiSportsGame } from "../providers/apiSports";
import {
  QUALIFICATION_KICKOFF_TOLERANCE_MS,
  qualificationCandidateRejection,
} from "./providerQualificationCandidate";

const KICKOFF_MS = Date.UTC(2026, 7, 15, 20);

function game(
  overrides: Partial<ApiSportsGame> = {},
): ApiSportsGame {
  return {
    stableKey: "nfl-game:2026:w1:franchise-1@franchise-2",
    seasonYear: 2026,
    week: 1,
    homeTeamAbbreviation: "DEN",
    awayTeamAbbreviation: "KC",
    scheduledKickoffMs: KICKOFF_MS,
    lifecycle: "scheduled",
    homeScore: 0,
    awayScore: 0,
    observedAtMs: KICKOFF_MS,
    providerAliases: [{ provider: "api-sports", id: "fixture-1" }],
    providerStage: "Pre Season",
    seasonPhase: "preseason",
    providerStatus: {
      rawShort: "NS",
      rawLong: "Not Started",
      recognized: true,
      terminal: false,
    },
    ...overrides,
  } as ApiSportsGame;
}

function rejection(overrides: Partial<ApiSportsGame> = {}) {
  return qualificationCandidateRejection({
    expectedExternalId: "fixture-1",
    expectedSeasonYear: 2026,
    expectedKickoffMs: KICKOFF_MS,
    expectedHomeTeam: "DEN",
    expectedAwayTeam: "KC",
    game: game(overrides),
  });
}

describe("qualification API-Sports candidate validation", () => {
  it("accepts only the actual bound preseason game within kickoff tolerance", () => {
    expect(rejection()).toBeNull();
    expect(
      rejection({
        scheduledKickoffMs:
          KICKOFF_MS + QUALIFICATION_KICKOFF_TOLERANCE_MS,
      }),
    ).toBeNull();
  });

  it.each([
    [
      "external_id_mismatch",
      { providerAliases: [{ provider: "api-sports", id: "wrong" }] },
    ],
    ["season_year_mismatch", { seasonYear: 2025 }],
    [
      "kickoff_mismatch",
      {
        scheduledKickoffMs:
          KICKOFF_MS + QUALIFICATION_KICKOFF_TOLERANCE_MS + 1,
      },
    ],
    [
      "home_away_reversal",
      {
        homeTeamAbbreviation: "KC",
        awayTeamAbbreviation: "DEN",
      },
    ],
    ["identity_mismatch", { homeTeamAbbreviation: "KC" }],
    [
      "phase_mismatch",
      { providerStage: "Regular Season", seasonPhase: "regular_season" },
    ],
  ] as const)("rejects %s", (reason, overrides) => {
    expect(rejection(overrides as Partial<ApiSportsGame>)).toBe(reason);
  });
});
