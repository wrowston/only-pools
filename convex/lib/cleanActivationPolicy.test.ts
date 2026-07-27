import { describe, expect, it } from "vitest";
import {
  buildActivationPlan,
  cleanActivationConfirmationText,
  CLEAN_ACTIVATION_LIMITS,
  CLEAN_ACTIVATION_DELETE_ORDER,
  CLEAN_ACTIVATION_POLICY,
  CLEAN_ACTIVATION_PRESERVED_CATEGORIES,
  resolveCleanActivationDeployment,
} from "./cleanActivationPolicy";

describe("clean Season Bootstrap activation policy", () => {
  it("makes the deletion and preservation scope explicit", () => {
    const tablesFor = (
      disposition: "delete" | "rebuild" | "preserve",
    ) =>
      Object.entries(CLEAN_ACTIVATION_POLICY)
        .filter(([, policy]) => policy.disposition === disposition)
        .map(([tableName]) => tableName)
        .sort();
    expect(
      tablesFor("delete"),
    ).toEqual(
      [
        "abuseReports",
        "confidencePickOutcomes",
        "confidencePickSets",
        "confidencePickSheets",
        "confidencePicks",
        "inviteThrottle",
        "operatorIncidents",
        "ownershipTransferOffers",
        "participants",
        "poolAuditEvents",
        "poolEntries",
        "poolInvites",
        "poolMemberships",
        "poolWeeks",
        "pools",
        "providerExceptions",
        "providerFetchClaims",
        "returningParticipantInvites",
        "scoringRevisions",
        "seasonStandings",
        "sportsDataStatusEvidence",
        "survivorPickOutcomes",
        "survivorPicks",
        "survivorTeamReservations",
        "syncSurfaceHealth",
        "syncWorkItems",
        "weeklyStandings",
      ].sort(),
    );
    expect(
      tablesFor("rebuild"),
    ).toEqual(
      [
        "nflGameAliases",
        "nflGameScheduleHistory",
        "nflGames",
        "nflTeamAliases",
        "nflTeams",
        "poolSeasons",
      ].sort(),
    );
    expect(
      tablesFor("preserve"),
    ).toEqual(
      [
        "operatorAuditEvents",
        "seasonBootstrapActivationRequests",
        "seasonBootstrapStages",
        "seasonBootstrapStagedAliases",
        "seasonBootstrapStagedGames",
        "seasonBootstrapStagedTeams",
        "seasonBootstrapValidationFailures",
        "syncGate",
      ].sort(),
    );
    const destructiveTables = [
      ...tablesFor("delete"),
      ...tablesFor("rebuild"),
    ].sort();
    expect([...CLEAN_ACTIVATION_DELETE_ORDER].sort()).toEqual(
      destructiveTables,
    );
    expect(new Set(CLEAN_ACTIVATION_DELETE_ORDER).size).toBe(
      CLEAN_ACTIVATION_DELETE_ORDER.length,
    );
    for (const tableName of CLEAN_ACTIVATION_DELETE_ORDER) {
      expect(CLEAN_ACTIVATION_POLICY[tableName].disposition).not.toBe(
        "preserve",
      );
    }

    expect(CLEAN_ACTIVATION_POLICY.syncGate.disposition).toBe("preserve");
    expect(CLEAN_ACTIVATION_POLICY.operatorAuditEvents.disposition).toBe(
      "preserve",
    );
    expect(
      CLEAN_ACTIVATION_POLICY.seasonBootstrapStages.disposition,
    ).toBe("preserve");
    expect(
      CLEAN_ACTIVATION_POLICY.seasonBootstrapActivationRequests.disposition,
    ).toBe("preserve");

    expect(CLEAN_ACTIVATION_POLICY.participants.disposition).toBe("delete");
    expect(CLEAN_ACTIVATION_POLICY.pools.disposition).toBe("delete");
    expect(CLEAN_ACTIVATION_POLICY.nflTeams.disposition).toBe("rebuild");
    expect(CLEAN_ACTIVATION_POLICY.nflGames.disposition).toBe("rebuild");
    expect(CLEAN_ACTIVATION_POLICY.nflTeamAliases.disposition).toBe("rebuild");
    expect(CLEAN_ACTIVATION_POLICY.nflGameAliases.disposition).toBe("rebuild");
    expect(
      CLEAN_ACTIVATION_POLICY.nflGameScheduleHistory.disposition,
    ).toBe("rebuild");
    expect(
      CLEAN_ACTIVATION_POLICY.sportsDataStatusEvidence.disposition,
    ).toBe("delete");

    expect(CLEAN_ACTIVATION_PRESERVED_CATEGORIES).toEqual([
      "sync_gate",
      "production_operator_audit_history",
      "authentication_and_operator_environment_configuration",
      "checked_in_nfl_team_catalog",
      "season_bootstrap_staging_history",
    ]);
  });

  it("builds a bounded plan and fails closed above its transaction budget", () => {
    const counts = Object.fromEntries(
      Object.keys(CLEAN_ACTIVATION_POLICY).map((tableName) => [
        tableName,
        CLEAN_ACTIVATION_POLICY[
          tableName as keyof typeof CLEAN_ACTIVATION_POLICY
        ].disposition === "preserve"
          ? 7
          : 0,
      ]),
    ) as Record<keyof typeof CLEAN_ACTIVATION_POLICY, number>;
    counts.participants = 3;
    counts.pools = 2;
    counts.nflTeams = 32;

    expect(
      buildActivationPlan({
        currentCounts: counts,
        rebuiltCounts: {
          poolSeasons: 1,
          nflTeams: 32,
          nflGames: 272,
          nflTeamAliases: 32,
          nflGameAliases: 272,
          nflGameScheduleHistory: 272,
        },
      }),
    ).toMatchObject({
      totalDeleted: 37,
      totalRebuilt: 881,
      preservedCategories: CLEAN_ACTIVATION_PRESERVED_CATEGORIES,
      deletedCounts: {
        participants: 3,
        pools: 2,
        nflTeams: 32,
      },
    });

    counts.confidencePicks =
      CLEAN_ACTIVATION_LIMITS.maxDeletedRows + 1;
    expect(() =>
      buildActivationPlan({
        currentCounts: counts,
        rebuiltCounts: {
          poolSeasons: 1,
          nflTeams: 32,
          nflGames: 272,
          nflTeamAliases: 32,
          nflGameAliases: 272,
          nflGameScheduleHistory: 272,
        },
      }),
    ).toThrow(/transaction-safe deletion limit/i);
  });

  it("binds confirmation text to one explicit deployment, season, and stage", () => {
    const development = resolveCleanActivationDeployment({
      DEPLOYMENT_KIND: "development",
      CLEAN_ACTIVATION_DEPLOYMENT_ID: "only-pools-dev",
    });
    const production = resolveCleanActivationDeployment({
      DEPLOYMENT_KIND: "production",
      CLEAN_ACTIVATION_DEPLOYMENT_ID: "only-pools-prod",
    });

    expect(
      cleanActivationConfirmationText({
        deployment: development,
        seasonYear: 2026,
        stageId: "stage_1",
      }),
    ).toBe(
      "ACTIVATE CLEAN POOL SEASON 2026 FROM STAGE stage_1 ON development:only-pools-dev",
    );
    expect(
      cleanActivationConfirmationText({
        deployment: production,
        seasonYear: 2026,
        stageId: "stage_1",
      }),
    ).not.toBe(
      cleanActivationConfirmationText({
        deployment: development,
        seasonYear: 2026,
        stageId: "stage_1",
      }),
    );
    expect(() =>
      resolveCleanActivationDeployment({
        DEPLOYMENT_KIND: "preview",
      }),
    ).toThrow(/DEPLOYMENT_KIND/);
    expect(() =>
      resolveCleanActivationDeployment({
        DEPLOYMENT_KIND: "production",
      }),
    ).toThrow(/deployment identity/i);
  });
});
