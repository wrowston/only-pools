import { describe, expect, it } from "vitest";
import {
  ResendConfigError,
  ResendDecodeError,
  ResendHttpError,
} from "../effect/resend/errors";
import {
  HELP_DELIVERY_MAX_ATTEMPTS,
  classifyDeliveryError,
  computeNextAttemptDelayMs,
  isDeliveryExhausted,
  isDeliveryTerminal,
  shouldAttemptDelivery,
} from "./helpDeliveryPolicy";

describe("helpDeliveryPolicy", () => {
  it("classifies transient network and 5xx errors as retryable", () => {
    expect(
      classifyDeliveryError(
        new ResendHttpError({ status: 0, statusText: "network" }),
      ),
    ).toEqual({ failureClass: "network", retryable: true });
    expect(
      classifyDeliveryError(
        new ResendHttpError({ status: 503, statusText: "unavailable" }),
      ),
    ).toEqual({ failureClass: "provider_5xx", retryable: true });
    expect(
      classifyDeliveryError(
        new ResendHttpError({ status: 429, statusText: "rate limit" }),
      ),
    ).toEqual({ failureClass: "rate_limited", retryable: true });
  });

  it("classifies permanent client errors as non-retryable", () => {
    expect(
      classifyDeliveryError(
        new ResendHttpError({ status: 400, statusText: "bad request" }),
      ),
    ).toEqual({ failureClass: "invalid_request", retryable: false });
    expect(
      classifyDeliveryError(
        new ResendHttpError({ status: 403, statusText: "forbidden" }),
      ),
    ).toEqual({ failureClass: "auth", retryable: false });
    expect(
      classifyDeliveryError(new ResendConfigError({ detail: "missing key" })),
    ).toEqual({ failureClass: "config", retryable: false });
  });

  it("treats decode errors as retryable", () => {
    expect(
      classifyDeliveryError(new ResendDecodeError({ detail: "bad json" })),
    ).toEqual({ failureClass: "decode_error", retryable: true });
  });

  it("computes bounded backoff delays", () => {
    expect(computeNextAttemptDelayMs(1)).toBe(60_000);
    expect(computeNextAttemptDelayMs(4)).toBe(3_600_000);
    expect(computeNextAttemptDelayMs(99)).toBe(3_600_000);
  });

  it("marks terminal and due delivery states correctly", () => {
    expect(isDeliveryTerminal({ status: "sent", attemptCount: 1 })).toBe(true);
    expect(isDeliveryTerminal({ status: "failed", attemptCount: 3 })).toBe(
      true,
    );
    expect(
      shouldAttemptDelivery(
        { status: "pending", attemptCount: 0, nextAttemptAtMs: 1000 },
        500,
      ),
    ).toBe(false);
    expect(
      shouldAttemptDelivery(
        { status: "pending", attemptCount: 1, nextAttemptAtMs: 100 },
        500,
      ),
    ).toBe(true);
  });

  it("exhausts after max attempts", () => {
    expect(isDeliveryExhausted(HELP_DELIVERY_MAX_ATTEMPTS)).toBe(true);
    expect(isDeliveryExhausted(HELP_DELIVERY_MAX_ATTEMPTS - 1)).toBe(false);
  });
});
