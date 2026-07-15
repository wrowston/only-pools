/**
 * Terminal result confirmation policy (TheSportsDB FT/AOT/CANC).
 *
 * First matching terminal observation → provisional / confirmation_pending.
 * Verification requires a later matching observation that is:
 *   - at least 15 minutes after the first terminal observation, AND
 *   - at least 60 minutes after the first terminal observation
 * (i.e. the confirming observation must fall at/after the 60-minute mark,
 *  which also satisfies the 15-minute spacing rule).
 *
 * Contradiction restarts the confirmation clock. Convex server receipt time
 * is the trusted clock — provider timestamps are never used here.
 */

export const CONFIRMATION_MIN_SPACING_MS = 15 * 60 * 1000;
export const CONFIRMATION_MIN_ELAPSED_MS = 60 * 60 * 1000;

export type TerminalStatus = "FT" | "AOT" | "CANC";

export type ConfirmationObservation = {
  observedAtMs: number;
  homeScore: number;
  awayScore: number;
  status: TerminalStatus;
};

export type ResultAuthority =
  | "none"
  | "projected"
  | "confirmation_pending"
  | "verified"
  | "correction_candidate";

export type ConfirmationState = {
  resultAuthority: ResultAuthority;
  provisionalTerminalAtMs: number | null;
  observations: ConfirmationObservation[];
  verifiedResult: {
    homeScore: number;
    awayScore: number;
    verifiedAtMs: number;
    status: TerminalStatus;
  } | null;
  /** True when a confirming lookup failed/missing — Pending + retry path. */
  pendingRetry: boolean;
};

export type ConfirmationInput = {
  prior: ConfirmationState;
  observation: ConfirmationObservation;
  /** When true, treat as a failed/missing confirmation lookup (no evidence). */
  lookupFailed?: boolean;
};

export type ConfirmationOutcome = ConfirmationState & {
  restarted: boolean;
  justVerified: boolean;
};

const EMPTY: ConfirmationState = {
  resultAuthority: "none",
  provisionalTerminalAtMs: null,
  observations: [],
  verifiedResult: null,
  pendingRetry: false,
};

export function emptyConfirmationState(): ConfirmationState {
  return { ...EMPTY, observations: [] };
}

function scoresMatch(
  a: { homeScore: number; awayScore: number },
  b: { homeScore: number; awayScore: number },
): boolean {
  return a.homeScore === b.homeScore && a.awayScore === b.awayScore;
}

function observationsMatch(
  a: ConfirmationObservation,
  b: ConfirmationObservation,
): boolean {
  return a.status === b.status && scoresMatch(a, b);
}

/**
 * Apply one terminal observation (or a failed confirmation lookup) to prior state.
 */
export function applyConfirmationObservation(
  input: ConfirmationInput,
): ConfirmationOutcome {
  const { prior, observation, lookupFailed } = input;

  if (lookupFailed) {
    return {
      ...prior,
      pendingRetry: true,
      restarted: false,
      justVerified: false,
    };
  }

  // Already verified with matching evidence — idempotent freshness only.
  if (
    prior.resultAuthority === "verified" &&
    prior.verifiedResult !== null &&
    prior.verifiedResult.status === observation.status &&
    scoresMatch(prior.verifiedResult, observation)
  ) {
    return {
      ...prior,
      pendingRetry: false,
      restarted: false,
      justVerified: false,
    };
  }

  // Verified with contradictory evidence → correction candidate (ticket 07 leaves
  // full correction confirmation to later work; mark the candidate).
  if (
    prior.resultAuthority === "verified" &&
    prior.verifiedResult !== null &&
    (prior.verifiedResult.status !== observation.status ||
      !scoresMatch(prior.verifiedResult, observation))
  ) {
    return {
      resultAuthority: "correction_candidate",
      provisionalTerminalAtMs: observation.observedAtMs,
      observations: [observation],
      verifiedResult: prior.verifiedResult,
      pendingRetry: false,
      restarted: true,
      justVerified: false,
    };
  }

  const first = prior.observations[0] ?? null;

  // No prior provisional — first FT/AOT/CANC becomes provisional.
  if (first === null || prior.provisionalTerminalAtMs === null) {
    return {
      resultAuthority: "confirmation_pending",
      provisionalTerminalAtMs: observation.observedAtMs,
      observations: [observation],
      verifiedResult: null,
      pendingRetry: false,
      restarted: false,
      justVerified: false,
    };
  }

  // Contradiction vs provisional candidate → restart clock.
  if (!observationsMatch(first, observation)) {
    return {
      resultAuthority: "confirmation_pending",
      provisionalTerminalAtMs: observation.observedAtMs,
      observations: [observation],
      verifiedResult: null,
      pendingRetry: false,
      restarted: true,
      justVerified: false,
    };
  }

  const elapsedFromFirst =
    observation.observedAtMs - prior.provisionalTerminalAtMs;
  const spacingOk = elapsedFromFirst >= CONFIRMATION_MIN_SPACING_MS;
  const windowOk = elapsedFromFirst >= CONFIRMATION_MIN_ELAPSED_MS;

  if (spacingOk && windowOk) {
    return {
      resultAuthority: "verified",
      provisionalTerminalAtMs: prior.provisionalTerminalAtMs,
      observations: [...prior.observations, observation],
      verifiedResult: {
        homeScore: observation.homeScore,
        awayScore: observation.awayScore,
        verifiedAtMs: observation.observedAtMs,
        status: observation.status,
      },
      pendingRetry: false,
      restarted: false,
      justVerified: true,
    };
  }

  // Matching but too early (e.g. 15-minute lookup) — stay pending.
  return {
    resultAuthority: "confirmation_pending",
    provisionalTerminalAtMs: prior.provisionalTerminalAtMs,
    observations: [...prior.observations, observation],
    verifiedResult: null,
    pendingRetry: false,
    restarted: false,
    justVerified: false,
  };
}

/**
 * Whether a provisional terminal may drive official elimination / points /
 * Pool completion. Always false — only Verified Results are official.
 */
export function isOfficialResult(authority: ResultAuthority): boolean {
  return authority === "verified";
}
