export const API_SPORTS_RELIABILITY_LIMITS = {
  daily: 7_500,
  protectedDaily: 1_500,
  routineDaily: 6_000,
  minute: 50,
  minuteWindowMs: 60_000,
  failureThreshold: 5,
  circuitOpenMs: 5 * 60_000,
  recoveryProbeLeaseMs: 2 * 60_000,
  retryBaseMs: 1_000,
  retryMaxMs: 60_000,
  retryJitterRatio: 0.2,
} as const;

export const API_SPORTS_RECOVERY_SCOPE_KEY =
  "provider-recovery:api-sports";

export type ProviderTraffic =
  | "routine"
  | "protected"
  | "recovery_probe";

export type ProviderAdmissionReceipt = Readonly<{
  dailyWindowStartedAtMs: number;
  providerMinuteWindowStartedAtMs: number;
  circuitGeneration: number;
  probeToken: string | null;
}>;

export type ProviderReliabilityState = Readonly<{
  dailyWindowStartedAtMs: number;
  dailyResetAtMs: number;
  dailyUsed: number;
  routineDailyUsed: number;
  protectedDailyUsed: number;
  providerDailyLimit: number | null;
  providerDailyRemaining: number | null;
  minuteAdmissionTimestampsMs: readonly number[];
  providerMinuteWindowStartedAtMs: number;
  providerMinuteResetAtMs: number;
  providerMinuteUsed: number;
  providerMinuteLimit: number | null;
  providerMinuteRemaining: number | null;
  headerInconsistencyCount: number;
  staleHeaderCount: number;
  circuitStatus: "closed" | "open" | "half_open";
  circuitGeneration: number;
  consecutiveFailures: number;
  circuitOpenedAtMs: number | null;
  circuitOpenUntilMs: number | null;
  probeToken: string | null;
  probeExpiresAtMs: number | null;
  lastAttemptAtMs: number | null;
  lastSuccessAtMs: number | null;
  lastFailureAtMs: number | null;
  recoveredAtMs: number | null;
}>;

export type ProviderAdmissionDecision =
  | {
      ok: true;
      state: ProviderReliabilityState;
      receipt: ProviderAdmissionReceipt;
    }
  | {
      ok: false;
      reason:
        | "daily_exhausted"
        | "protected_reserve"
        | "minute_exhausted"
        | "circuit_open"
        | "recovery_probe_required"
        | "probe_in_flight";
      retryAtMs: number;
      state: ProviderReliabilityState;
    };

export type ProviderQuotaHeaders = Readonly<{
  dailyLimit: number | null;
  dailyRemaining: number | null;
  minuteLimit: number | null;
  minuteRemaining: number | null;
}>;

function assertResetHour(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 && value <= 23
    ? value
    : 0;
}

export function providerDailyWindow(
  nowMs: number,
  dailyResetUtcHour: number,
): Readonly<{ startedAtMs: number; resetsAtMs: number }> {
  const resetHour = assertResetHour(dailyResetUtcHour);
  const now = new Date(nowMs);
  let startedAtMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    resetHour,
  );
  if (nowMs < startedAtMs) startedAtMs -= 24 * 60 * 60_000;
  return {
    startedAtMs,
    resetsAtMs: startedAtMs + 24 * 60 * 60_000,
  };
}

function providerMinuteWindow(
  nowMs: number,
): Readonly<{ startedAtMs: number; resetsAtMs: number }> {
  const startedAtMs = Math.floor(nowMs / 60_000) * 60_000;
  return { startedAtMs, resetsAtMs: startedAtMs + 60_000 };
}

export function emptyProviderReliabilityState(
  nowMs: number,
  dailyResetUtcHour: number,
): ProviderReliabilityState {
  const daily = providerDailyWindow(nowMs, dailyResetUtcHour);
  const minute = providerMinuteWindow(nowMs);
  return {
    dailyWindowStartedAtMs: daily.startedAtMs,
    dailyResetAtMs: daily.resetsAtMs,
    dailyUsed: 0,
    routineDailyUsed: 0,
    protectedDailyUsed: 0,
    providerDailyLimit: null,
    providerDailyRemaining: null,
    minuteAdmissionTimestampsMs: [],
    providerMinuteWindowStartedAtMs: minute.startedAtMs,
    providerMinuteResetAtMs: minute.resetsAtMs,
    providerMinuteUsed: 0,
    providerMinuteLimit: null,
    providerMinuteRemaining: null,
    headerInconsistencyCount: 0,
    staleHeaderCount: 0,
    circuitStatus: "closed",
    circuitGeneration: 0,
    consecutiveFailures: 0,
    circuitOpenedAtMs: null,
    circuitOpenUntilMs: null,
    probeToken: null,
    probeExpiresAtMs: null,
    lastAttemptAtMs: null,
    lastSuccessAtMs: null,
    lastFailureAtMs: null,
    recoveredAtMs: null,
  };
}

