/**
 * Operator Incident trigger catalog (acceptance scenarios 42–44).
 *
 * Late alone never opens an incident or participant banner.
 * Stale-in-window, Provider Exception, scoring delayed, quarantine past
 * provider failures, scoring delay, and Convex capacity do.
 */

import type { FreshnessState } from "./freshness";

export type IncidentType =
  | "provider_exception"
  | "stale_in_window"
  | "scoring_delayed"
  | "convex_capacity";

export type IncidentStatus =
  | "open"
  | "acknowledged"
  | "in_progress"
  | "resolved";

/** Ten minutes after a Verified Result without a new Scoring Revision. */
export const SCORING_DELAY_THRESHOLD_MS = 10 * 60 * 1000;

/** Convex capacity: 90% utilization or projected overage. */
export const CAPACITY_UTILIZATION_THRESHOLD = 0.9;

export type IncidentTriggerInput =
  | {
      kind: "freshness";
      freshnessState: FreshnessState;
      /** Live work during an active game window. */
      activeGameWindow: boolean;
    }
  | {
      kind: "scoring_delayed";
      verifiedResultAtMs: number;
      /** Latest Scoring Revision publish time for the affected Pool Week. */
      latestRevisionAtMs: number | null;
      nowMs: number;
    }
  | {
      kind: "convex_capacity";
      utilizationRatio: number;
      projectedOverage: boolean;
    }
  | { kind: "provider_exception" };

export type IncidentOpenDecision = {
  open: boolean;
  type: IncidentType | null;
  /** Participant-visible StatusBanner eligibility. */
  participantVisible: boolean;
};

/**
 * Decide whether a condition opens an Operator Incident.
 * Late alone returns open: false.
 */
export function shouldOpenIncident(
  input: IncidentTriggerInput,
): IncidentOpenDecision {
  switch (input.kind) {
    case "provider_exception":
      return {
        open: true,
        type: "provider_exception",
        participantVisible: true,
      };

    case "freshness": {
      if (input.freshnessState === "provider_exception") {
        return {
          open: true,
          type: "provider_exception",
          participantVisible: true,
        };
      }
      if (
        input.freshnessState === "stale" &&
        input.activeGameWindow
      ) {
        return {
          open: true,
          type: "stale_in_window",
          participantVisible: true,
        };
      }
      // Late alone, fresh, or Stale outside an active window → no incident.
      return { open: false, type: null, participantVisible: false };
    }

    case "scoring_delayed": {
      const scoredAfterVerified =
        input.latestRevisionAtMs !== null &&
        input.latestRevisionAtMs >= input.verifiedResultAtMs;
      if (scoredAfterVerified) {
        return { open: false, type: null, participantVisible: false };
      }
      const elapsed = input.nowMs - input.verifiedResultAtMs;
      if (elapsed > SCORING_DELAY_THRESHOLD_MS) {
        return {
          open: true,
          type: "scoring_delayed",
          participantVisible: true,
        };
      }
      return { open: false, type: null, participantVisible: false };
    }

    case "convex_capacity": {
      if (
        input.utilizationRatio >= CAPACITY_UTILIZATION_THRESHOLD ||
        input.projectedOverage
      ) {
        return {
          open: true,
          type: "convex_capacity",
          // Capacity is operator-facing; not a participant StatusBanner case.
          participantVisible: false,
        };
      }
      return { open: false, type: null, participantVisible: false };
    }
  }
}

/** Generic participant banner copy — no diagnostics. */
export function participantBannerSummary(type: IncidentType): string {
  switch (type) {
    case "provider_exception":
    case "stale_in_window":
    case "scoring_delayed":
      return "Some live scores or standings may be temporarily delayed.";
    case "convex_capacity":
      return "Some live scores or standings may be temporarily delayed.";
  }
}

/** Dedupe key: one failing surface/scope is one incident. */
export function incidentDedupeKey(
  type: IncidentType,
  surface: string,
  scopeKey: string,
): string {
  return `${type}:${surface}:${scopeKey}`;
}
