export const QUALIFICATION_FRESHNESS_LIMIT_MS = 2 * 60 * 1_000;

export type AutomatedProvider = "api-sports";
export type QualificationProvider = "api-sports";
export type QualificationEventKind = "score" | "final";
export type QualificationTerminalStatus = "FT" | "AOT" | "CANC";

export type QualificationEvidence = Readonly<{
  provider: QualificationProvider;
  externalId: string | null;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  status: QualificationTerminalStatus | null;
  ingestedAtMs: number;
  appliedAtMs: number;
}>;

export type QualificationReferenceEvent = Readonly<{
  eventId: string;
  gameId: string;
  kind: QualificationEventKind;
  referenceAtMs: number;
  referenceHomeTeam: string;
  referenceAwayTeam: string;
  referenceHomeScore: number;
  referenceAwayScore: number;
  referenceStatus: QualificationTerminalStatus | null;
  expectedExternalId?: string | null;
  evidence: QualificationEvidence | null;
}>;

export type QualificationFindingCode =
  | "no_reference_events"
  | "missing_final_reference"
  | "missing_game"
  | "identity_mismatch"
  | "home_away_reversal"
  | "score_error"
  | "final_status_error"
  | "timestamp_mismatch"
  | "freshness_breach";

export type QualificationFinding = Readonly<{
  eventId: string | null;
  gameId: string | null;
  code: QualificationFindingCode;
  message: string;
}>;

export type QualificationAssessment = Readonly<{
  decision: "passed" | "failed";
  observedEvents: number;
  correctnessErrors: number;
  freshnessBreaches: number;
  missingGames: number;
  identityMismatches: number;
  homeAwayReversals: number;
  scoreErrors: number;
  finalStatusErrors: number;
  maxIngestionDelayMs: number | null;
  maxApplicationDelayMs: number | null;
  findings: readonly QualificationFinding[];
}>;

function finding(
  event: QualificationReferenceEvent | null,
  code: QualificationFindingCode,
  message: string,
): QualificationFinding {
  return {
    eventId: event?.eventId ?? null,
    gameId: event?.gameId ?? null,
    code,
    message,
  };
}

/**
 * Deterministic qualification assessment. A reference observation is
 * independent authority: provider evidence may corroborate it, never alter it.
 */
export function assessQualificationWindow(
  events: readonly QualificationReferenceEvent[],
): QualificationAssessment {
  const findings: QualificationFinding[] = [];
  let missingGames = 0;
  let identityMismatches = 0;
  let homeAwayReversals = 0;
  let scoreErrors = 0;
  let finalStatusErrors = 0;
  let freshnessBreaches = 0;
  let maxIngestionDelayMs: number | null = null;
  let maxApplicationDelayMs: number | null = null;

  if (events.length === 0) {
    findings.push(
      finding(
        null,
        "no_reference_events",
        "At least one independent score or final observation is required.",
      ),
    );
  }

  for (const event of events) {
    const evidence = event.evidence;
    if (evidence === null) {
      missingGames += 1;
      findings.push(
        finding(
          event,
          "missing_game",
          "No provider ingestion/application transition matched this reference event.",
        ),
      );
      continue;
    }

    if (
      evidence.homeTeam === event.referenceAwayTeam &&
      evidence.awayTeam === event.referenceHomeTeam
    ) {
      homeAwayReversals += 1;
      findings.push(
        finding(
          event,
          "home_away_reversal",
          "Provider home and away identities are reversed.",
        ),
      );
    } else if (
      evidence.homeTeam !== event.referenceHomeTeam ||
      evidence.awayTeam !== event.referenceAwayTeam ||
      evidence.provider !== "api-sports" ||
      (event.expectedExternalId != null &&
        evidence.externalId !== event.expectedExternalId)
    ) {
      identityMismatches += 1;
      findings.push(
        finding(
          event,
          "identity_mismatch",
          "Provider game identity does not match the independent reference.",
        ),
      );
    }

    if (
      evidence.homeScore !== event.referenceHomeScore ||
      evidence.awayScore !== event.referenceAwayScore
    ) {
      scoreErrors += 1;
      findings.push(
        finding(
          event,
          "score_error",
          "Provider score does not match the independent reference.",
        ),
      );
    }

    if (
      event.kind === "final" &&
      evidence.status !== event.referenceStatus
    ) {
      finalStatusErrors += 1;
      findings.push(
        finding(
          event,
          "final_status_error",
          "Provider terminal status does not match the independent reference.",
        ),
      );
    }

    const ingestionDelayMs =
      evidence.ingestedAtMs - event.referenceAtMs;
    const applicationDelayMs =
      evidence.appliedAtMs - event.referenceAtMs;
    if (
      ingestionDelayMs < 0 ||
      applicationDelayMs < 0 ||
      evidence.appliedAtMs < evidence.ingestedAtMs
    ) {
      findings.push(
        finding(
          event,
          "timestamp_mismatch",
          "Provider timestamps do not preserve reference, ingestion, and application order.",
        ),
      );
      continue;
    }
    maxIngestionDelayMs = Math.max(
      maxIngestionDelayMs ?? 0,
      ingestionDelayMs,
    );
    maxApplicationDelayMs = Math.max(
      maxApplicationDelayMs ?? 0,
      applicationDelayMs,
    );
    if (
      ingestionDelayMs > QUALIFICATION_FRESHNESS_LIMIT_MS ||
      applicationDelayMs > QUALIFICATION_FRESHNESS_LIMIT_MS
    ) {
      freshnessBreaches += 1;
      findings.push(
        finding(
          event,
          "freshness_breach",
          "Provider ingestion or visible application exceeded two minutes.",
        ),
      );
    }
  }

  const correctnessErrors = findings.filter(
    ({ code }) =>
      code !== "freshness_breach" &&
      code !== "no_reference_events",
  ).length;
  return {
    decision:
      findings.length === 0 && events.length > 0 ? "passed" : "failed",
    observedEvents: events.length,
    correctnessErrors,
    freshnessBreaches,
    missingGames,
    identityMismatches,
    homeAwayReversals,
    scoreErrors,
    finalStatusErrors,
    maxIngestionDelayMs,
    maxApplicationDelayMs,
    findings,
  };
}

export type AutomatedProviderSyncDecision =
  | Readonly<{ allowed: true }>
  | Readonly<{
      allowed: false;
      reason:
        | "qualification_required"
        | "qualification_run_required"
        | "deployment_not_allowed";
    }>;

export function canRunAutomatedProviderSync(input: {
  deploymentKind: string;
  mode: "competitive" | "qualification";
  provider: AutomatedProvider;
  hasCurrentPassingQualification: boolean;
  hasActiveQualificationRun?: boolean;
}): AutomatedProviderSyncDecision {
  if (
    input.deploymentKind !== "production" &&
    input.deploymentKind !== "development" &&
    input.deploymentKind !== "dev"
  ) {
    return { allowed: false, reason: "deployment_not_allowed" };
  }
  if (
    input.mode === "qualification" &&
    input.hasActiveQualificationRun !== true
  ) {
    return {
      allowed: false,
      reason: "qualification_run_required",
    };
  }
  if (
    input.deploymentKind === "production" &&
    input.mode === "competitive" &&
    !input.hasCurrentPassingQualification
  ) {
    return { allowed: false, reason: "qualification_required" };
  }
  return { allowed: true };
}
