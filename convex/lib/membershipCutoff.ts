/**
 * Membership admission closes at the scheduled kickoff of the earliest
 * Start Week game. Once latched, a reschedule never reopens admission.
 */

export function earliestStartWeekKickoffMs(
  games: Array<{ scheduledKickoffMs: number }>,
): number | null {
  if (games.length === 0) return null;
  return Math.min(...games.map((g) => g.scheduledKickoffMs));
}

/**
 * Returns the latch timestamp when admission should close, or null if still open.
 * Prefer an already-latched admissionClosedAtMs over a rescheduled kickoff.
 */
export function resolveAdmissionClosedAtMs(args: {
  nowMs: number;
  admissionClosedAtMs: number | undefined;
  earliestKickoffMs: number | null;
}): number | null {
  if (args.admissionClosedAtMs !== undefined) {
    return args.admissionClosedAtMs;
  }
  if (
    args.earliestKickoffMs !== null &&
    args.earliestKickoffMs <= args.nowMs
  ) {
    return args.earliestKickoffMs;
  }
  return null;
}

export function isAdmissionClosed(args: {
  nowMs: number;
  admissionClosedAtMs: number | undefined;
  earliestKickoffMs: number | null;
}): boolean {
  return resolveAdmissionClosedAtMs(args) !== null;
}
