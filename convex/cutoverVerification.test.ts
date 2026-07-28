/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import schema from "./schema";
import {
  completeSeasonBootstrapGames,
  completeSeasonBootstrapTeams,
  SEASON_BOOTSTRAP_FIXTURE_YEAR,
} from "./providers/sportsData/testing/seasonBootstrapFixture";
import { CLEAN_ACTIVATION_POLICY } from "./lib/cleanActivationPolicy";

const modules = import.meta.glob("./**/*.ts");
const seasonYear = SEASON_BOOTSTRAP_FIXTURE_YEAR;
const nowMs = Date.UTC(2026, 8, 1);

function identity(subject: string) {
  return {
    subject,
    issuer: "https://auth.example.test",
    tokenIdentifier: `https://auth.example.test|${subject}`,
    name: subject,
    email: `${subject}@example.test`,
    emailVerified: true,
  };
}

async function seedVerifiedDevelopmentCutover(
  t: ReturnType<typeof convexTest>,
) {
  await t.run(async (ctx) => {
    const stageId = await ctx.db.insert("seasonBootstrapStages", {
      seasonYear,
      sourceProvider: "api-sports",
      invariantsVersion: "nfl-regular-season-v1",
      validationStatus: "valid",
      activationEligible: true,
      teamCount: 32,
      gameCount: 272,
      weekCount: 18,
      teamAliasCount: 32,
      gameAliasCount: 272,
      failureCount: 0,
      storedFailureCount: 0,
      failuresTruncated: false,
      actorTokenIdentifier: "https://auth.example.test|operator",
      actorClerkUserId: "operator",
      stagedAtMs: nowMs - 10_000,
    });
    const seasonId = await ctx.db.insert("poolSeasons", {
      label: String(seasonYear),
      year: seasonYear,
      status: "available",
      usableStartWeek: 1,
      bootstrappedAtMs: nowMs - 5_000,
    });
    const teamIds = new Map<string, Awaited<ReturnType<typeof ctx.db.insert>>>();
    for (const team of completeSeasonBootstrapTeams()) {
      const teamId = await ctx.db.insert("nflTeams", {
        stableKey: team.stableKey,
        name: team.name,
        abbreviation: team.abbreviation,
        logoUrl: team.logoUrl,
      });
      teamIds.set(team.stableKey, teamId);
      await ctx.db.insert("nflTeamAliases", {
        nflTeamId: teamId,
        provider: "api-sports",
        externalId: team.providerAliases[0]!.id,
        isCurrent: true,
        firstObservedAtMs: nowMs - 10_000,
        lastObservedAtMs: nowMs - 10_000,
      });
    }

    const games = completeSeasonBootstrapGames();
    let evidenceGameId: (typeof games)[number] | null = null;
    let firstGameId = null as Awaited<ReturnType<typeof ctx.db.insert>> | null;
    for (const game of games) {
      const homeTeam = completeSeasonBootstrapTeams().find(
        (team) => team.abbreviation === game.homeTeamAbbreviation,
      )!;
      const awayTeam = completeSeasonBootstrapTeams().find(
        (team) => team.abbreviation === game.awayTeamAbbreviation,
      )!;
      const homeTeamId = teamIds.get(homeTeam.stableKey)!;
      const awayTeamId = teamIds.get(awayTeam.stableKey)!;
      const gameId = await ctx.db.insert("nflGames", {
        stableKey: game.stableKey,
        seasonId,
        seasonLabel: String(seasonYear),
        week: game.week,
        homeTeamId,
        awayTeamId,
        scheduledKickoffMs: game.scheduledKickoffMs,
        lifecycle: game.lifecycle,
        homeScore: game.homeScore,
        awayScore: game.awayScore,
      });
      if (firstGameId === null) {
        firstGameId = gameId;
        evidenceGameId = game;
      }
      await ctx.db.insert("nflGameAliases", {
        nflGameId: gameId,
        provider: "api-sports",
        externalId: game.providerAliases[0]!.id,
        isCurrent: true,
        firstObservedAtMs: game.observedAtMs,
        lastObservedAtMs: game.observedAtMs,
      });
      await ctx.db.insert("nflGameScheduleHistory", {
        nflGameId: gameId,
        seasonId,
        week: game.week,
        homeTeamId,
        awayTeamId,
        scheduledKickoffMs: game.scheduledKickoffMs,
        firstObservedAtMs: game.observedAtMs,
        lastObservedAtMs: game.observedAtMs,
      });
    }

    const deletedCounts = Object.fromEntries(
      Object.entries(CLEAN_ACTIVATION_POLICY)
        .filter(([, policy]) => policy.disposition !== "preserve")
        .map(([tableName]) => [tableName, 0]),
    );
    const rebuiltCounts = {
      poolSeasons: 1,
      nflTeams: 32,
      nflGames: 272,
      nflTeamAliases: 32,
      nflGameAliases: 272,
      nflGameScheduleHistory: 272,
    };
    const requestId = await ctx.db.insert(
      "seasonBootstrapActivationRequests",
      {
        stageId,
        seasonYear,
        deploymentKind: "development",
        deploymentId: "only-pools-development",
        confirmationText: "confirmed",
        status: "activated",
        actorTokenIdentifier: "https://auth.example.test|operator",
        actorClerkUserId: "operator",
        requestedAtMs: nowMs - 6_000,
        expiresAtMs: nowMs + 60_000,
        activatedAtMs: nowMs - 5_000,
        deletedCountsJson: JSON.stringify(deletedCounts),
        rebuiltCountsJson: JSON.stringify(rebuiltCounts),
        preservedCategories: [
          "sync_gate",
          "production_operator_audit_history",
          "authentication_and_operator_environment_configuration",
          "checked_in_nfl_team_catalog",
          "season_bootstrap_staging_history",
          "provider_reliability_state",
          "provider_evidence_and_recent_diagnostics",
        ],
      },
    );
    for (const action of [
      "season_bootstrap_staged",
      "season_bootstrap_activation_requested",
      "season_bootstrap_clean_activated",
      "scoring_hold_created",
      "scoring_hold_resolved",
      "nfl_game_result_override_pinned",
      "nfl_game_result_override_released",
    ]) {
      const activationPlan =
        action === "season_bootstrap_activation_requested" ||
        action === "season_bootstrap_clean_activated"
          ? { deletedCounts, rebuiltCounts }
          : {};
      const workflowIdentity = action.startsWith("scoring_hold_")
        ? { holdId: "hold-1" }
        : action.startsWith("nfl_game_result_override_")
          ? { overrideId: "override-1" }
          : {};
      const atMs =
        action === "season_bootstrap_staged"
          ? nowMs - 10_000
          : action === "season_bootstrap_activation_requested"
            ? nowMs - 6_000
            : action === "season_bootstrap_clean_activated"
              ? nowMs - 5_000
              : nowMs;
      await ctx.db.insert("operatorAuditEvents", {
        action,
        actorTokenIdentifier: "https://auth.example.test|operator",
        actorClerkUserId: "operator",
        atMs,
        detailsJson: JSON.stringify({
          requestId,
          stageId,
          seasonId,
          gameId: firstGameId,
          ...activationPlan,
          ...workflowIdentity,
        }),
      });
    }
    await ctx.db.insert("syncGate", {
      key: "deployment",
      enabled: false,
      updatedAtMs: nowMs,
    });
    await ctx.db.insert("providerReliabilityState", {
      key: "api-sports",
      dailyWindowStartedAtMs: nowMs - 60_000,
      dailyResetAtMs: nowMs + 86_400_000,
      dailyUsed: 4,
      routineDailyUsed: 3,
      protectedDailyUsed: 1,
      minuteAdmissionTimestampsMs: [nowMs - 1_000],
      providerMinuteWindowStartedAtMs: nowMs - 60_000,
      providerMinuteResetAtMs: nowMs + 60_000,
      providerMinuteUsed: 1,
      headerInconsistencyCount: 0,
      staleHeaderCount: 0,
      circuitStatus: "closed",
      circuitGeneration: 0,
      consecutiveFailures: 0,
      lastAttemptAtMs: nowMs,
      lastSuccessAtMs: nowMs,
      deferredRoutineCount: 0,
      rejectedRequestCount: 0,
      circuitBlockedCount: 0,
      updatedAtMs: nowMs,
    });
    await ctx.db.insert("syncSurfaceHealth", {
      surface: "live",
      scopeKey: `season:${seasonYear}`,
      lastAttemptAtMs: nowMs,
      lastSuccessAtMs: nowMs,
      expectedNextRefreshAtMs: nowMs + 60_000,
      consecutiveFailures: 0,
      providerException: false,
      updatedAtMs: nowMs,
    });
    await ctx.db.insert("providerDiagnosticCleanupRuns", {
      key: "provider-diagnostics",
      generation: 1,
      cutoffMs: nowMs,
      status: "complete",
      deletedCount: 1,
      batchesCompleted: 1,
      startedAtMs: nowMs - 1_000,
      updatedAtMs: nowMs,
      completedAtMs: nowMs,
    });

    const game = evidenceGameId!;
    const scheduled = {
      scheduledKickoffMs: game.scheduledKickoffMs,
      kickoffLockReachedAtMs: null,
      lifecycle: "scheduled" as const,
      homeScore: null,
      awayScore: null,
      resultAuthority: "none",
      verifiedResult: null,
      correctionCandidate: null,
      pinned: false,
    };
    for (const [source, transitionKind, after] of [
      ["schedule", "kickoff", scheduled],
      ["live", "score", scheduled],
      [
        "live",
        "terminal",
        {
          ...scheduled,
          lifecycle: "terminal",
          homeScore: 24,
          awayScore: 17,
          resultAuthority: "verified",
          verifiedResult: {
            homeScore: 24,
            awayScore: 17,
            status: "FT",
            observedAtMs: nowMs,
          },
        },
      ],
      [
        "correction",
        "correction",
        {
          ...scheduled,
          lifecycle: "terminal",
          homeScore: 27,
          awayScore: 17,
          resultAuthority: "verified",
          verifiedResult: {
            homeScore: 27,
            awayScore: 17,
            status: "FT",
            observedAtMs: nowMs,
          },
        },
      ],
    ] as const) {
      await ctx.db.insert("providerGameEvidence", {
        nflGameId: firstGameId!,
        gameStableKey: game.stableKey,
        seasonLabel: String(seasonYear),
        gameWeek: game.week,
        homeTeamAbbreviation: game.homeTeamAbbreviation,
        awayTeamAbbreviation: game.awayTeamAbbreviation,
        provider: "api-sports",
        externalId: game.providerAliases[0]!.id,
        source,
        transitionKind,
        changedFields: [transitionKind],
        before: null,
        after,
        fingerprint: `${source}:${transitionKind}`,
        observedAtMs: nowMs,
        recordedAtMs: nowMs,
      });
    }
  });
}

