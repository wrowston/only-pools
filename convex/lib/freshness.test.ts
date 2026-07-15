import { describe, expect, it } from "vitest";
import {
  CONFIRMATION_LATE_AFTER_DUE_MS,
  CONFIRMATION_STALE_AFTER_DUE_MS,
  deriveFreshness,
  LEAGUE_LIVE_LATE_MS,
  LEAGUE_LIVE_STALE_MS,
} from "./freshness";

const NOW = 1_700_000_000_000;

describe("freshness derivation (scenario 30 — Stale vs Late)", () => {
  it("league-live is fresh within the Late threshold", () => {
    const result = deriveFreshness({
      surface: "league_live",
      lastSuccessAtMs: NOW - LEAGUE_LIVE_LATE_MS + 1_000,
      nowMs: NOW,
    });
    expect(result.state).toBe("fresh");
    expect(result.raisesParticipantBanner).toBe(false);
  });

  it("league-live Late alone does not raise a participant banner", () => {
    const result = deriveFreshness({
      surface: "league_live",
      lastSuccessAtMs: NOW - LEAGUE_LIVE_LATE_MS - 1_000,
      nowMs: NOW,
    });
    expect(result.state).toBe("late");
    expect(result.raisesParticipantBanner).toBe(false);
  });

  it("league-live Stale is distinguishable and banner-eligible", () => {
    const result = deriveFreshness({
      surface: "league_live",
      lastSuccessAtMs: NOW - LEAGUE_LIVE_STALE_MS - 1_000,
      nowMs: NOW,
    });
    expect(result.state).toBe("stale");
    expect(result.raisesParticipantBanner).toBe(true);
  });

  it("Provider Exception is immediate and distinct from Late/Stale", () => {
    const result = deriveFreshness({
      surface: "league_live",
      lastSuccessAtMs: NOW,
      nowMs: NOW,
      providerException: true,
    });
    expect(result.state).toBe("provider_exception");
    expect(result.raisesParticipantBanner).toBe(true);
  });

  it("confirmation Late after due does not raise a participant banner", () => {
    const dueAtMs = NOW - CONFIRMATION_LATE_AFTER_DUE_MS - 1_000;
    const result = deriveFreshness({
      surface: "confirmation",
      lastSuccessAtMs: dueAtMs - 60_000,
      nowMs: NOW,
      dueAtMs,
    });
    expect(result.state).toBe("late");
    expect(result.raisesParticipantBanner).toBe(false);
  });

  it("confirmation Stale after due is distinguishable", () => {
    const dueAtMs = NOW - CONFIRMATION_STALE_AFTER_DUE_MS - 1_000;
    const result = deriveFreshness({
      surface: "confirmation",
      lastSuccessAtMs: dueAtMs - 60_000,
      nowMs: NOW,
      dueAtMs,
    });
    expect(result.state).toBe("stale");
    expect(result.raisesParticipantBanner).toBe(true);
  });
});
