/**
 * Context-aware sync freshness derivation.
 *
 * Late alone must not raise a participant banner (ticket 13 owns banners).
 * Stale-in-window and Provider Exception are distinguishable for later wiring.
 *
 * Thresholds follow settled schedule/cost controls (issue 18), simplified into
 * testable constants matching the league-live and confirmation cadences.
 */

export type FreshnessState = "fresh" | "late" | "stale" | "provider_exception";

export type SyncSurfaceKind = "league_live" | "confirmation" | "schedule";

export type FreshnessInput = {
  surface: SyncSurfaceKind;
  /** Last successful observation / refresh for this surface (ms). */
  lastSuccessAtMs: number | null;
  /** Now (Convex server receipt time). */
  nowMs: number;
  /**
   * For confirmation: when the lookup was due. When set, Late/Stale are
   * measured against due time rather than last success cadence.
   */
  dueAtMs?: number | null;
  /** Immediate Provider Exception flag (distinct from Late/Stale). */
  providerException?: boolean;
};

/** League-live: Late after 4 minutes, Stale after 10. */
export const LEAGUE_LIVE_LATE_MS = 4 * 60 * 1000;
export const LEAGUE_LIVE_STALE_MS = 10 * 60 * 1000;

/** Terminal confirmation: Late 5 minutes and Stale 15 minutes after due. */
export const CONFIRMATION_LATE_AFTER_DUE_MS = 5 * 60 * 1000;
export const CONFIRMATION_STALE_AFTER_DUE_MS = 15 * 60 * 1000;

/** Schedule (near kickoff window simplification): Late 4 min / Stale 10 min. */
export const SCHEDULE_NEAR_LATE_MS = 4 * 60 * 1000;
export const SCHEDULE_NEAR_STALE_MS = 10 * 60 * 1000;

export type FreshnessResult = {
  state: FreshnessState;
  /** Participant-facing banner eligibility — Late alone is never bannered. */
  raisesParticipantBanner: boolean;
};

/**
 * Derive freshness for a sync surface. Provider Exception wins immediately.
 */
export function deriveFreshness(input: FreshnessInput): FreshnessResult {
  if (input.providerException) {
    return { state: "provider_exception", raisesParticipantBanner: true };
  }

  if (input.surface === "confirmation" && input.dueAtMs != null) {
    const overdue = input.nowMs - input.dueAtMs;
    if (overdue >= CONFIRMATION_STALE_AFTER_DUE_MS) {
      return { state: "stale", raisesParticipantBanner: true };
    }
    if (overdue >= CONFIRMATION_LATE_AFTER_DUE_MS) {
      return { state: "late", raisesParticipantBanner: false };
    }
    return { state: "fresh", raisesParticipantBanner: false };
  }

  if (input.lastSuccessAtMs === null) {
    // No success yet — treat as provider_exception only when flagged; else late.
    return { state: "late", raisesParticipantBanner: false };
  }

  const age = input.nowMs - input.lastSuccessAtMs;
  const lateMs =
    input.surface === "schedule" ? SCHEDULE_NEAR_LATE_MS : LEAGUE_LIVE_LATE_MS;
  const staleMs =
    input.surface === "schedule" ? SCHEDULE_NEAR_STALE_MS : LEAGUE_LIVE_STALE_MS;

  if (age >= staleMs) {
    return { state: "stale", raisesParticipantBanner: true };
  }
  if (age >= lateMs) {
    return { state: "late", raisesParticipantBanner: false };
  }
  return { state: "fresh", raisesParticipantBanner: false };
}
