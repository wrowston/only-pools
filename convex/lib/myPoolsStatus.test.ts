import { describe, expect, it } from "vitest";
import { aggregatePickStatuses, resolveBoardWeek } from "./myPoolsStatus";

describe("aggregatePickStatuses", () => {
  it("needs_pick when any eligible entry still needs a pick", () => {
    expect(
      aggregatePickStatuses(["pick_saved", "needs_pick", "pick_locked"]),
    ).toBe("needs_pick");
  });

  it("pick_locked only when every eligible entry is locked", () => {
    expect(aggregatePickStatuses(["pick_locked", "not_eligible"])).toBe(
      "pick_locked",
    );
  });

  it("not_eligible when every entry is done", () => {
    expect(
      aggregatePickStatuses(["not_eligible", "not_eligible"]),
    ).toBe("not_eligible");
  });
});

describe("resolveBoardWeek", () => {
  it("returns startWeek when the season has no games", () => {
    expect(
      resolveBoardWeek({
        startWeek: 3,
        earliestKickoffByWeek: new Map(),
        nowMs: 1_000,
      }),
    ).toBe(3);
  });

  it("returns the first upcoming week before any kickoff", () => {
    expect(
      resolveBoardWeek({
        startWeek: 1,
        earliestKickoffByWeek: new Map([
          [1, 2_000],
          [2, 3_000],
        ]),
        nowMs: 1_000,
      }),
    ).toBe(1);
  });

  it("stays on the in-progress week until the next week starts", () => {
    expect(
      resolveBoardWeek({
        startWeek: 1,
        earliestKickoffByWeek: new Map([
          [1, 500],
          [2, 3_000],
        ]),
        nowMs: 1_000,
      }),
    ).toBe(1);
  });

  it("advances once the next week's earliest kickoff has started", () => {
    expect(
      resolveBoardWeek({
        startWeek: 1,
        earliestKickoffByWeek: new Map([
          [1, 500],
          [2, 900],
          [3, 5_000],
        ]),
        nowMs: 1_000,
      }),
    ).toBe(2);
  });

  it("returns the last week when every week has started", () => {
    expect(
      resolveBoardWeek({
        startWeek: 1,
        earliestKickoffByWeek: new Map([
          [1, 100],
          [2, 200],
        ]),
        nowMs: 1_000,
      }),
    ).toBe(2);
  });

  it("ignores weeks before the Pool start week", () => {
    expect(
      resolveBoardWeek({
        startWeek: 3,
        earliestKickoffByWeek: new Map([
          [1, 100],
          [2, 200],
          [3, 5_000],
        ]),
        nowMs: 1_000,
      }),
    ).toBe(3);
  });
});