export function normalizeProviderReliabilityState(
  state: ProviderReliabilityState,
  nowMs: number,
  dailyResetUtcHour: number,
): ProviderReliabilityState {
  const daily = providerDailyWindow(nowMs, dailyResetUtcHour);
  const providerMinute = providerMinuteWindow(nowMs);
  const rollingCutoffMs =
    nowMs - API_SPORTS_RELIABILITY_LIMITS.minuteWindowMs;
  const minuteAdmissionTimestampsMs =
    state.minuteAdmissionTimestampsMs
      .filter((timestamp) => timestamp > rollingCutoffMs)
      .slice(-API_SPORTS_RELIABILITY_LIMITS.minute);
  let normalized: ProviderReliabilityState = {
    ...state,
    minuteAdmissionTimestampsMs,
  };
  if (state.dailyWindowStartedAtMs !== daily.startedAtMs) {
    normalized = {
      ...normalized,
      dailyWindowStartedAtMs: daily.startedAtMs,
      dailyResetAtMs: daily.resetsAtMs,
      dailyUsed: 0,
      routineDailyUsed: 0,
      protectedDailyUsed: 0,
      providerDailyLimit: null,
      providerDailyRemaining: null,
    };
  }
  if (
    state.providerMinuteWindowStartedAtMs !==
    providerMinute.startedAtMs
  ) {
    normalized = {
      ...normalized,
      providerMinuteWindowStartedAtMs: providerMinute.startedAtMs,
      providerMinuteResetAtMs: providerMinute.resetsAtMs,
      providerMinuteUsed: 0,
      providerMinuteLimit: null,
      providerMinuteRemaining: null,
    };
  }
  return normalized;
}

function denied(
  state: ProviderReliabilityState,
  reason: Exclude<ProviderAdmissionDecision, { ok: true }>["reason"],
  retryAtMs: number,
): ProviderAdmissionDecision {
  return { ok: false, reason, retryAtMs, state };
}

export function effectiveProviderDailyLimit(
  state: ProviderReliabilityState,
): number {
  return Math.min(
    API_SPORTS_RELIABILITY_LIMITS.daily,
    state.providerDailyLimit ?? API_SPORTS_RELIABILITY_LIMITS.daily,
  );
}

export function effectiveRoutineDailyLimit(
  state: ProviderReliabilityState,
): number {
  return Math.min(
    API_SPORTS_RELIABILITY_LIMITS.routineDaily,
    Math.max(
      0,
      effectiveProviderDailyLimit(state) -
        API_SPORTS_RELIABILITY_LIMITS.protectedDaily,
    ),
  );
}

export function effectiveProviderMinuteLimit(
  state: ProviderReliabilityState,
): number {
  return Math.min(
    API_SPORTS_RELIABILITY_LIMITS.minute,
    state.providerMinuteLimit ?? API_SPORTS_RELIABILITY_LIMITS.minute,
  );
}

function admissionReceipt(
  state: ProviderReliabilityState,
): ProviderAdmissionReceipt {
  return {
    dailyWindowStartedAtMs: state.dailyWindowStartedAtMs,
    providerMinuteWindowStartedAtMs:
      state.providerMinuteWindowStartedAtMs,
    circuitGeneration: state.circuitGeneration,
    probeToken: state.probeToken,
  };
}

