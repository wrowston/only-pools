import { describe, expect, it } from "vitest";
import { assertRulesEditable, assertValidStartWeekSlate } from "./poolRules";

describe("assertValidStartWeekSlate", () => {
  it("rejects an empty slate", () => {
    expect(() =>
      assertValidStartWeekSlate({ games: [], nowMs: 1_000 }),
    ).toThrow(/no published slate/);
  });

  it("rejects when the first game has kicked off", () => {
    expect(() =>
      assertValidStartWeekSlate({
        games: [{ scheduledKickoffMs: 500 }, { scheduledKickoffMs: 2_000 }],
        nowMs: 1_000,
      }),
    ).toThrow(/already kicked off/);
  });

  it("accepts a future slate", () => {
    expect(() =>
      assertValidStartWeekSlate({
        games: [{ scheduledKickoffMs: 2_000 }],
        nowMs: 1_000,
      }),
    ).not.toThrow();
  });
});

describe("assertRulesEditable", () => {
  it("allows edits when not frozen", () => {
    expect(() => assertRulesEditable(false)).not.toThrow();
  });

  it("refuses edits when frozen", () => {
    expect(() => assertRulesEditable(true)).toThrow(/frozen/);
  });
});
