import { describe, expect, it } from "vitest";
import {
  applyKickoffScheduleChange,
  computeWeeklyCutoffMs,
  isGameKickoffLocked,
  isSurvivorPickLocked,
  isTiebreakerLocked,
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

  it("stays locked when kickoffLockReachedAtMs is latched even if kickoff moves later (scenario 25)", () => {
    expect(
      isGameKickoffLocked(
        {
          scheduledKickoffMs: kickoff + 8 * 60 * 60 * 1000,
          lifecycle: "postponed",
          kickoffLockReachedAtMs: kickoff,
        },
        kickoff + 60_000,
      ),
    ).toBe(true);
  });
});

describe("applyKickoffScheduleChange (scenario 25)", () => {
  const priorKickoff = 1_000_000;

  it("moves an unreached lock with authoritative kickoff change", () => {
    const next = applyKickoffScheduleChange({
      priorScheduledKickoffMs: priorKickoff,
      newScheduledKickoffMs: priorKickoff + 3 * 60 * 60 * 1000,
      nowMs: priorKickoff - 60_000,
      priorLifecycle: "scheduled",
      kickoffLockReachedAtMs: null,
    });
    expect(next.scheduledKickoffMs).toBe(priorKickoff + 3 * 60 * 60 * 1000);
    expect(next.kickoffLockReachedAtMs).toBeNull();
    expect(
      isGameKickoffLocked(
        {
          scheduledKickoffMs: next.scheduledKickoffMs,
          lifecycle: "scheduled",
          kickoffLockReachedAtMs: next.kickoffLockReachedAtMs,
        },
        priorKickoff + 60_000,
      ),
    ).toBe(false);
  });

  it("latches a reached lock so postponement/reschedule never reopens it", () => {
    const next = applyKickoffScheduleChange({
      priorScheduledKickoffMs: priorKickoff,
      newScheduledKickoffMs: priorKickoff + 8 * 60 * 60 * 1000,
      nowMs: priorKickoff + 30_000,
      priorLifecycle: "scheduled",
      kickoffLockReachedAtMs: null,
    });
    expect(next.scheduledKickoffMs).toBe(priorKickoff + 8 * 60 * 60 * 1000);
    expect(next.kickoffLockReachedAtMs).not.toBeNull();
    expect(
      isGameKickoffLocked(
        {
          scheduledKickoffMs: next.scheduledKickoffMs,
          lifecycle: "postponed",
          kickoffLockReachedAtMs: next.kickoffLockReachedAtMs,
        },
        priorKickoff + 60_000,
      ),
    ).toBe(true);
  });

  it("preserves an existing kickoffLockReachedAtMs latch", () => {
    const next = applyKickoffScheduleChange({
      priorScheduledKickoffMs: priorKickoff + 8 * 60 * 60 * 1000,
      newScheduledKickoffMs: priorKickoff + 12 * 60 * 60 * 1000,
      nowMs: priorKickoff + 60_000,
      priorLifecycle: "postponed",
      kickoffLockReachedAtMs: priorKickoff,
    });
    expect(next.kickoffLockReachedAtMs).toBe(priorKickoff);
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

describe("computeWeeklyCutoffMs (acceptance scenario 21)", () => {
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

  it("is past cutoff after Sunday 1pm ET and not before", () => {
    const thursdayKickoff = Date.parse("2025-09-04T20:15:00.000Z");
    const cutoff = computeWeeklyCutoffMs(thursdayKickoff);
    expect(cutoff - 1 < cutoff).toBe(true);
    // Fixed instant: 2025-09-07 17:00 UTC = Sunday 1:00 p.m. EDT
    expect(Date.parse("2025-09-07T17:00:00.000Z")).toBe(cutoff);
    expect(Date.parse("2025-09-07T16:59:59.000Z") < cutoff).toBe(true);
  });
});

describe("isTiebreakerLocked (acceptance scenario 21)", () => {
  const laterGame = {
    scheduledKickoffMs: 10_000_000,
    lifecycle: "scheduled",
  };

  it("under gameKickoff locks with the designated last game", () => {
    expect(
      isTiebreakerLocked({
        pickLockMode: "gameKickoff",
        tiebreakerGame: laterGame,
        weeklyCutoffMs: 1_000,
        nowMs: laterGame.scheduledKickoffMs,
      }),
    ).toBe(true);
    expect(
      isTiebreakerLocked({
        pickLockMode: "gameKickoff",
        tiebreakerGame: laterGame,
        weeklyCutoffMs: 1_000,
        nowMs: laterGame.scheduledKickoffMs - 1,
      }),
    ).toBe(false);
  });

  it("under weeklyCutoff freezes remaining including tiebreaker at Sunday cutoff", () => {
    expect(
      isTiebreakerLocked({
        pickLockMode: "weeklyCutoff",
        tiebreakerGame: laterGame,
        weeklyCutoffMs: 3_000,
        nowMs: 3_000,
      }),
    ).toBe(true);
    expect(
      isTiebreakerLocked({
        pickLockMode: "weeklyCutoff",
        tiebreakerGame: laterGame,
        weeklyCutoffMs: 3_000,
        nowMs: 2_999,
      }),
    ).toBe(false);
  });
});
