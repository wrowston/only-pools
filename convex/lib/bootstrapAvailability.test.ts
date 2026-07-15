import { describe, expect, it } from "vitest";
import {
  evaluateBootstrapAvailability,
  type BootstrapGameInput,
} from "./bootstrapAvailability";

function game(
  overrides: Partial<BootstrapGameInput> & Pick<BootstrapGameInput, "week">,
): BootstrapGameInput {
  return {
    scheduledKickoffMs: Date.parse("2026-09-13T17:00:00Z"),
    lifecycle: "scheduled",
    ...overrides,
  };
}

describe("Bootstrap availability rule (acceptance scenario 7)", () => {
  it("keeps season bootstrapping when there are no regular-season games", () => {
    expect(evaluateBootstrapAvailability([], Date.parse("2026-08-01T00:00:00Z"))).toEqual({
      status: "bootstrapping",
      usableStartWeek: null,
      reason: "no_usable_start_week",
    });
  });

  it("marks Available when at least one week slate has scheduled games", () => {
    const games = [
      game({ week: 1 }),
      game({ week: 1, scheduledKickoffMs: Date.parse("2026-09-13T20:00:00Z") }),
      game({ week: 2 }),
    ];
    expect(
      evaluateBootstrapAvailability(games, Date.parse("2026-08-01T00:00:00Z")),
    ).toEqual({
      status: "available",
      usableStartWeek: 1,
      reason: "usable_start_week",
    });
  });

  it("skips empty weeks and picks the first week that has games", () => {
    const games = [game({ week: 3 }), game({ week: 5 })];
    expect(
      evaluateBootstrapAvailability(games, Date.parse("2026-08-01T00:00:00Z")),
    ).toEqual({
      status: "available",
      usableStartWeek: 3,
      reason: "usable_start_week",
    });
  });

  it("treats a published regular-season week with games as usable even if kickoffs are past", () => {
    // Start Week usability for Available Season = has games on a published slate.
    // Future-kickoff filtering is a Create Pool concern (ticket 03).
    const games = [
      game({
        week: 1,
        scheduledKickoffMs: Date.parse("2025-09-07T17:00:00Z"),
        lifecycle: "terminal",
      }),
    ];
    expect(
      evaluateBootstrapAvailability(games, Date.parse("2026-07-15T00:00:00Z")),
    ).toEqual({
      status: "available",
      usableStartWeek: 1,
      reason: "usable_start_week",
    });
  });
});
