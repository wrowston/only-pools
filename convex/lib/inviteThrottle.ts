/**
 * Progressive throttle for invalid / expired / probing Pool Invite attempts.
 * Never auto-rotates a valid invite.
 */

export const INVITE_UNAVAILABLE = "Invite unavailable";

const WINDOW_MS = 15 * 60 * 1000;

/** Returns block duration in ms after this many failed attempts in the window. */
export function blockDurationAfterAttempts(attemptCount: number): number {
  if (attemptCount >= 8) return 15 * 60 * 1000;
  if (attemptCount >= 5) return 2 * 60 * 1000;
  if (attemptCount >= 3) return 30 * 1000;
  return 0;
}

export type ThrottleState = {
  attemptCount: number;
  windowStartMs: number;
  blockedUntilMs?: number;
};

export function evaluateThrottle(
  existing: ThrottleState | null,
  nowMs: number,
): {
  blocked: boolean;
  next: ThrottleState;
} {
  if (existing?.blockedUntilMs !== undefined && existing.blockedUntilMs > nowMs) {
    return {
      blocked: true,
      next: existing,
    };
  }

  const windowFresh =
    existing === null || nowMs - existing.windowStartMs > WINDOW_MS;

  const attemptCount = windowFresh ? 1 : existing.attemptCount + 1;
  const windowStartMs = windowFresh ? nowMs : existing.windowStartMs;
  const blockMs = blockDurationAfterAttempts(attemptCount);

  return {
    blocked: false,
    next: {
      attemptCount,
      windowStartMs,
      blockedUntilMs: blockMs > 0 ? nowMs + blockMs : undefined,
    },
  };
}
