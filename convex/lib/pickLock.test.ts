import { describe, expect, it } from "vitest";
import {
  computeWeeklyCutoffMs,
  isGameKickoffLocked,
  isSurvivorPickLocked,
} from "./pickLock";

describe("isGameKickoffLocked (acceptance scenario 20)", () => {
  const kickoff = 1_000_000;

  it("is unlocked before scheduled kickoff while scheduled", () => {
    expect(
      isGameKickoffLocked(
        { scheduledKickoffMs: kickoff, lifecycle: "scheduled" },
        kickoff - 1,
      ),
    ).toBe(false);
  });

  it("locks at exact scheduled kickoff with no grace period", () => {
    expect(
      isGameKickoffLocked(
        { scheduledKickoffMs: kickoff, lifecycle: "scheduled" },
        kickoff,
      ),
    ).toBe(true);
  });

  it("locks when provider reports play started before kickoff clock", () => {
    expect(
      isGameKickoffLocked(
        { scheduledKickoffMs: kickoff, lifecycle: "in_progress" },
        kickoff - 60_000,
      ),
    ).toBe(true);
  });

  it("locks for terminal and interrupted lifecycles", () => {
    expect(
      isGameKickoffLocked(
        { scheduledKickoffMs: kickoff, lifecycle: "terminal" },
        kickoff - 1,
      ),
    ).toBe(true);
    expect(
      isGameKickoffLocked(
        { scheduledKickoffMs: kickoff, lifecycle: "interrupted" },
        kickoff - 1,
      ),
    ).toBe(true);
  });

  it("does not treat postponed or canceled alone as kickoff lock", () => {
    expect(
      isGameKickoffLocked(
        { scheduledKickoffMs: kickoff, lifecycle: "postponed" },
        kickoff - 1,
      ),
    ).toBe(false);
    expect(
      isGameKickoffLocked(
        { scheduledKickoffMs: kickoff, lifecycle: "canceled" },
        kickoff - 1,
      ),
    ).toBe(false);
  });
});

describe("isSurvivorPickLocked", () => {
  const game = { scheduledKickoffMs: 5_000_000, lifecycle: "scheduled" };

  it("under gameKickoff ignores weekly cutoff", () => {
    expect(
      isSurvivorPickLocked({
        pickLockMode: "gameKickoff",
        game,
        weeklyCutoffMs: 1_000,
        nowMs: 2_000,
      }),
    ).toBe(false);
  });

  it("under weeklyCutoff locks at Sunday cutoff before later kickoff", () => {
    expect(
      isSurvivorPickLocked({
        pickLockMode: "weeklyCutoff",
        game,
        weeklyCutoffMs: 3_000,
        nowMs: 3_000,
      }),
    ).toBe(true);
  });
});

describe("computeWeeklyCutoffMs", () => {
  it("returns Sunday 1:00 p.m. Eastern for a Thursday kickoff week", () => {
    // 2025-09-04 20:15 UTC ≈ Thu 4:15 p.m. ET
    const thursdayKickoff = Date.parse("2025-09-04T20:15:00.000Z");
    const cutoff = computeWeeklyCutoffMs(thursdayKickoff);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(cutoff));
    const weekday = parts.find((p) => p.type === "weekday")?.value;
    const hour = parts.find((p) => p.type === "hour")?.value;
    const minute = parts.find((p) => p.type === "minute")?.value;
    expect(weekday).toBe("Sun");
    expect(hour).toBe("13");
    expect(minute).toBe("00");
  });
});
