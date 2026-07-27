import { describe, expect, it } from "vitest";

import {
  correctionReconciliationSchedule,
  terminalEvidenceMatches,
} from "./correctionReconciliation";

describe("API-Sports corrected-result reconciliation policy", () => {
  it("schedules deterministic targeted lookups through two hours and once the next UTC morning", () => {
    const verifiedAtMs = Date.UTC(2026, 8, 13, 23, 30);

    expect(correctionReconciliationSchedule(verifiedAtMs)).toEqual([
      {
        purpose: "result_reconciliation_15m",
        dueAtMs: verifiedAtMs + 15 * 60_000,
      },
      {
        purpose: "result_reconciliation_30m",
        dueAtMs: verifiedAtMs + 30 * 60_000,
      },
      {
        purpose: "result_reconciliation_60m",
        dueAtMs: verifiedAtMs + 60 * 60_000,
      },
      {
        purpose: "result_reconciliation_120m",
        dueAtMs: verifiedAtMs + 120 * 60_000,
      },
      {
        purpose: "result_reconciliation_next_morning",
        dueAtMs: Date.UTC(2026, 8, 14, 14),
      },
    ]);
  });

  it("uses the first 14:00 UTC boundary after the two-hour window", () => {
    const verifiedAtMs = Date.UTC(2026, 8, 14, 2);
    expect(correctionReconciliationSchedule(verifiedAtMs).at(-1)).toEqual({
      purpose: "result_reconciliation_next_morning",
      dueAtMs: Date.UTC(2026, 8, 14, 14),
    });
  });

  it("compares terminal status and scores without using observation time", () => {
    const verified = { homeScore: 27, awayScore: 24, status: "FT" as const };
    expect(
      terminalEvidenceMatches(verified, {
        homeScore: 27,
        awayScore: 24,
        status: "FT",
      }),
    ).toBe(true);
    expect(
      terminalEvidenceMatches(verified, {
        homeScore: 28,
        awayScore: 24,
        status: "FT",
      }),
    ).toBe(false);
    expect(
      terminalEvidenceMatches(verified, {
        homeScore: 27,
        awayScore: 24,
        status: "AOT",
      }),
    ).toBe(false);
  });
});
