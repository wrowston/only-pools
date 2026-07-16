import { describe, expect, it } from "vitest";
import { resolveBoardWeek } from "./myPoolsStatus";

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
