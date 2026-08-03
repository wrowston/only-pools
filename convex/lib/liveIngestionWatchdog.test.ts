import { describe, expect, it } from "vitest";

import {
  LIVE_INGESTION_CRITICAL_MS,
  LIVE_INGESTION_WARNING_MS,
  evaluateLiveIngestionWatchdog,
} from "./liveIngestionWatchdog";

describe("live ingestion watchdog policy", () => {
  const windowStartedAtMs = 1_000_000;

  it("stays healthy until the exact 90 second warning boundary", () => {
    expect(
      evaluateLiveIngestionWatchdog({
        activeWindowStartedAtMs: windowStartedAtMs,
        lastSuccessfulIngestionAtMs: null,
        nowMs: windowStartedAtMs + LIVE_INGESTION_WARNING_MS - 1,
      }),
    ).toMatchObject({ state: "healthy", elapsedMs: 89_999 });

    expect(
      evaluateLiveIngestionWatchdog({
        activeWindowStartedAtMs: windowStartedAtMs,
        lastSuccessfulIngestionAtMs: null,
        nowMs: windowStartedAtMs + LIVE_INGESTION_WARNING_MS,
      }),
    ).toMatchObject({ state: "warning", elapsedMs: 90_000 });
  });

  it("escalates at the exact 120 second critical boundary", () => {
    expect(
      evaluateLiveIngestionWatchdog({
        activeWindowStartedAtMs: windowStartedAtMs,
        lastSuccessfulIngestionAtMs: null,
        nowMs: windowStartedAtMs + LIVE_INGESTION_CRITICAL_MS - 1,
      }).state,
    ).toBe("warning");

    expect(
      evaluateLiveIngestionWatchdog({
        activeWindowStartedAtMs: windowStartedAtMs,
        lastSuccessfulIngestionAtMs: null,
        nowMs: windowStartedAtMs + LIVE_INGESTION_CRITICAL_MS,
      }).state,
    ).toBe("critical");
  });

  it("measures from a successful ingestion inside the expected window", () => {
    const lastSuccessfulIngestionAtMs = windowStartedAtMs + 45_000;
    expect(
      evaluateLiveIngestionWatchdog({
        activeWindowStartedAtMs: windowStartedAtMs,
        lastSuccessfulIngestionAtMs,
        nowMs:
          lastSuccessfulIngestionAtMs + LIVE_INGESTION_WARNING_MS - 1,
      }).state,
    ).toBe("healthy");
    expect(
      evaluateLiveIngestionWatchdog({
        activeWindowStartedAtMs: windowStartedAtMs,
        lastSuccessfulIngestionAtMs,
        nowMs: lastSuccessfulIngestionAtMs + LIVE_INGESTION_WARNING_MS,
      }).state,
    ).toBe("warning");
  });

  it("does not let a success before the expected window postpone detection", () => {
    expect(
      evaluateLiveIngestionWatchdog({
        activeWindowStartedAtMs: windowStartedAtMs,
        lastSuccessfulIngestionAtMs: windowStartedAtMs - 10_000,
        nowMs: windowStartedAtMs + LIVE_INGESTION_WARNING_MS,
      }),
    ).toMatchObject({
      state: "warning",
      referenceAtMs: windowStartedAtMs,
    });
  });
});
