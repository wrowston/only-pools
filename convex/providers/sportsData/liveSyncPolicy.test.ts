import { describe, expect, it } from "vitest";

import {
  LIVE_LEAD_MS,
  LIVE_REFRESH_CADENCE_MS,
  SCHEDULED_LIVE_GRACE_MS,
  advanceSuccessfulSlateMiss,
  classifyLiveObservation,
  isExpectedInSuccessfulLiveSlate,
  isLivePollingActive,
  liveObservationFingerprint,
} from "./liveSyncPolicy";

const KICKOFF_MS = Date.UTC(2026, 8, 13, 17);

describe("API-Sports live sync policy", () => {
  it("uses a 60 second cadence only during the grounded live window", () => {
    expect(LIVE_REFRESH_CADENCE_MS).toBe(60_000);
    expect(LIVE_LEAD_MS).toBe(15 * 60_000);
    expect(SCHEDULED_LIVE_GRACE_MS).toBe(4 * 60 * 60_000);

    expect(
      isLivePollingActive(
        { lifecycle: "scheduled", scheduledKickoffMs: KICKOFF_MS },
        KICKOFF_MS - LIVE_LEAD_MS,
      ),
    ).toBe(true);
    expect(
      isLivePollingActive(
        { lifecycle: "scheduled", scheduledKickoffMs: KICKOFF_MS },
        KICKOFF_MS - LIVE_LEAD_MS - 1,
      ),
    ).toBe(false);
    expect(
      isLivePollingActive(
        { lifecycle: "scheduled", scheduledKickoffMs: KICKOFF_MS },
        KICKOFF_MS + SCHEDULED_LIVE_GRACE_MS,
      ),
    ).toBe(true);
    expect(
      isLivePollingActive(
        { lifecycle: "scheduled", scheduledKickoffMs: KICKOFF_MS },
        KICKOFF_MS + SCHEDULED_LIVE_GRACE_MS + 1,
      ),
    ).toBe(false);
    expect(
      isLivePollingActive(
        { lifecycle: "in_progress", scheduledKickoffMs: KICKOFF_MS },
        KICKOFF_MS + SCHEDULED_LIVE_GRACE_MS + 1,
      ),
    ).toBe(true);
    expect(
      isLivePollingActive(
        { lifecycle: "terminal", scheduledKickoffMs: KICKOFF_MS },
        KICKOFF_MS,
      ),
    ).toBe(false);
  });

  it("does not count a scheduled pre-kickoff game as missing from a successful slate", () => {
    const game = {
      lifecycle: "scheduled" as const,
      scheduledKickoffMs: KICKOFF_MS,
    };
    expect(
      isExpectedInSuccessfulLiveSlate(game, KICKOFF_MS - 1),
    ).toBe(false);
    expect(isExpectedInSuccessfulLiveSlate(game, KICKOFF_MS)).toBe(
      true,
    );
    expect(
      isExpectedInSuccessfulLiveSlate(
        game,
        KICKOFF_MS + SCHEDULED_LIVE_GRACE_MS + 1,
      ),
    ).toBe(false);
    expect(
      isExpectedInSuccessfulLiveSlate(
        { ...game, lifecycle: "interrupted" },
        KICKOFF_MS + SCHEDULED_LIVE_GRACE_MS + 1,
      ),
    ).toBe(true);
  });

  it("enqueues targeted recovery on the second consecutive successful-slate miss only", () => {
    expect(
      advanceSuccessfulSlateMiss({
        previousMisses: 0,
        expected: true,
        present: false,
      }),
    ).toEqual({ misses: 1, enqueueTargetedRecovery: false });
    expect(
      advanceSuccessfulSlateMiss({
        previousMisses: 1,
        expected: true,
        present: false,
      }),
    ).toEqual({ misses: 2, enqueueTargetedRecovery: true });
    expect(
      advanceSuccessfulSlateMiss({
        previousMisses: 2,
        expected: true,
        present: false,
      }),
    ).toEqual({ misses: 3, enqueueTargetedRecovery: false });
    expect(
      advanceSuccessfulSlateMiss({
        previousMisses: 2,
        expected: true,
        present: true,
      }),
    ).toEqual({ misses: 0, enqueueTargetedRecovery: false });
    expect(
      advanceSuccessfulSlateMiss({
        previousMisses: 1,
        expected: true,
        present: false,
        slateSucceeded: false,
      }),
    ).toEqual({ misses: 1, enqueueTargetedRecovery: false });
  });

  it("excludes observedAt from fingerprints and rejects stale or duplicate regressions", () => {
    const observation = {
      provider: "api-sports",
      externalId: "9001",
      lifecycle: "in_progress" as const,
      homeScore: 13,
      awayScore: 10,
      providerStatus: {
        rawShort: "Q3",
        rawLong: "Third Quarter",
        recognized: true,
        terminal: false,
      },
    };
    const fingerprint = liveObservationFingerprint(observation);
    expect(
      liveObservationFingerprint({
        ...observation,
        observedAtMs: KICKOFF_MS + 10_000,
      }),
    ).toBe(fingerprint);
    expect(
      classifyLiveObservation({
        observation: { ...observation, observedAtMs: KICKOFF_MS },
        lastAppliedObservedAtMs: KICKOFF_MS + 1,
        lastFingerprint: undefined,
        hasVerifiedResult: false,
      }),
    ).toBe("stale");
    expect(
      classifyLiveObservation({
        observation: { ...observation, observedAtMs: KICKOFF_MS + 1 },
        lastAppliedObservedAtMs: KICKOFF_MS,
        lastFingerprint: fingerprint,
        hasVerifiedResult: false,
      }),
    ).toBe("duplicate");
  });

  it("keeps unknown lifecycle as evidence-only and never regresses a Verified Result", () => {
    const base = {
      provider: "api-sports",
      externalId: "9001",
      observedAtMs: KICKOFF_MS,
      homeScore: null,
      awayScore: null,
      providerStatus: {
        rawShort: "NEW",
        rawLong: "New contract value",
        recognized: false,
        terminal: false,
      },
    };
    expect(
      classifyLiveObservation({
        observation: { ...base, lifecycle: "unknown" },
        hasVerifiedResult: false,
      }),
    ).toBe("evidence_only");
    expect(
      classifyLiveObservation({
        observation: {
          ...base,
          lifecycle: "in_progress",
          providerStatus: {
            ...base.providerStatus,
            rawShort: "Q4",
            recognized: true,
          },
        },
        hasVerifiedResult: true,
      }),
    ).toBe("trusted_state");
    expect(
      classifyLiveObservation({
        observation: {
          ...base,
          lifecycle: "terminal",
          providerStatus: {
            ...base.providerStatus,
            rawShort: "FT",
            recognized: true,
            terminal: true,
          },
        },
        hasVerifiedResult: false,
      }),
    ).toBe("apply_verified");
  });
});