export function admitProviderRequest(input: {
  state: ProviderReliabilityState;
  traffic: ProviderTraffic;
  nowMs: number;
  dailyResetUtcHour: number;
}): ProviderAdmissionDecision {
  let state = normalizeProviderReliabilityState(
    input.state,
    input.nowMs,
    input.dailyResetUtcHour,
  );
  if (
    state.circuitStatus === "half_open" &&
    input.traffic === "recovery_probe" &&
    input.nowMs >= (state.probeExpiresAtMs ?? input.nowMs)
  ) {
    // Fence a probe action that crashed or outlived its lease. Its eventual
    // response carries the prior generation and cannot close this circuit.
    state = {
      ...state,
      circuitStatus: "open",
      circuitGeneration: state.circuitGeneration + 1,
      circuitOpenUntilMs: input.nowMs,
      probeToken: null,
      probeExpiresAtMs: null,
    };
  }
  if (state.circuitStatus === "open") {
    const openUntil = state.circuitOpenUntilMs ?? input.nowMs;
    if (input.nowMs < openUntil) {
      return denied(state, "circuit_open", openUntil);
    }
    if (input.traffic !== "recovery_probe") {
      return denied(state, "recovery_probe_required", input.nowMs);
    }
    if (state.probeToken !== null) {
      return denied(state, "probe_in_flight", input.nowMs + 60_000);
    }
    state = {
      ...state,
      circuitStatus: "half_open",
      probeToken: `api-sports:${state.circuitGeneration}:${input.nowMs}`,
      probeExpiresAtMs:
        input.nowMs +
        API_SPORTS_RELIABILITY_LIMITS.recoveryProbeLeaseMs,
    };
  } else if (state.circuitStatus === "half_open") {
    return denied(
      state,
      input.traffic === "recovery_probe"
        ? "probe_in_flight"
        : "recovery_probe_required",
      state.probeExpiresAtMs ?? input.nowMs + 60_000,
    );
  }

  if (
    state.dailyUsed >= effectiveProviderDailyLimit(state) ||
    state.providerDailyRemaining === 0
  ) {
    return denied(state, "daily_exhausted", state.dailyResetAtMs);
  }
  // The reserve is based on effective total usage. Provider header
  // reconciliation can raise that high-water beyond locally classified work.
  if (
    input.traffic === "routine" &&
    state.dailyUsed >= effectiveRoutineDailyLimit(state)
  ) {
    return denied(state, "protected_reserve", state.dailyResetAtMs);
  }
  if (
    state.minuteAdmissionTimestampsMs.length >=
      API_SPORTS_RELIABILITY_LIMITS.minute ||
    state.providerMinuteUsed >=
      effectiveProviderMinuteLimit(state) ||
    state.providerMinuteRemaining === 0
  ) {
    const oldestAdmission =
      state.minuteAdmissionTimestampsMs.at(0) ?? input.nowMs;
    return denied(
      state,
      "minute_exhausted",
      Math.max(
        oldestAdmission +
          API_SPORTS_RELIABILITY_LIMITS.minuteWindowMs,
        state.providerMinuteRemaining === 0 ||
          state.providerMinuteUsed >=
            effectiveProviderMinuteLimit(state)
          ? state.providerMinuteResetAtMs
          : input.nowMs,
      ),
    );
  }

  const nextState: ProviderReliabilityState = {
    ...state,
    dailyUsed: state.dailyUsed + 1,
    routineDailyUsed:
      state.routineDailyUsed + (input.traffic === "routine" ? 1 : 0),
    protectedDailyUsed:
      state.protectedDailyUsed + (input.traffic === "routine" ? 0 : 1),
    minuteAdmissionTimestampsMs: [
      ...state.minuteAdmissionTimestampsMs,
      input.nowMs,
    ],
    providerMinuteUsed: state.providerMinuteUsed + 1,
    lastAttemptAtMs: input.nowMs,
  };
  return {
    ok: true,
    state: nextState,
    receipt: admissionReceipt(nextState),
  };
}

function validHeaderWindow(
  limit: number | null,
  remaining: number | null,
): limit is number {
  return (
    limit !== null &&
    remaining !== null &&
    Number.isSafeInteger(limit) &&
    Number.isSafeInteger(remaining) &&
    limit > 0 &&
    remaining >= 0 &&
    remaining <= limit
  );
}

export function reconcileProviderQuota(input: {
  state: ProviderReliabilityState;
  receipt: ProviderAdmissionReceipt;
  quota: ProviderQuotaHeaders;
  nowMs: number;
  dailyResetUtcHour: number;
}): ProviderReliabilityState {
  let state = normalizeProviderReliabilityState(
    input.state,
    input.nowMs,
    input.dailyResetUtcHour,
  );
  let inconsistencies = 0;
  let staleHeaders = 0;

  if (
    input.receipt.dailyWindowStartedAtMs !==
    state.dailyWindowStartedAtMs
  ) {
    if (
      input.quota.dailyLimit !== null ||
      input.quota.dailyRemaining !== null
    ) {
      staleHeaders += 1;
    }
  } else if (
    validHeaderWindow(
      input.quota.dailyLimit,
      input.quota.dailyRemaining,
    ) &&
    input.quota.dailyLimit <= API_SPORTS_RELIABILITY_LIMITS.daily
  ) {
    const headerUsed =
      input.quota.dailyLimit - input.quota.dailyRemaining!;
    state = {
      ...state,
      dailyUsed: Math.max(state.dailyUsed, headerUsed),
      providerDailyLimit: Math.min(
        state.providerDailyLimit ?? input.quota.dailyLimit,
        input.quota.dailyLimit,
      ),
      providerDailyRemaining: Math.min(
        state.providerDailyRemaining ??
          input.quota.dailyRemaining!,
        input.quota.dailyRemaining!,
      ),
    };
  } else if (
    input.quota.dailyLimit !== null ||
    input.quota.dailyRemaining !== null
  ) {
    inconsistencies += 1;
  }

  if (
    input.receipt.providerMinuteWindowStartedAtMs !==
    state.providerMinuteWindowStartedAtMs
  ) {
    if (
      input.quota.minuteLimit !== null ||
      input.quota.minuteRemaining !== null
    ) {
      staleHeaders += 1;
    }
  } else if (
    validHeaderWindow(
      input.quota.minuteLimit,
      input.quota.minuteRemaining,
    )
  ) {
    const headerUsed =
      input.quota.minuteLimit - input.quota.minuteRemaining!;
    state = {
      ...state,
      providerMinuteUsed: Math.max(
        state.providerMinuteUsed,
        headerUsed,
      ),
      providerMinuteLimit: Math.min(
        state.providerMinuteLimit ?? input.quota.minuteLimit,
        input.quota.minuteLimit,
      ),
      providerMinuteRemaining: Math.min(
        state.providerMinuteRemaining ??
          input.quota.minuteRemaining!,
        input.quota.minuteRemaining!,
      ),
    };
  } else if (
    input.quota.minuteLimit !== null ||
    input.quota.minuteRemaining !== null
  ) {
    inconsistencies += 1;
  }

  return {
    ...state,
    headerInconsistencyCount:
      state.headerInconsistencyCount + inconsistencies,
    staleHeaderCount: state.staleHeaderCount + staleHeaders,
  };
}

