import { describe, expect, it } from "vitest";

import {
  scheduleRefreshCadence,
  reduceScheduleObservation,
} from "./scheduleSync";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

describe("scheduleRefreshCadence", () => {
  const nowMs = Date.parse("2026-09-07T12:00:00Z");

  it("refreshes daily outside the applicable game week", () => {
    expect(
      scheduleRefreshCadence({
        nowMs,
        scheduledKickoffMs: [nowMs + 8 * DAY_MS],
      }),
    ).toEqual({ cadenceMs: DAY_MS, reason: "daily" });
  });

  it("refreshes hourly during the applicable game week", () => {
    expect(
      scheduleRefreshCadence({
        nowMs,
        scheduledKickoffMs: [nowMs + 3 * DAY_MS],
      }),
    ).toEqual({ cadenceMs: HOUR_MS, reason: "applicable_week" });
  });

  it("includes the exact seven-day applicable-week boundary", () => {
    expect(
      scheduleRefreshCadence({
        nowMs,
        scheduledKickoffMs: [nowMs + 7 * DAY_MS],
      }),
    ).toEqual({ cadenceMs: HOUR_MS, reason: "applicable_week" });
  });

  it("returns to daily cadence one millisecond outside seven days", () => {
    expect(
      scheduleRefreshCadence({
        nowMs,
        scheduledKickoffMs: [nowMs + 7 * DAY_MS + 1],
      }),
    ).toEqual({ cadenceMs: DAY_MS, reason: "daily" });
  });

  it("refreshes every five minutes within two hours of kickoff", () => {
    expect(
      scheduleRefreshCadence({
        nowMs,
        scheduledKickoffMs: [
          nowMs + 3 * DAY_MS,
          nowMs + 2 * HOUR_MS,
        ],
      }),
    ).toEqual({ cadenceMs: 5 * MINUTE_MS, reason: "near_kickoff" });
  });

  it("returns to hourly cadence one millisecond outside two hours", () => {
    expect(
      scheduleRefreshCadence({
        nowMs,
        scheduledKickoffMs: [nowMs + 2 * HOUR_MS + 1],
      }),
    ).toEqual({ cadenceMs: HOUR_MS, reason: "applicable_week" });
  });
});

describe("reduceScheduleObservation", () => {
  const futureKickoffMs = Date.parse("2026-09-13T17:00:00Z");
  const observedAtMs = futureKickoffMs - HOUR_MS;

  it("moves an unreached Pick Lock with a known kickoff change", () => {
    const movedKickoffMs = futureKickoffMs + 3 * HOUR_MS;
    expect(
      reduceScheduleObservation({
        prior: {
          scheduledKickoffMs: futureKickoffMs,
          lifecycle: "scheduled",
          kickoffLockReachedAtMs: null,
        },
        observation: {
          scheduledKickoffMs: movedKickoffMs,
          lifecycle: "postponed",
          lifecycleRecognized: true,
          observedAtMs,
        },
      }),
    ).toEqual({
      scheduledKickoffMs: movedKickoffMs,
      lifecycle: "postponed",
      kickoffLockReachedAtMs: null,
      unknownLifecyclePreserved: false,
    });
  });

  it("latches at observation time when an earlier kickoff is discovered in the past", () => {
    const discoveredKickoffMs = observedAtMs - MINUTE_MS;
    expect(
      reduceScheduleObservation({
        prior: {
          scheduledKickoffMs: futureKickoffMs,
          lifecycle: "scheduled",
          kickoffLockReachedAtMs: null,
        },
        observation: {
          scheduledKickoffMs: discoveredKickoffMs,
          lifecycle: "scheduled",
          lifecycleRecognized: true,
          observedAtMs,
        },
      }),
    ).toEqual({
      scheduledKickoffMs: discoveredKickoffMs,
      lifecycle: "scheduled",
      kickoffLockReachedAtMs: observedAtMs,
      unknownLifecyclePreserved: false,
    });
  });

  it("preserves a reached lock and the last trusted lifecycle", () => {
    expect(
      reduceScheduleObservation({
        prior: {
          scheduledKickoffMs: futureKickoffMs,
          lifecycle: "scheduled",
          kickoffLockReachedAtMs: futureKickoffMs - DAY_MS,
        },
        observation: {
          scheduledKickoffMs: futureKickoffMs + DAY_MS,
          lifecycle: "unknown",
          lifecycleRecognized: false,
          observedAtMs,
        },
      }),
    ).toEqual({
      scheduledKickoffMs: futureKickoffMs + DAY_MS,
      lifecycle: "scheduled",
      kickoffLockReachedAtMs: futureKickoffMs - DAY_MS,
      unknownLifecyclePreserved: true,
    });
  });
});
