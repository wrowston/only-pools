import { describe, expect, it } from "vitest";
import {
  applyConfirmationObservation,
  CONFIRMATION_MIN_ELAPSED_MS,
  CONFIRMATION_MIN_SPACING_MS,
  emptyConfirmationState,
  isOfficialResult,
  type ConfirmationObservation,
} from "./confirmationPolicy";

const T0 = 1_700_000_000_000;

function terminal(
  atMs: number,
  home = 24,
  away = 17,
  status: "FT" | "AOT" | "CANC" = "FT",
): ConfirmationObservation {
  return { observedAtMs: atMs, homeScore: home, awayScore: away, status };
}

describe("confirmation policy (scenarios 24, 29)", () => {
  it("first FT/AOT remains provisional — not official", () => {
    const outcome = applyConfirmationObservation({
      prior: emptyConfirmationState(),
      observation: terminal(T0),
    });

    expect(outcome.resultAuthority).toBe("confirmation_pending");
    expect(outcome.provisionalTerminalAtMs).toBe(T0);
    expect(outcome.verifiedResult).toBeNull();
    expect(outcome.justVerified).toBe(false);
    expect(isOfficialResult(outcome.resultAuthority)).toBe(false);
  });

  it("matching 15-minute observation stays confirmation_pending", () => {
    const first = applyConfirmationObservation({
      prior: emptyConfirmationState(),
      observation: terminal(T0),
    });
    const at15 = applyConfirmationObservation({
      prior: first,
      observation: terminal(T0 + CONFIRMATION_MIN_SPACING_MS),
    });

    expect(at15.resultAuthority).toBe("confirmation_pending");
    expect(at15.verifiedResult).toBeNull();
    expect(at15.justVerified).toBe(false);
    expect(at15.observations).toHaveLength(2);
  });

  it("matching 60-minute observation produces Verified Result", () => {
    const first = applyConfirmationObservation({
      prior: emptyConfirmationState(),
      observation: terminal(T0),
    });
    const mid = applyConfirmationObservation({
      prior: first,
      observation: terminal(T0 + CONFIRMATION_MIN_SPACING_MS),
    });
    const verified = applyConfirmationObservation({
      prior: mid,
      observation: terminal(T0 + CONFIRMATION_MIN_ELAPSED_MS),
    });

    expect(verified.resultAuthority).toBe("verified");
    expect(verified.justVerified).toBe(true);
    expect(verified.verifiedResult).toEqual({
      homeScore: 24,
      awayScore: 17,
      verifiedAtMs: T0 + CONFIRMATION_MIN_ELAPSED_MS,
      status: "FT",
    });
    expect(isOfficialResult(verified.resultAuthority)).toBe(true);
  });

  it("direct matching observation at 60 minutes verifies without 15-minute hit", () => {
    const first = applyConfirmationObservation({
      prior: emptyConfirmationState(),
      observation: terminal(T0),
    });
    const verified = applyConfirmationObservation({
      prior: first,
      observation: terminal(T0 + CONFIRMATION_MIN_ELAPSED_MS),
    });

    expect(verified.resultAuthority).toBe("verified");
    expect(verified.justVerified).toBe(true);
  });

  it("score contradiction restarts the confirmation clock", () => {
    const first = applyConfirmationObservation({
      prior: emptyConfirmationState(),
      observation: terminal(T0, 24, 17),
    });
    const contradiction = applyConfirmationObservation({
      prior: first,
      observation: terminal(T0 + CONFIRMATION_MIN_SPACING_MS, 27, 17),
    });

    expect(contradiction.restarted).toBe(true);
    expect(contradiction.resultAuthority).toBe("confirmation_pending");
    expect(contradiction.provisionalTerminalAtMs).toBe(
      T0 + CONFIRMATION_MIN_SPACING_MS,
    );
    expect(contradiction.observations).toHaveLength(1);
    expect(contradiction.verifiedResult).toBeNull();
  });

  it("status contradiction restarts the confirmation clock", () => {
    const first = applyConfirmationObservation({
      prior: emptyConfirmationState(),
      observation: terminal(T0, 24, 17, "FT"),
    });
    const contradiction = applyConfirmationObservation({
      prior: first,
      observation: terminal(T0 + CONFIRMATION_MIN_ELAPSED_MS, 24, 17, "AOT"),
    });

    expect(contradiction.restarted).toBe(true);
    expect(contradiction.provisionalTerminalAtMs).toBe(
      T0 + CONFIRMATION_MIN_ELAPSED_MS,
    );
    expect(contradiction.verifiedResult).toBeNull();
  });

  it("failed confirmation lookup leaves Pending + retry", () => {
    const first = applyConfirmationObservation({
      prior: emptyConfirmationState(),
      observation: terminal(T0),
    });
    const failed = applyConfirmationObservation({
      prior: first,
      observation: terminal(T0 + CONFIRMATION_MIN_ELAPSED_MS),
      lookupFailed: true,
    });

    expect(failed.resultAuthority).toBe("confirmation_pending");
    expect(failed.pendingRetry).toBe(true);
    expect(failed.verifiedResult).toBeNull();
  });

  it("provisional is never treated as official (scenario 24)", () => {
    expect(isOfficialResult("none")).toBe(false);
    expect(isOfficialResult("projected")).toBe(false);
    expect(isOfficialResult("confirmation_pending")).toBe(false);
    expect(isOfficialResult("correction_candidate")).toBe(false);
    expect(isOfficialResult("verified")).toBe(true);
  });
});
