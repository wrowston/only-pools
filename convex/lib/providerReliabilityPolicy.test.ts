import { describe, expect, it } from "vitest";

import {
  admitProviderRequest,
  API_SPORTS_RELIABILITY_LIMITS,
  emptyProviderReliabilityState,
  deterministicRetryJitterUnit,
  reconcileProviderQuota,
  recordProviderFailure,
  recordProviderSuccess,
  retryDelayMs,
} from "./providerReliabilityPolicy";

const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;
const NOW_MS = Date.UTC(2026, 8, 14, 20, 15);

describe("API-Sports reliability policy", () => {
  it("resets the 7,500-request daily plan at the configured UTC boundary", () => {
    const beforeReset = Date.UTC(2026, 8, 15, 5, 59, 59);
    const state = {
      ...emptyProviderReliabilityState(beforeReset, 6),
      dailyUsed: 7_500,
      routineDailyUsed: 6_000,
    };
    expect(
      admitProviderRequest({
        state,
        traffic: "protected",
        nowMs: beforeReset,
        dailyResetUtcHour: 6,
      }),
    ).toMatchObject({
      ok: false,
      reason: "daily_exhausted",
      retryAtMs: Date.UTC(2026, 8, 15, 6),
    });
    const afterReset = admitProviderRequest({
      state,
      traffic: "protected",
      nowMs: Date.UTC(2026, 8, 15, 6),
      dailyResetUtcHour: 6,
    });
    expect(afterReset).toMatchObject({
      ok: true,
      state: {
        dailyWindowStartedAtMs: Date.UTC(2026, 8, 15, 6),
        dailyResetAtMs: Date.UTC(2026, 8, 16, 6),
        dailyUsed: 1,
      },
    });
  });

  it("protects 20 percent of the daily plan from routine schedule work", () => {
    const state = {
      ...emptyProviderReliabilityState(NOW_MS, 0),
      dailyUsed: 6_000,
      routineDailyUsed: 6_000,
    };
    expect(
      admitProviderRequest({
        state,
        traffic: "routine",
        nowMs: NOW_MS,
        dailyResetUtcHour: 0,
      }),
    ).toMatchObject({
      ok: false,
      reason: "protected_reserve",
    });
    expect(
      admitProviderRequest({
        state,
        traffic: "protected",
        nowMs: NOW_MS,
        dailyResetUtcHour: 0,
      }),
    ).toMatchObject({
      ok: true,
      state: {
        dailyUsed: 6_001,
        protectedDailyUsed: 1,
      },
    });
    expect(API_SPORTS_RELIABILITY_LIMITS.protectedDaily).toBe(1_500);
  });

  it("enforces an independent conservative minute ceiling", () => {
    const state = {
      ...emptyProviderReliabilityState(NOW_MS, 0),
      minuteAdmissionTimestampsMs: Array.from(
        { length: 50 },
        () => NOW_MS - 30_000,
      ),
    };
    expect(
      admitProviderRequest({
        state,
        traffic: "protected",
        nowMs: NOW_MS,
        dailyResetUtcHour: 0,
      }),
    ).toMatchObject({
      ok: false,
      reason: "minute_exhausted",
      retryAtMs: NOW_MS + 30_000,
    });
    expect(
      admitProviderRequest({
        state,
        traffic: "protected",
        nowMs: NOW_MS + 29_999,
        dailyResetUtcHour: 0,
      }),
    ).toMatchObject({ ok: false, reason: "minute_exhausted" });
    expect(
      admitProviderRequest({
        state,
        traffic: "protected",
        nowMs: NOW_MS + 30_000,
        dailyResetUtcHour: 0,
      }),
    ).toMatchObject({ ok: true });
  });

  it("raises high-water accounting from consistent headers but ignores rollback and inconsistent values", () => {
    const initial = {
      ...emptyProviderReliabilityState(NOW_MS, 0),
      dailyUsed: 100,
      providerMinuteUsed: 8,
    };
    const receipt = {
      dailyWindowStartedAtMs: initial.dailyWindowStartedAtMs,
      providerMinuteWindowStartedAtMs:
        initial.providerMinuteWindowStartedAtMs,
      circuitGeneration: 0,
      probeToken: null,
    };
    const raised = reconcileProviderQuota({
      state: initial,
      receipt,
      nowMs: NOW_MS,
      dailyResetUtcHour: 0,
      quota: {
        dailyLimit: 7_500,
        dailyRemaining: 7_350,
        minuteLimit: 60,
        minuteRemaining: 40,
      },
    });
    expect(raised).toMatchObject({
      dailyUsed: 150,
      providerMinuteUsed: 20,
      headerInconsistencyCount: 0,
    });

    const rollbackIgnored = reconcileProviderQuota({
      state: raised,
      receipt,
      nowMs: NOW_MS,
      dailyResetUtcHour: 0,
      quota: {
        dailyLimit: 7_500,
        dailyRemaining: 7_490,
        minuteLimit: 60,
        minuteRemaining: 59,
      },
    });
    expect(rollbackIgnored).toMatchObject({
      dailyUsed: 150,
      providerMinuteUsed: 20,
    });

    const inconsistentIgnored = reconcileProviderQuota({
      state: rollbackIgnored,
      receipt,
      nowMs: NOW_MS,
      dailyResetUtcHour: 0,
      quota: {
        dailyLimit: 7_500,
        dailyRemaining: 8_000,
        minuteLimit: 60,
        minuteRemaining: 61,
      },
    });
    expect(inconsistentIgnored).toMatchObject({
      dailyUsed: 150,
      providerMinuteUsed: 20,
      headerInconsistencyCount: 2,
    });

    expect(
      admitProviderRequest({
        state: { ...raised, dailyUsed: 6_000, routineDailyUsed: 0 },
        traffic: "routine",
        nowMs: NOW_MS,
        dailyResetUtcHour: 0,
      }),
    ).toMatchObject({ ok: false, reason: "protected_reserve" });
  });

  it("does not apply a response header to a later admission window", () => {
    const initial = emptyProviderReliabilityState(
      Date.UTC(2026, 8, 15, 5, 59, 59, 999),
      6,
    );
    const admitted = admitProviderRequest({
      state: initial,
      traffic: "protected",
      nowMs: Date.UTC(2026, 8, 15, 5, 59, 59, 999),
      dailyResetUtcHour: 6,
    });
    if (!admitted.ok) throw new Error("request should be admitted");
    const reconciled = reconcileProviderQuota({
      state: admitted.state,
      receipt: admitted.receipt,
      nowMs: Date.UTC(2026, 8, 15, 6),
      dailyResetUtcHour: 6,
      quota: {
        dailyLimit: 7_500,
        dailyRemaining: 7_000,
        minuteLimit: 60,
        minuteRemaining: 20,
      },
    });
    expect(reconciled).toMatchObject({
      dailyUsed: 0,
      providerMinuteUsed: 0,
      staleHeaderCount: 2,
    });
  });

  it("tightens capacity when the provider reports a credible lower daily limit", () => {
    const initial = emptyProviderReliabilityState(NOW_MS, 0);
    const receipt = {
      dailyWindowStartedAtMs: initial.dailyWindowStartedAtMs,
      providerMinuteWindowStartedAtMs:
        initial.providerMinuteWindowStartedAtMs,
      circuitGeneration: 0,
      probeToken: null,
    };
    const lowered = reconcileProviderQuota({
      state: initial,
      receipt,
      nowMs: NOW_MS,
      dailyResetUtcHour: 0,
      quota: {
        dailyLimit: 7_000,
        dailyRemaining: 1_000,
        minuteLimit: null,
        minuteRemaining: null,
      },
    });
    expect(lowered).toMatchObject({
      dailyUsed: 6_000,
      providerDailyLimit: 7_000,
      providerDailyRemaining: 1_000,
    });
    expect(
      admitProviderRequest({
        state: lowered,
        traffic: "routine",
        nowMs: NOW_MS,
        dailyResetUtcHour: 0,
      }),
    ).toMatchObject({ ok: false, reason: "protected_reserve" });
    expect(
      admitProviderRequest({
        state: lowered,
        traffic: "protected",
        nowMs: NOW_MS,
        dailyResetUtcHour: 0,
      }),
    ).toMatchObject({ ok: true });

    const rollbackIgnored = reconcileProviderQuota({
      state: lowered,
      receipt,
      nowMs: NOW_MS,
      dailyResetUtcHour: 0,
      quota: {
        dailyLimit: 7_500,
        dailyRemaining: 7_490,
        minuteLimit: null,
        minuteRemaining: null,
      },
    });
    expect(rollbackIgnored).toMatchObject({
      dailyUsed: 6_000,
      providerDailyLimit: 7_000,
      providerDailyRemaining: 1_000,
    });
  });

  it("tightens the independent minute ceiling from provider headers", () => {
    const initial = emptyProviderReliabilityState(NOW_MS, 0);
    const receipt = {
      dailyWindowStartedAtMs: initial.dailyWindowStartedAtMs,
      providerMinuteWindowStartedAtMs:
        initial.providerMinuteWindowStartedAtMs,
      circuitGeneration: 0,
      probeToken: null,
    };
    const state = reconcileProviderQuota({
      state: initial,
      receipt,
      nowMs: NOW_MS,
      dailyResetUtcHour: 0,
      quota: {
        dailyLimit: null,
        dailyRemaining: null,
        minuteLimit: 10,
        minuteRemaining: 1,
      },
    });
    const lastAllowed = admitProviderRequest({
      state,
      traffic: "protected",
      nowMs: NOW_MS,
      dailyResetUtcHour: 0,
    });
    expect(lastAllowed).toMatchObject({ ok: true });
    if (!lastAllowed.ok) throw new Error("last request should be allowed");
    expect(
      admitProviderRequest({
        state: lastAllowed.state,
        traffic: "protected",
        nowMs: NOW_MS,
        dailyResetUtcHour: 0,
      }),
    ).toMatchObject({ ok: false, reason: "minute_exhausted" });
  });

  it("uses bounded exponential retry with injected deterministic jitter", () => {
    expect(retryDelayMs({ attempt: 1, randomUnit: 0 })).toBe(800);
    expect(retryDelayMs({ attempt: 1, randomUnit: 1 })).toBe(1_200);
    expect(retryDelayMs({ attempt: 4, randomUnit: 0.5 })).toBe(8_000);
    expect(retryDelayMs({ attempt: 99, randomUnit: 1 })).toBe(60_000);
    expect(deterministicRetryJitterUnit("work:2")).toBe(
      deterministicRetryJitterUnit("work:2"),
    );
    expect(deterministicRetryJitterUnit("work:2")).not.toBe(
      deterministicRetryJitterUnit("work:3"),
    );
  });

  it("opens after repeated failures, blocks storms, and closes only after a successful recovery probe", () => {
    let state = emptyProviderReliabilityState(NOW_MS, 0);
    for (let attempt = 0; attempt < 5; attempt++) {
      state = recordProviderFailure(state, NOW_MS + attempt);
    }
    expect(state).toMatchObject({
      circuitStatus: "open",
      consecutiveFailures: 5,
      circuitOpenUntilMs: NOW_MS + 4 + 5 * 60_000,
    });
    expect(
      admitProviderRequest({
        state,
        traffic: "protected",
        nowMs: NOW_MS + 10_000,
        dailyResetUtcHour: 0,
      }),
    ).toMatchObject({
      ok: false,
      reason: "circuit_open",
    });
    expect(
      admitProviderRequest({
        state,
        traffic: "protected",
        nowMs: state.circuitOpenUntilMs!,
        dailyResetUtcHour: 0,
      }),
    ).toMatchObject({
      ok: false,
      reason: "recovery_probe_required",
    });
    const probe = admitProviderRequest({
      state,
      traffic: "recovery_probe",
      nowMs: state.circuitOpenUntilMs!,
      dailyResetUtcHour: 0,
    });
    expect(probe).toMatchObject({
      ok: true,
      state: { circuitStatus: "half_open" },
    });
    if (!probe.ok) throw new Error("probe should be admitted");
    const expiredAtMs = probe.state.probeExpiresAtMs!;
    expect(
      recordProviderSuccess(
        probe.state,
        expiredAtMs,
        probe.receipt,
      ),
    ).toEqual(probe.state);
    expect(
      recordProviderFailure(
        probe.state,
        expiredAtMs,
        probe.receipt,
      ),
    ).toEqual(probe.state);
    const replacementProbe = admitProviderRequest({
      state: probe.state,
      traffic: "recovery_probe",
      nowMs:
        state.circuitOpenUntilMs! +
        API_SPORTS_RELIABILITY_LIMITS.recoveryProbeLeaseMs,
      dailyResetUtcHour: 0,
    });
    expect(replacementProbe).toMatchObject({
      ok: true,
      state: {
        circuitStatus: "half_open",
        circuitGeneration: probe.state.circuitGeneration + 1,
      },
    });
    if (!replacementProbe.ok) {
      throw new Error("expired probe should be replaced");
    }
    expect(
      recordProviderSuccess(
        replacementProbe.state,
        replacementProbe.state.probeExpiresAtMs! - 1,
        probe.receipt,
      ),
    ).toEqual(replacementProbe.state);
    expect(
      recordProviderSuccess(
        probe.state,
        state.circuitOpenUntilMs! + 1,
        probe.receipt,
      ),
    ).toMatchObject({
      circuitStatus: "closed",
      consecutiveFailures: 0,
      probeToken: null,
      recoveredAtMs: state.circuitOpenUntilMs! + 1,
    });

    const reopened = recordProviderFailure(
      probe.state,
      state.circuitOpenUntilMs! + 1,
      probe.receipt,
    );
    expect(reopened.circuitGeneration).toBe(
      probe.state.circuitGeneration + 1,
    );
    expect(
      recordProviderSuccess(
        reopened,
        state.circuitOpenUntilMs! + 2,
        probe.receipt,
      ),
    ).toEqual(reopened);
  });

  it("does not accidentally retain a previous daily window after multiple days", () => {
    const state = {
      ...emptyProviderReliabilityState(NOW_MS, 0),
      dailyUsed: 7_500,
      routineDailyUsed: 6_000,
    };
    const decision = admitProviderRequest({
      state,
      traffic: "routine",
      nowMs: NOW_MS + 2 * DAY_MS,
      dailyResetUtcHour: 0,
    });
    expect(decision).toMatchObject({
      ok: true,
      state: { dailyUsed: 1, routineDailyUsed: 1 },
    });
  });
});
