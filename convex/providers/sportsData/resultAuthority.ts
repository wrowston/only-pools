import type { LiveLifecycle } from "./liveSyncPolicy";

export type ImmediateVerifiedResult = Readonly<{
  homeScore: number;
  awayScore: number;
  verifiedAtMs: number;
  status: "FT" | "AOT" | "CANC";
}>;

type TerminalEvidence = Readonly<{
  observedAtMs: number;
  lifecycle: LiveLifecycle;
  homeScore: number | null;
  awayScore: number | null;
  providerStatus: Readonly<{
    rawShort: string;
    recognized: boolean;
    terminal: boolean;
  }>;
}>;

function coherentScore(value: number | null): value is number {
  return (
    value !== null &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

/**
 * Provider-neutral authority seam for the first accepted terminal result.
 * Cancellations deliberately use canonical 0-0 scores: existing Survivor and
 * Confidence rules key off CANC and do not require provider score evidence.
 */
export function immediateVerifiedResult(
  evidence: TerminalEvidence,
):
  | Readonly<{ accepted: true; result: ImmediateVerifiedResult }>
  | Readonly<{
      accepted: false;
      reason: "not_terminal" | "incoherent_scores";
    }> {
  if (
    !evidence.providerStatus.recognized ||
    !evidence.providerStatus.terminal
  ) {
    return { accepted: false, reason: "not_terminal" };
  }

  if (evidence.lifecycle === "canceled") {
    return {
      accepted: true,
      result: {
        homeScore: 0,
        awayScore: 0,
        verifiedAtMs: evidence.observedAtMs,
        status: "CANC",
      },
    };
  }

  const status = evidence.providerStatus.rawShort.trim().toUpperCase();
  if (
    evidence.lifecycle !== "terminal" ||
    (status !== "FT" && status !== "AOT")
  ) {
    return { accepted: false, reason: "not_terminal" };
  }
  if (
    !coherentScore(evidence.homeScore) ||
    !coherentScore(evidence.awayScore)
  ) {
    return { accepted: false, reason: "incoherent_scores" };
  }
  return {
    accepted: true,
    result: {
      homeScore: evidence.homeScore,
      awayScore: evidence.awayScore,
      verifiedAtMs: evidence.observedAtMs,
      status,
    },
  };
}
