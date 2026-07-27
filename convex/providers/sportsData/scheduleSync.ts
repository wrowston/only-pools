import type { NflGameLifecycle } from "./types";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const APPLICABLE_WEEK_LOOKAHEAD_MS = 7 * DAY_MS;
const NEAR_KICKOFF_MS = 2 * HOUR_MS;

export type ScheduleRefreshReason =
  | "daily"
  | "applicable_week"
  | "near_kickoff";

/**
 * Select the authoritative schedule cadence from stored kickoffs.
 *
 * A Pool Week becomes applicable once its next kickoff is within seven days.
 * The tighter two-hour window wins at its inclusive boundary.
 */
export function scheduleRefreshCadence(input: {
  nowMs: number;
  scheduledKickoffMs: readonly number[];
}): Readonly<{ cadenceMs: number; reason: ScheduleRefreshReason }> {
  const futureDeltas = input.scheduledKickoffMs
    .map((kickoffMs) => kickoffMs - input.nowMs)
    .filter((deltaMs) => deltaMs >= 0);

  if (futureDeltas.some((deltaMs) => deltaMs <= NEAR_KICKOFF_MS)) {
    return { cadenceMs: 5 * MINUTE_MS, reason: "near_kickoff" };
  }
  if (
    futureDeltas.some(
      (deltaMs) => deltaMs <= APPLICABLE_WEEK_LOOKAHEAD_MS,
    )
  ) {
    return { cadenceMs: HOUR_MS, reason: "applicable_week" };
  }
  return { cadenceMs: DAY_MS, reason: "daily" };
}
const STARTED_LIFECYCLES = new Set<NflGameLifecycle>([
  "in_progress",
  "interrupted",
  "terminal",
]);

/**
 * Pure schedule reducer. Unknown provider statuses are evidence, not trusted
 * lifecycle transitions. An earlier kickoff first learned at/after that
 * kickoff latches at observation time so previously accepted picks remain
 * valid while no later edit can be accepted.
 */
export function reduceScheduleObservation(input: {
  prior: Readonly<{
    scheduledKickoffMs: number;
    lifecycle: NflGameLifecycle;
    kickoffLockReachedAtMs: number | null;
  }>;
  observation: Readonly<{
    scheduledKickoffMs: number;
    lifecycle: NflGameLifecycle;
    lifecycleRecognized: boolean;
    observedAtMs: number;
  }>;
}): Readonly<{
  scheduledKickoffMs: number;
  lifecycle: NflGameLifecycle;
  kickoffLockReachedAtMs: number | null;
  unknownLifecyclePreserved: boolean;
}> {
  const trustedLifecycle = input.observation.lifecycleRecognized
    ? input.observation.lifecycle
    : input.prior.lifecycle;
  let kickoffLockReachedAtMs = input.prior.kickoffLockReachedAtMs;

  if (kickoffLockReachedAtMs === null) {
    const priorLockAlreadyReached =
      input.prior.scheduledKickoffMs <= input.observation.observedAtMs ||
      STARTED_LIFECYCLES.has(input.prior.lifecycle);
    const newlyObservedLockReached =
      input.observation.scheduledKickoffMs <=
        input.observation.observedAtMs ||
      (input.observation.lifecycleRecognized &&
        STARTED_LIFECYCLES.has(input.observation.lifecycle));

    if (priorLockAlreadyReached) {
      kickoffLockReachedAtMs = Math.min(
        input.observation.observedAtMs,
        input.prior.scheduledKickoffMs,
      );
    } else if (newlyObservedLockReached) {
      kickoffLockReachedAtMs = input.observation.observedAtMs;
    }
  }

  return {
    scheduledKickoffMs: input.observation.scheduledKickoffMs,
    lifecycle: trustedLifecycle,
    kickoffLockReachedAtMs,
    unknownLifecyclePreserved: !input.observation.lifecycleRecognized,
  };
}
