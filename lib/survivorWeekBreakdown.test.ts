import { describe, expect, it } from "vitest";
import {
  buildSurvivorWeekBreakdown,
  type SurvivorBreakdownCell,
} from "./survivorWeekBreakdown";

function cell(
  overrides: Partial<SurvivorBreakdownCell>,
): SurvivorBreakdownCell {
  return {
    week: 2,
    locked: true,
    teamAbbreviation: "KC",
    teamName: "Kansas City Chiefs",
    provenance: "authored",
    outcome: "win",
    ...overrides,
  };
}

describe("Survivor weekly breakdown", () => {
  it("counts survived, eliminated, and missed with missed as a subset", () => {
    const result = buildSurvivorWeekBreakdown(
      [
        { eliminatedWeek: null, cells: [cell({})] },
        {
          eliminatedWeek: 2,
          cells: [
            cell({
              teamAbbreviation: "BUF",
              teamName: "Buffalo Bills",
              outcome: "loss",
            }),
          ],
        },
        {
          eliminatedWeek: 2,
          cells: [
            cell({
              teamAbbreviation: null,
              teamName: null,
              provenance: "omission",
              outcome: "missing_pick",
            }),
          ],
        },
      ],
      2,
    );

    expect(result).toMatchObject({
      eligibleEntries: 3,
      survived: 1,
      survivedPercentage: 33,
      eliminated: 2,
      eliminatedPercentage: 67,
      missed: 1,
      missedPercentage: 33,
    });
    expect(result.teams).toEqual([
      {
        abbreviation: "BUF",
        name: "Buffalo Bills",
        picks: 1,
        percentage: 33.3,
        outcome: "eliminated",
      },
      {
        abbreviation: "KC",
        name: "Kansas City Chiefs",
        picks: 1,
        percentage: 33.3,
        outcome: "survived",
      },
    ]);
  });

  it("excludes prior eliminations and unlocked picks from the distribution", () => {
    const result = buildSurvivorWeekBreakdown(
      [
        { eliminatedWeek: 1, cells: [cell({ outcome: null })] },
        {
          eliminatedWeek: null,
          cells: [cell({ locked: false, outcome: null })],
        },
      ],
      2,
    );

    expect(result.eligibleEntries).toBe(1);
    expect(result.lockedEntries).toBe(0);
    expect(result.teams).toEqual([]);
  });

  it("labels locked unresolved team picks as pending", () => {
    const result = buildSurvivorWeekBreakdown(
      [{ eliminatedWeek: null, cells: [cell({ outcome: null })] }],
      2,
    );

    expect(result.pending).toBe(1);
    expect(result.teams[0]?.outcome).toBe("pending");
  });
});
