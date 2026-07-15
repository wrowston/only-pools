import { describe, expect, it } from "vitest";
import {
  CAPACITY_UTILIZATION_THRESHOLD,
  SCORING_DELAY_THRESHOLD_MS,
  shouldOpenIncident,
} from "./incidents";

const NOW = 1_700_000_000_000;

describe("shouldOpenIncident (scenario 42 — incident triggers)", () => {
  it("opens for Provider Exception", () => {
    const decision = shouldOpenIncident({ kind: "provider_exception" });
    expect(decision.open).toBe(true);
    expect(decision.type).toBe("provider_exception");
    expect(decision.participantVisible).toBe(true);
  });

  it("opens for freshness Provider Exception", () => {
    const decision = shouldOpenIncident({
      kind: "freshness",
      freshnessState: "provider_exception",
      activeGameWindow: true,
    });
    expect(decision.open).toBe(true);
    expect(decision.type).toBe("provider_exception");
  });

  it("opens for Stale during an active game window", () => {
    const decision = shouldOpenIncident({
      kind: "freshness",
      freshnessState: "stale",
      activeGameWindow: true,
    });
    expect(decision.open).toBe(true);
    expect(decision.type).toBe("stale_in_window");
    expect(decision.participantVisible).toBe(true);
  });

  it("does not open for Late alone", () => {
    const decision = shouldOpenIncident({
      kind: "freshness",
      freshnessState: "late",
      activeGameWindow: true,
    });
    expect(decision.open).toBe(false);
    expect(decision.type).toBeNull();
    expect(decision.participantVisible).toBe(false);
  });

  it("does not open for Stale outside an active game window", () => {
    const decision = shouldOpenIncident({
      kind: "freshness",
      freshnessState: "stale",
      activeGameWindow: false,
    });
    expect(decision.open).toBe(false);
  });

  it("opens when scoring is delayed more than ten minutes after a Verified Result", () => {
    const verifiedResultAtMs = NOW - SCORING_DELAY_THRESHOLD_MS - 1_000;
    const decision = shouldOpenIncident({
      kind: "scoring_delayed",
      verifiedResultAtMs,
      latestRevisionAtMs: null,
      nowMs: NOW,
    });
    expect(decision.open).toBe(true);
    expect(decision.type).toBe("scoring_delayed");
    expect(decision.participantVisible).toBe(true);
  });

  it("does not open when a Scoring Revision exists after the Verified Result", () => {
    const verifiedResultAtMs = NOW - SCORING_DELAY_THRESHOLD_MS - 60_000;
    const decision = shouldOpenIncident({
      kind: "scoring_delayed",
      verifiedResultAtMs,
      latestRevisionAtMs: verifiedResultAtMs + 30_000,
      nowMs: NOW,
    });
    expect(decision.open).toBe(false);
  });

  it("does not open when scoring delay is within the ten-minute window", () => {
    const verifiedResultAtMs = NOW - SCORING_DELAY_THRESHOLD_MS + 5_000;
    const decision = shouldOpenIncident({
      kind: "scoring_delayed",
      verifiedResultAtMs,
      latestRevisionAtMs: null,
      nowMs: NOW,
    });
    expect(decision.open).toBe(false);
  });

  it("opens for quarantine past the confirmation window", () => {
    const decision = shouldOpenIncident({
      kind: "quarantine_past_confirmation",
      confirmationWindowEndsAtMs: NOW - 1_000,
      nowMs: NOW,
      verificationBlocked: true,
    });
    expect(decision.open).toBe(true);
    expect(decision.type).toBe("quarantine_past_confirmation");
  });

  it("does not open for quarantine still inside the confirmation window", () => {
    const decision = shouldOpenIncident({
      kind: "quarantine_past_confirmation",
      confirmationWindowEndsAtMs: NOW + 60_000,
      nowMs: NOW,
      verificationBlocked: true,
    });
    expect(decision.open).toBe(false);
  });

  it("opens for Convex capacity at or above 90 percent", () => {
    const decision = shouldOpenIncident({
      kind: "convex_capacity",
      utilizationRatio: CAPACITY_UTILIZATION_THRESHOLD,
      projectedOverage: false,
    });
    expect(decision.open).toBe(true);
    expect(decision.type).toBe("convex_capacity");
    expect(decision.participantVisible).toBe(false);
  });

  it("opens for Convex capacity projected overage", () => {
    const decision = shouldOpenIncident({
      kind: "convex_capacity",
      utilizationRatio: 0.5,
      projectedOverage: true,
    });
    expect(decision.open).toBe(true);
    expect(decision.type).toBe("convex_capacity");
  });

  it("does not open for Convex capacity below threshold without projected overage", () => {
    const decision = shouldOpenIncident({
      kind: "convex_capacity",
      utilizationRatio: 0.89,
      projectedOverage: false,
    });
    expect(decision.open).toBe(false);
  });
});