export function retryDelayMs(input: {
  attempt: number;
  randomUnit: number;
}): number {
  const attempt = Math.max(1, Math.floor(input.attempt));
  const randomUnit = Math.min(1, Math.max(0, input.randomUnit));
  const exponential = Math.min(
    API_SPORTS_RELIABILITY_LIMITS.retryMaxMs,
    API_SPORTS_RELIABILITY_LIMITS.retryBaseMs *
      2 ** Math.min(30, attempt - 1),
  );
  const jitter =
    1 -
    API_SPORTS_RELIABILITY_LIMITS.retryJitterRatio +
    2 *
      API_SPORTS_RELIABILITY_LIMITS.retryJitterRatio *
      randomUnit;
  return Math.min(
    API_SPORTS_RELIABILITY_LIMITS.retryMaxMs,
    Math.round(exponential * jitter),
  );
}

export function deterministicRetryJitterUnit(key: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) / 0xffff_ffff;
}

export function recordProviderFailure(
  state: ProviderReliabilityState,
  nowMs: number,
  receipt?: ProviderAdmissionReceipt,
): ProviderReliabilityState {
  if (
    receipt !== undefined &&
    (receipt.circuitGeneration !== state.circuitGeneration ||
      (state.circuitStatus === "half_open" &&
        receipt.probeToken === state.probeToken &&
        nowMs >= (state.probeExpiresAtMs ?? nowMs)))
  ) {
    return state;
  }
  const consecutiveFailures = state.consecutiveFailures + 1;
  const shouldOpen =
    state.circuitStatus === "half_open" ||
    consecutiveFailures >=
      API_SPORTS_RELIABILITY_LIMITS.failureThreshold;
  return {
    ...state,
    consecutiveFailures,
    lastFailureAtMs: nowMs,
    ...(shouldOpen
      ? {
          circuitStatus: "open" as const,
          circuitGeneration: state.circuitGeneration + 1,
          circuitOpenedAtMs: nowMs,
          circuitOpenUntilMs:
            nowMs + API_SPORTS_RELIABILITY_LIMITS.circuitOpenMs,
          probeToken: null,
          probeExpiresAtMs: null,
        }
      : {}),
  };
}

export function recordProviderSuccess(
  state: ProviderReliabilityState,
  nowMs: number,
  receipt?: ProviderAdmissionReceipt,
): ProviderReliabilityState {
  const matchesCurrentGeneration =
    receipt === undefined ||
    receipt.circuitGeneration === state.circuitGeneration;
  const matchesProbe =
    state.circuitStatus !== "half_open" ||
    (receipt?.probeToken !== null &&
      receipt?.probeToken === state.probeToken);
  const probeExpired =
    state.circuitStatus === "half_open" &&
    receipt?.probeToken === state.probeToken &&
    nowMs >= (state.probeExpiresAtMs ?? nowMs);
  if (!matchesCurrentGeneration || !matchesProbe || probeExpired) {
    return state;
  }
  const recovered = state.circuitStatus === "half_open";
  // A normal request can clear failures only while the circuit remains closed.
  // Only the matching half-open probe can close an opened circuit.
  if (state.circuitStatus === "open") return state;
  return {
    ...state,
    circuitStatus: "closed",
    consecutiveFailures: 0,
    circuitOpenedAtMs: null,
    circuitOpenUntilMs: null,
    probeToken: null,
    probeExpiresAtMs: null,
    lastSuccessAtMs: nowMs,
    recoveredAtMs: recovered ? nowMs : state.recoveredAtMs,
  };
}
