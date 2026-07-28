export const LIVE_REFRESH_CADENCE_MS = 60_000;
export const LIVE_LEAD_MS = 15 * 60_000;
export const SCHEDULED_LIVE_GRACE_MS = 4 * 60 * 60_000;
export const SUCCESSFUL_SLATE_MISS_THRESHOLD = 2;

export type LiveLifecycle =
  | "scheduled"
  | "in_progress"
  | "interrupted"
  | "postponed"
  | "canceled"
  | "terminal"
  | "unknown";

export type LiveWindowGame = Readonly<{
  lifecycle: LiveLifecycle;
  scheduledKickoffMs: number;
}>;

export type LiveObservation = Readonly<{
  provider: string;
  externalId: string;
  observedAtMs?: number;
  lifecycle: LiveLifecycle;
  homeScore: number | null;
  awayScore: number | null;
  providerStatus: Readonly<{
    rawShort: string;
    rawLong: string;
    recognized: boolean;
    terminal: boolean;
  }>;
}>;

export type LiveObservationDecision =
  | "apply_projected"
  | "stale"
  | "duplicate"
  | "evidence_only"
  | "apply_verified"
  | "trusted_state";

export function isBeforeLiveWindowStart(input: {
  lifecycle: LiveLifecycle;
  scheduledKickoffMs: number;
  observedAtMs: number;
}): boolean {
  const reportsStartedPlay =
    input.lifecycle === "in_progress" ||
    input.lifecycle === "interrupted" ||
    input.lifecycle === "terminal";
  return (
    reportsStartedPlay &&
    input.observedAtMs <
      input.scheduledKickoffMs - LIVE_LEAD_MS
  );
}

export function isLivePollingActive(
  game: LiveWindowGame,
  nowMs: number,
): boolean {
  if (
    game.lifecycle === "in_progress" ||
    game.lifecycle === "interrupted"
  ) {
    return true;
  }
  if (game.lifecycle !== "scheduled") return false;
  return (
    nowMs >= game.scheduledKickoffMs - LIVE_LEAD_MS &&
    nowMs <= game.scheduledKickoffMs + SCHEDULED_LIVE_GRACE_MS
  );
}

export function isExpectedInSuccessfulLiveSlate(
  game: LiveWindowGame,
  nowMs: number,
): boolean {
  if (
    game.lifecycle === "in_progress" ||
    game.lifecycle === "interrupted"
  ) {
    return true;
  }
  return (
    game.lifecycle === "scheduled" &&
    nowMs >= game.scheduledKickoffMs &&
    nowMs <= game.scheduledKickoffMs + SCHEDULED_LIVE_GRACE_MS
  );
}

export function advanceSuccessfulSlateMiss(input: {
  previousMisses: number;
  expected: boolean;
  present: boolean;
  slateSucceeded?: boolean;
}): Readonly<{
  misses: number;
  enqueueTargetedRecovery: boolean;
}> {
  if (input.slateSucceeded === false) {
    return {
      misses: input.previousMisses,
      enqueueTargetedRecovery: false,
    };
  }
  if (!input.expected || input.present) {
    return { misses: 0, enqueueTargetedRecovery: false };
  }
  const misses = input.previousMisses + 1;
  return {
    misses,
    enqueueTargetedRecovery:
      misses === SUCCESSFUL_SLATE_MISS_THRESHOLD,
  };
}

/**
 * Provider observation identity deliberately excludes observation time so an
 * unchanged slate is a no-op at the domain boundary.
 */
export function liveObservationFingerprint(
  observation: LiveObservation,
): string {
  return JSON.stringify({
    provider: observation.provider,
    externalId: observation.externalId,
    lifecycle: observation.lifecycle,
    homeScore: observation.homeScore,
    awayScore: observation.awayScore,
    providerStatus: observation.providerStatus,
  });
}

export function classifyLiveObservation(input: {
  observation: LiveObservation & { observedAtMs: number };
  lastAppliedObservedAtMs?: number;
  lastFingerprint?: string;
  hasVerifiedResult: boolean;
}): LiveObservationDecision {
  if (
    input.lastAppliedObservedAtMs !== undefined &&
    input.observation.observedAtMs < input.lastAppliedObservedAtMs
  ) {
    return "stale";
  }
  if (
    input.lastFingerprint ===
    liveObservationFingerprint(input.observation)
  ) {
    return "duplicate";
  }
  if (input.hasVerifiedResult) return "trusted_state";
  if (
    input.observation.lifecycle === "unknown" ||
    !input.observation.providerStatus.recognized
  ) {
    return "evidence_only";
  }
  if (
    input.observation.lifecycle === "terminal" ||
    input.observation.lifecycle === "canceled" ||
    input.observation.providerStatus.terminal
  ) {
    return "apply_verified";
  }
  return "apply_projected";
}
