/**
 * Retry policy and error classification for Help email delivery.
 */

import {
  ResendConfigError,
  ResendDecodeError,
  ResendHttpError,
} from "../effect/resend/errors";

export const HELP_DELIVERY_MAX_ATTEMPTS = 5;

/** Delay before attempt N+1 (after failed attempt N). */
export const HELP_DELIVERY_BACKOFF_MS = [
  60_000,
  300_000,
  900_000,
  3_600_000,
] as const;

export type DeliveryRecipient = "mailbox" | "receipt";

export type DeliveryState = {
  status: "pending" | "sent" | "failed" | "skipped";
  attemptCount: number;
  nextAttemptAtMs?: number;
  providerMessageId?: string;
  failureClass?: string;
  lastAttemptAtMs?: number;
};

export type ClassifiedDeliveryFailure = {
  failureClass: string;
  retryable: boolean;
};

export function classifyDeliveryError(error: unknown): ClassifiedDeliveryFailure {
  if (error instanceof ResendHttpError) {
    if (error.status === 0) {
      return { failureClass: "network", retryable: true };
    }
    if (error.status === 429) {
      return { failureClass: "rate_limited", retryable: true };
    }
    if (error.status >= 500) {
      return { failureClass: "provider_5xx", retryable: true };
    }
    if (error.status === 401 || error.status === 403) {
      return { failureClass: "auth", retryable: false };
    }
    if (error.status === 400) {
      return { failureClass: "invalid_request", retryable: false };
    }
    if (error.status >= 400 && error.status < 500) {
      return { failureClass: "client_error", retryable: false };
    }
    return { failureClass: "http_error", retryable: false };
  }

  if (error instanceof ResendDecodeError) {
    return { failureClass: "decode_error", retryable: true };
  }

  if (error instanceof ResendConfigError) {
    return { failureClass: "config", retryable: false };
  }

  if (error instanceof Error) {
    return {
      failureClass: error.name || "Error",
      retryable: true,
    };
  }

  return { failureClass: "unknown", retryable: true };
}

export function computeNextAttemptDelayMs(attemptCount: number): number {
  const index = Math.max(0, Math.min(attemptCount - 1, HELP_DELIVERY_BACKOFF_MS.length - 1));
  return HELP_DELIVERY_BACKOFF_MS[index]!;
}

export function isDeliveryTerminal(state: DeliveryState): boolean {
  return state.status === "sent" || state.status === "skipped" || state.status === "failed";
}

/**
 * True when this recipient should be attempted now (pending or retry due).
 */
export function shouldAttemptDelivery(
  state: DeliveryState,
  nowMs: number,
): boolean {
  if (state.status === "sent" || state.status === "skipped") {
    return false;
  }
  if (state.status === "failed") {
    return false;
  }
  if (state.nextAttemptAtMs !== undefined && state.nextAttemptAtMs > nowMs) {
    return false;
  }
  return true;
}

export function isDeliveryExhausted(attemptCount: number): boolean {
  return attemptCount >= HELP_DELIVERY_MAX_ATTEMPTS;
}
