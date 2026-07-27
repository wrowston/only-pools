export const CORRECTION_RECONCILIATION_OFFSETS = [
  { purpose: "result_reconciliation_15m", offsetMs: 15 * 60_000 },
  { purpose: "result_reconciliation_30m", offsetMs: 30 * 60_000 },
  { purpose: "result_reconciliation_60m", offsetMs: 60 * 60_000 },
  { purpose: "result_reconciliation_120m", offsetMs: 120 * 60_000 },
] as const;

export const NEXT_MORNING_UTC_HOUR = 14;

export type CorrectionReconciliationPurpose =
  | (typeof CORRECTION_RECONCILIATION_OFFSETS)[number]["purpose"]
  | "result_reconciliation_next_morning";

type TerminalResult = Readonly<{
  homeScore: number;
  awayScore: number;
  status: "FT" | "AOT" | "CANC";
}>;

/**
 * Deterministic provider reconciliation: four targeted checks in the first two
 * hours, then at the first 14:00 UTC boundary strictly after that window.
 */
export function correctionReconciliationSchedule(
  verifiedAtMs: number,
): ReadonlyArray<{
  purpose: CorrectionReconciliationPurpose;
  dueAtMs: number;
}> {
  const windowEndAtMs =
    verifiedAtMs +
    CORRECTION_RECONCILIATION_OFFSETS[
      CORRECTION_RECONCILIATION_OFFSETS.length - 1
    ]!.offsetMs;
  const windowEnd = new Date(windowEndAtMs);
  let nextMorningAtMs = Date.UTC(
    windowEnd.getUTCFullYear(),
    windowEnd.getUTCMonth(),
    windowEnd.getUTCDate(),
    NEXT_MORNING_UTC_HOUR,
  );
  if (nextMorningAtMs <= windowEndAtMs) {
    nextMorningAtMs = Date.UTC(
      windowEnd.getUTCFullYear(),
      windowEnd.getUTCMonth(),
      windowEnd.getUTCDate() + 1,
      NEXT_MORNING_UTC_HOUR,
    );
  }
  return [
    ...CORRECTION_RECONCILIATION_OFFSETS.map(({ purpose, offsetMs }) => ({
      purpose,
      dueAtMs: verifiedAtMs + offsetMs,
    })),
    {
      purpose: "result_reconciliation_next_morning" as const,
      dueAtMs: nextMorningAtMs,
    },
  ];
}

export function terminalEvidenceMatches(
  verified: TerminalResult,
  observed: TerminalResult,
): boolean {
  return (
    verified.status === observed.status &&
    verified.homeScore === observed.homeScore &&
    verified.awayScore === observed.awayScore
  );
}