describe("read-only API-Sports cutover verification", () => {
  const previous = {
    operator: process.env.PRODUCTION_OPERATOR_CLERK_USER_ID,
    provider: process.env.SPORTS_DATA_PROVIDER,
    key: process.env.API_SPORTS_KEY,
    kind: process.env.DEPLOYMENT_KIND,
    deploymentId: process.env.CLEAN_ACTIVATION_DEPLOYMENT_ID,
    sentry: process.env.SENTRY_INCIDENT_EMAIL_ENABLED,
  };

  beforeEach(() => {
    process.env.PRODUCTION_OPERATOR_CLERK_USER_ID = "operator";
    process.env.SPORTS_DATA_PROVIDER = "api-sports";
    process.env.API_SPORTS_KEY = "test-key-never-returned";
    process.env.DEPLOYMENT_KIND = "development";
    process.env.CLEAN_ACTIVATION_DEPLOYMENT_ID =
      "only-pools-development";
    process.env.SENTRY_INCIDENT_EMAIL_ENABLED = "true";
  });

  afterEach(() => {
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    restore("PRODUCTION_OPERATOR_CLERK_USER_ID", previous.operator);
    restore("SPORTS_DATA_PROVIDER", previous.provider);
    restore("API_SPORTS_KEY", previous.key);
    restore("DEPLOYMENT_KIND", previous.kind);
    restore(
      "CLEAN_ACTIVATION_DEPLOYMENT_ID",
      previous.deploymentId,
    );
    restore("SENTRY_INCIDENT_EMAIL_ENABLED", previous.sentry);
  });

  it("returns a machine-readable passing development report without secret values", async () => {
    const t = convexTest(schema, modules);
    await seedVerifiedDevelopmentCutover(t);

    const report = await t
      .withIdentity(identity("operator"))
      .query(
        api.cutoverVerification.getOperatorCutoverVerification,
        { seasonYear },
      );

    expect(report.status).toBe("pass");
    expect(report.developmentCutoverReady).toBe(true);
    expect(report.productionActivationAllowed).toBe(false);
    expect(report.dataset).toMatchObject({
      teams: 32,
      games: 272,
      weeks: Array.from({ length: 18 }, (_, index) => index + 1),
      teamAliases: 32,
      gameAliases: 272,
      scheduleHistoryRows: 272,
    });
    expect(report.checks.every((check) => check.status === "pass")).toBe(
      true,
    );
    expect(
      Object.values(report.smokeEvidence).every(
        (evidence) => evidence.observed,
      ),
    ).toBe(true);
    expect(JSON.stringify(report)).not.toContain("test-key-never-returned");
  });

  it("fails closed for an enabled gate, bad alias, and missing history", async () => {
    const t = convexTest(schema, modules);
    await seedVerifiedDevelopmentCutover(t);
    await t.run(async (ctx) => {
      const gate = await ctx.db
        .query("syncGate")
        .withIndex("by_key", (q) => q.eq("key", "deployment"))
        .unique();
      await ctx.db.patch(gate!._id, { enabled: true });
      const alias = (await ctx.db.query("nflGameAliases").first())!;
      await ctx.db.patch(alias._id, { provider: "legacy-provider" });
      const history = (await ctx.db
        .query("nflGameScheduleHistory")
        .first())!;
      await ctx.db.delete(history._id);
    });

    const report = await t
      .withIdentity(identity("operator"))
      .query(
        api.cutoverVerification.getOperatorCutoverVerification,
        { seasonYear },
      );

    expect(report.status).toBe("fail");
    expect(report.developmentCutoverReady).toBe(false);
    expect(report.incompatibleOperationalResidue).toBe(1);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "sync_gate_off", status: "fail" }),
        expect.objectContaining({
          id: "game_aliases_exact",
          status: "fail",
        }),
        expect.objectContaining({
          id: "schedule_history_exact",
          status: "fail",
        }),
        expect.objectContaining({
          id: "incompatible_operational_residue",
          status: "fail",
        }),
      ]),
    );
  });

  it("rejects an incomplete activation plan and unfinished smoke workflows", async () => {
    const t = convexTest(schema, modules);
    await seedVerifiedDevelopmentCutover(t);
    await t.run(async (ctx) => {
      const request = (await ctx.db
        .query("seasonBootstrapActivationRequests")
        .first())!;
      await ctx.db.patch(request._id, { deletedCountsJson: "{}" });
      const audits = await ctx.db.query("operatorAuditEvents").collect();
      for (const audit of audits) {
        if (
          audit.action === "scoring_hold_resolved" ||
          audit.action === "nfl_game_result_override_released"
        ) {
          await ctx.db.delete(audit._id);
        }
      }
      const evidence = await ctx.db.query("providerGameEvidence").collect();
      for (const row of evidence) {
        if (
          row.transitionKind === "terminal" ||
          row.transitionKind === "correction"
        ) {
          await ctx.db.patch(row._id, {
            after: {
              ...row.after,
              resultAuthority: "none",
              verifiedResult: null,
            },
          });
        }
      }
      const reliability = (await ctx.db
        .query("providerReliabilityState")
        .first())!;
      await ctx.db.patch(reliability._id, {
        lastSuccessAtMs: undefined,
      });
    });

    const report = await t
      .withIdentity(identity("operator"))
      .query(
        api.cutoverVerification.getOperatorCutoverVerification,
        { seasonYear },
      );

    expect(report.status).toBe("fail");
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "activation_plan_exact",
          status: "fail",
        }),
        expect.objectContaining({
          id: "post_activation_smoke_evidence",
          status: "fail",
        }),
      ]),
    );
    expect(report.smokeEvidence).toMatchObject({
      immediateResult: { observed: false },
      correction: { observed: false },
      scoringHold: { observed: false },
      pinnedOverride: { observed: false },
      quota: { observed: false },
    });
  });

  it("rejects mismatched and reversed multi-step smoke audit pairs", async () => {
    const t = convexTest(schema, modules);
    await seedVerifiedDevelopmentCutover(t);
    await t.run(async (ctx) => {
      const audits = await ctx.db.query("operatorAuditEvents").collect();
      for (const audit of audits) {
        const details = JSON.parse(audit.detailsJson ?? "{}") as Record<
          string,
          unknown
        >;
        if (audit.action === "scoring_hold_resolved") {
          await ctx.db.patch(audit._id, {
            detailsJson: JSON.stringify({
              ...details,
              holdId: "different-hold",
            }),
          });
        }
        if (audit.action === "nfl_game_result_override_released") {
          await ctx.db.patch(audit._id, { atMs: nowMs - 1 });
        }
      }
    });

    const report = await t
      .withIdentity(identity("operator"))
      .query(
        api.cutoverVerification.getOperatorCutoverVerification,
        { seasonYear },
      );

    expect(report.status).toBe("fail");
    expect(report.smokeEvidence.scoringHold.observed).toBe(false);
    expect(report.smokeEvidence.pinnedOverride.observed).toBe(false);
  });

  it("does not accept operator evidence for API-Sports provider smokes", async () => {
    const t = convexTest(schema, modules);
    await seedVerifiedDevelopmentCutover(t);
    await t.run(async (ctx) => {
      const evidence = await ctx.db.query("providerGameEvidence").collect();
      for (const row of evidence) {
        await ctx.db.patch(row._id, { provider: "operator" });
      }
    });

    const report = await t
      .withIdentity(identity("operator"))
      .query(
        api.cutoverVerification.getOperatorCutoverVerification,
        { seasonYear },
      );

    expect(report.status).toBe("fail");
    expect(report.incompatibleOperationalResidue).toBe(0);
    expect(report.smokeEvidence).toMatchObject({
      schedule: { observed: false },
      live: { observed: false },
      immediateResult: { observed: false },
      correction: { observed: false },
    });
  });

  it("requires pre-activation Production Operator audits to survive with their original timestamps", async () => {
    const t = convexTest(schema, modules);
    await seedVerifiedDevelopmentCutover(t);
    await t.run(async (ctx) => {
      const requestAudit = (
        await ctx.db.query("operatorAuditEvents").collect()
      ).find(
        (row) =>
          row.action === "season_bootstrap_activation_requested",
      );
      await ctx.db.patch(requestAudit!._id, { atMs: nowMs });
    });

    const report = await t
      .withIdentity(identity("operator"))
      .query(
        api.cutoverVerification.getOperatorCutoverVerification,
        { seasonYear },
      );

    expect(report.status).toBe("fail");
    expect(report.protectedState.preActivationAuditHistoryPreserved).toBe(
      false,
    );
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "protected_state_preserved",
          status: "fail",
        }),
      ]),
    );
  });

  it("fails closed when an operational residue scan exceeds its proof bound", async () => {
    const t = convexTest(schema, modules);
    await seedVerifiedDevelopmentCutover(t);
    await t.run(async (ctx) => {
      for (let index = 0; index < 101; index += 1) {
        await ctx.db.insert("sportsDataStatusEvidence", {
          provider: "api-sports",
          externalId: String(index),
          rawShort: "NS",
          rawLong: "Not Started",
          recognized: true,
          firstObservedAtMs: nowMs,
          lastObservedAtMs: nowMs,
          observationCount: 1,
        });
      }
    });

    const report = await t
      .withIdentity(identity("operator"))
      .query(
        api.cutoverVerification.getOperatorCutoverVerification,
        { seasonYear },
      );

    expect(report.incompatibleOperationalResidue).toBe(0);
    expect(report.status).toBe("fail");
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "incompatible_operational_residue",
          status: "fail",
        }),
      ]),
    );
    expect(
      report.inspectionBounds.sportsDataStatusEvidence.complete,
    ).toBe(false);
  });

  it("never marks a production deployment activation-ready", async () => {
    const t = convexTest(schema, modules);
    await seedVerifiedDevelopmentCutover(t);
    process.env.DEPLOYMENT_KIND = "production";
    process.env.CLEAN_ACTIVATION_DEPLOYMENT_ID =
      "only-pools-production";
    await t.run(async (ctx) => {
      const request = (await ctx.db
        .query("seasonBootstrapActivationRequests")
        .first())!;
      await ctx.db.patch(request._id, {
        deploymentKind: "production",
        deploymentId: "only-pools-production",
      });
    });

    const report = await t
      .withIdentity(identity("operator"))
      .query(
        api.cutoverVerification.getOperatorCutoverVerification,
        { seasonYear },
      );

    expect(report.deployment.kind).toBe("production");
    expect(report.status).toBe("fail");
    expect(report.developmentCutoverReady).toBe(false);
    expect(report.productionActivationAllowed).toBe(false);
    expect(report.productionBlock).toMatch(/preseason qualification/i);
  });

  it("requires the allowlisted Production Operator", async () => {
    const t = convexTest(schema, modules);
    await seedVerifiedDevelopmentCutover(t);

    await expect(
      t
        .withIdentity(identity("participant"))
        .query(
          api.cutoverVerification.getOperatorCutoverVerification,
          { seasonYear },
        ),
    ).rejects.toThrow(/Production Operator required/);
  });
});
