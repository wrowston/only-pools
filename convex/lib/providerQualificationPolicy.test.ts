import { describe, expect, it } from "vitest";

import {
  assessQualificationWindow,
  canRunAutomatedProviderSync,
  QUALIFICATION_FRESHNESS_LIMIT_MS,
} from "./providerQualificationPolicy";

const REFERENCE_AT_MS = Date.UTC(2026, 8, 14, 20);

function matchingEvent(
  overrides: Record<string, unknown> = {},
) {
  return {
    eventId: "event-1",
    gameId: "game-1",
    kind: "score" as const,
    referenceAtMs: REFERENCE_AT_MS,
    referenceHomeTeam: "DEN",
    referenceAwayTeam: "KC",
    referenceHomeScore: 7,
    referenceAwayScore: 3,
    referenceStatus: null,
    evidence: {
      provider: "api-sports" as const,
      externalId: "fixture-1",
      homeTeam: "DEN",
      awayTeam: "KC",
      homeScore: 7,
      awayScore: 3,
      status: null,
      ingestedAtMs: REFERENCE_AT_MS + 30_000,
      appliedAtMs: REFERENCE_AT_MS + 45_000,
    },
    ...overrides,
  };
}

describe("provider qualification policy", () => {
  it("passes only when every reference event is correct and visible within two minutes", () => {
    const result = assessQualificationWindow([
      matchingEvent(),
      matchingEvent({
        eventId: "event-2",
        kind: "final",
        referenceHomeScore: 24,
        referenceAwayScore: 20,
        referenceStatus: "FT",
        evidence: {
          provider: "api-sports",
          externalId: "fixture-1",
          homeTeam: "DEN",
          awayTeam: "KC",
          homeScore: 24,
          awayScore: 20,
          status: "FT",
          ingestedAtMs:
            REFERENCE_AT_MS + QUALIFICATION_FRESHNESS_LIMIT_MS,
          appliedAtMs:
            REFERENCE_AT_MS + QUALIFICATION_FRESHNESS_LIMIT_MS,
        },
      }),
    ]);

    expect(result).toMatchObject({
      decision: "passed",
      observedEvents: 2,
      correctnessErrors: 0,
      freshnessBreaches: 0,
      maxIngestionDelayMs: QUALIFICATION_FRESHNESS_LIMIT_MS,
      maxApplicationDelayMs: QUALIFICATION_FRESHNESS_LIMIT_MS,
    });
    expect(result.findings).toEqual([]);
  });

  it.each([
    [
      "missing games",
      matchingEvent({ evidence: null }),
      "missing_game",
    ],
    [
      "identity mismatches",
      matchingEvent({
        evidence: {
          ...matchingEvent().evidence,
          externalId: "wrong-fixture",
        },
        expectedExternalId: "fixture-1",
      }),
      "identity_mismatch",
    ],
    [
      "home/away reversals",
      matchingEvent({
        evidence: {
          ...matchingEvent().evidence,
          homeTeam: "KC",
          awayTeam: "DEN",
          homeScore: 3,
          awayScore: 7,
        },
      }),
      "home_away_reversal",
    ],
    [
      "score errors",
      matchingEvent({
        evidence: {
          ...matchingEvent().evidence,
          homeScore: 6,
        },
      }),
      "score_error",
    ],
    [
      "freshness breaches",
      matchingEvent({
        evidence: {
          ...matchingEvent().evidence,
          appliedAtMs:
            REFERENCE_AT_MS + QUALIFICATION_FRESHNESS_LIMIT_MS + 1,
        },
      }),
      "freshness_breach",
    ],
  ])("fails and identifies %s", (_label, event, code) => {
    const result = assessQualificationWindow([event]);
    expect(result.decision).toBe("failed");
    expect(result.findings.map((finding) => finding.code)).toContain(code);
  });

  it("does not qualify an empty or clock-incoherent window", () => {
    expect(assessQualificationWindow([])).toMatchObject({
      decision: "failed",
      findings: [{ code: "no_reference_events" }],
    });
    expect(
      assessQualificationWindow([
        matchingEvent({
          evidence: {
            ...matchingEvent().evidence,
            ingestedAtMs: REFERENCE_AT_MS - 1,
          },
        }),
      ]),
    ).toMatchObject({
      decision: "failed",
      findings: [{ code: "timestamp_mismatch" }],
    });
    expect(
      assessQualificationWindow([
        matchingEvent({
          evidence: {
            ...matchingEvent().evidence,
            ingestedAtMs: REFERENCE_AT_MS + 30_000,
            appliedAtMs: REFERENCE_AT_MS + 29_999,
          },
        }),
      ]),
    ).toMatchObject({
      decision: "failed",
      findings: [{ code: "timestamp_mismatch" }],
    });
  });

  it("counts final-status errors independently from score errors", () => {
    const result = assessQualificationWindow([
      matchingEvent({
        kind: "final",
        referenceStatus: "FT",
        evidence: {
          ...matchingEvent().evidence,
          status: "AOT",
        },
      }),
    ]);
    expect(result).toMatchObject({
      decision: "failed",
      scoreErrors: 0,
      finalStatusErrors: 1,
      findings: [{ code: "final_status_error" }],
    });
  });

  it("keeps API-Sports as the only automated production provider while permitting qualification and development runs", () => {
    expect(
      canRunAutomatedProviderSync({
        deploymentKind: "production",
        mode: "competitive",
        provider: "api-sports",
        hasCurrentPassingQualification: true,
      }),
    ).toEqual({ allowed: true });
    expect(
      canRunAutomatedProviderSync({
        deploymentKind: "production",
        mode: "competitive",
        provider: "api-sports",
        hasCurrentPassingQualification: false,
      }),
    ).toEqual({
      allowed: false,
      reason: "qualification_required",
    });
    expect(
      canRunAutomatedProviderSync({
        deploymentKind: "production",
        mode: "competitive",
        provider: "legacy",
        hasCurrentPassingQualification: true,
      }),
    ).toEqual({
      allowed: false,
      reason: "production_provider_not_allowed",
    });
    expect(
      canRunAutomatedProviderSync({
        deploymentKind: "production",
        mode: "qualification",
        provider: "api-sports",
        hasCurrentPassingQualification: false,
        hasActiveQualificationRun: true,
      }),
    ).toEqual({ allowed: true });
    for (const deploymentKind of ["", "unknown", "staging"]) {
      expect(
        canRunAutomatedProviderSync({
          deploymentKind,
          mode: "competitive",
          provider: "api-sports",
          hasCurrentPassingQualification: true,
        }),
      ).toEqual({ allowed: false, reason: "deployment_not_allowed" });
    }
    expect(
      canRunAutomatedProviderSync({
        deploymentKind: "production",
        mode: "qualification",
        provider: "api-sports",
        hasCurrentPassingQualification: false,
      }),
    ).toEqual({
      allowed: false,
      reason: "qualification_run_required",
    });
    expect(
      canRunAutomatedProviderSync({
        deploymentKind: "development",
        mode: "competitive",
        provider: "api-sports",
        hasCurrentPassingQualification: false,
      }),
    ).toEqual({ allowed: true });
  });
});
