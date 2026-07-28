import { describe, expect, it } from "vitest";
import { currentSurvivorStandingsWeek } from "./survivorStandings";

describe("currentSurvivorStandingsWeek", () => {
  it("focuses the pool start week when no picks exist", () => {
    expect(
      currentSurvivorStandingsWeek({
        weeks: Array.from({ length: 18 }, (_, index) => index + 1),
        rows: [{ cells: [] }],
        startWeek: 1,
      }),
    ).toBe(1);
  });

  it("prefers the earliest open pick, then the latest locked pick", () => {
    const weeks = [1, 2, 3, 4];

    expect(
      currentSurvivorStandingsWeek({
        weeks,
        rows: [
          {
            cells: [
              { week: 1, hasPick: true, locked: true },
              { week: 2, hasPick: true, locked: true },
              { week: 3, hasPick: true, locked: false },
            ],
          },
        ],
        startWeek: 1,
      }),
    ).toBe(3);

    expect(
      currentSurvivorStandingsWeek({
        weeks,
        rows: [
          {
            cells: [
              { week: 1, hasPick: true, locked: true },
              { week: 2, hasPick: true, locked: true },
            ],
          },
        ],
        startWeek: 1,
      }),
    ).toBe(2);
  });
});
