/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { api, internal } from "./_generated/api";
import schema from "./schema";
import {
  completeSeasonBootstrapGames,
  completeSeasonBootstrapTeams,
  SEASON_BOOTSTRAP_FIXTURE_YEAR,
} from "./providers/sportsData/testing/seasonBootstrapFixture";
import { CANONICAL_NFL_TEAMS } from "./providers/sportsData/catalog";

const modules = import.meta.glob("./**/*.ts");
const seasonYear = SEASON_BOOTSTRAP_FIXTURE_YEAR;

function identity(subject: string) {
  return {
    subject,
    issuer: "https://auth.example.test",
    tokenIdentifier: `https://auth.example.test|${subject}`,
    name: subject,
    email: `${subject}@example.test`,
    emailVerified: true,
    phoneNumber: "+15551234567",
    phoneNumberVerified: true,
    sid: `session_${subject}`,
  };
}

async function persistValidStage(
  t: ReturnType<typeof convexTest>,
  stagedAtMs = Date.now(),
) {
  return await t.mutation(internal.bootstrap.persistSeasonBootstrapStage, {
    seasonYear,
    sourceProvider: "api-sports",
    teams: completeSeasonBootstrapTeams().map((team) => ({
      ...team,
      providerAliases: team.providerAliases.map((alias) => ({ ...alias })),
    })),
    games: completeSeasonBootstrapGames().map((game) => ({
      ...game,
      providerAliases: game.providerAliases.map((alias) => ({ ...alias })),
    })),
    actorTokenIdentifier: "https://auth.example.test|operator",
    actorClerkUserId: "operator",
    nowMs: stagedAtMs,
  });
}

async function establishSteppedUpOperator(
  t: ReturnType<typeof convexTest>,
) {
  const asOperator = t.withIdentity(identity("operator"));
  await asOperator.mutation(api.participants.ensureMyParticipant, {});
  await t.run(async (ctx) => {
    const participant = (await ctx.db.query("participants").take(10)).find(
      (row) => row.clerkUserId === "operator",
    );
    await ctx.db.patch(participant!._id, {
      operatorStepUpVerifiedAtMs: Date.now(),
      operatorStepUpSessionId: "session_operator",
    });
  });
  return asOperator;
}

async function seedOverrideAuditEpisode(
  t: ReturnType<typeof convexTest>,
  status: "active" | "released",
) {
  return await t.run(async (ctx) => {
    const seasonId = await ctx.db.insert("poolSeasons", {
      label: "2025",
      year: 2025,
      status: "available",
      usableStartWeek: 1,
      bootstrappedAtMs: 1,
    });
    const homeTeamId = await ctx.db.insert("nflTeams", {
      stableKey: "nfl-team:old-home",
      name: "Old Home",
      abbreviation: "OH",
      sportsDbTeamId: "old-home",
    });
    const awayTeamId = await ctx.db.insert("nflTeams", {
      stableKey: "nfl-team:old-away",
      name: "Old Away",
      abbreviation: "OA",
      sportsDbTeamId: "old-away",
    });
    const gameId = await ctx.db.insert("nflGames", {
      stableKey: "nfl:2025:w1:oa@oh",
      seasonId,
      seasonLabel: "2025",
      week: 1,
      homeTeamId,
      awayTeamId,
      scheduledKickoffMs: 1,
      lifecycle: "terminal",
      homeScore: 30,
      awayScore: 24,
      sportsDbEventId: "old-game",
      resultAuthority: "verified",
      verifiedResult: {
        homeScore: 30,
        awayScore: 24,
        status: "FT",
        verifiedAtMs: 2,
      },
    });
    const overrideId = await ctx.db.insert("nflGameResultOverrides", {
      ...(status === "active" ? { nflGameId: gameId } : {}),
      gameStableKey: "nfl:2025:w1:oa@oh",
      seasonLabel: "2025",
      gameWeek: 1,
      homeTeamAbbreviation: "OH",
      awayTeamAbbreviation: "OA",
      status,
      reason: "Permanent gamebook audit",
      replacedResult: {
        homeScore: 27,
        awayScore: 24,
        status: "FT",
        verifiedAtMs: 1,
      },
      overrideResult: {
        homeScore: 30,
        awayScore: 24,
        status: "FT",
        verifiedAtMs: 2,
      },
      actorTokenIdentifier: "https://auth.example.test|operator",
      actorClerkUserId: "operator",
      pinnedAtMs: 2,
      ...(status === "released"
        ? {
            releaseReason: "Provider recovered",
            releasedAtMs: 4,
            releasedByTokenIdentifier:
              "https://auth.example.test|operator",
            releasedByClerkUserId: "operator",
          }
        : {}),
    });
    await ctx.db.patch(gameId, {
      pinnedResultOverrideId:
        status === "active" ? overrideId : undefined,
    });
    const evidenceId = await ctx.db.insert(
      "nflGameResultReconciliationObservations",
      {
        nflGameId: gameId,
        pinnedOverrideId: overrideId,
        observedAtMs: 3,
        homeScore: 27,
        awayScore: 24,
        status: "FT",
        matchesVerified: false,
        disposition: "pinned_conflicting",
      },
    );
    const permanentEvidenceId = await ctx.db.insert(
      "nflGameResultOverrideEvidence",
      {
        overrideId,
        observedAtMs: 3,
        homeScore: 27,
        awayScore: 24,
        status: "FT",
        disposition: "pinned_conflicting",
        source: "api_sports_targeted",
      },
    );
    return {
      gameId,
      overrideId,
      evidenceId,
      permanentEvidenceId,
    };
  });
}

describe("audited clean Season Bootstrap activation", () => {
  const previousKind = process.env.DEPLOYMENT_KIND;
  const previousDeploymentId =
    process.env.CLEAN_ACTIVATION_DEPLOYMENT_ID;
  const previousOperator =
    process.env.PRODUCTION_OPERATOR_CLERK_USER_ID;

  beforeEach(() => {
    process.env.DEPLOYMENT_KIND = "development";
    process.env.CLEAN_ACTIVATION_DEPLOYMENT_ID =
      "only-pools-development";
    process.env.PRODUCTION_OPERATOR_CLERK_USER_ID = "operator";
  });

  afterEach(() => {
    if (previousKind === undefined) delete process.env.DEPLOYMENT_KIND;
    else process.env.DEPLOYMENT_KIND = previousKind;
    if (previousDeploymentId === undefined) {
      delete process.env.CLEAN_ACTIVATION_DEPLOYMENT_ID;
    } else {
      process.env.CLEAN_ACTIVATION_DEPLOYMENT_ID =
        previousDeploymentId;
    }
    if (previousOperator === undefined) {
      delete process.env.PRODUCTION_OPERATOR_CLERK_USER_ID;
    } else {
      process.env.PRODUCTION_OPERATOR_CLERK_USER_ID =
        previousOperator;
    }
  });

  it("requires a Production Operator and fresh step-up before issuing confirmation", async () => {
    const t = convexTest(schema, modules);
    const stage = await persistValidStage(t);

    const asParticipant = t.withIdentity(identity("participant"));
    await asParticipant.mutation(api.participants.ensureMyParticipant, {});
    await asParticipant.mutation(api.invites.confirmStepUp, {});
    await expect(
      asParticipant.mutation(
        api.bootstrap.requestCleanSeasonActivation,
        { stageId: stage.stageId, seasonYear },
      ),
    ).rejects.toThrow(/Production Operator required/);

    const asOperator = t.withIdentity(identity("operator"));
    await asOperator.mutation(api.participants.ensureMyParticipant, {});
    await expect(
      asOperator.mutation(
        api.bootstrap.requestCleanSeasonActivation,
        { stageId: stage.stageId, seasonYear },
      ),
    ).rejects.toThrow(/Step-up/i);

    await asOperator.mutation(api.invites.confirmStepUp, {});
    await expect(
      asOperator.mutation(
        api.bootstrap.requestCleanSeasonActivation,
        { stageId: stage.stageId, seasonYear },
      ),
    ).rejects.toThrow(/Step-up/i);
    await t.run(async (ctx) => {
      const participant = await ctx.db
        .query("participants")
        .withIndex("by_clerkUserId", (q) =>
          q.eq("clerkUserId", "operator"),
        )
        .unique();
      await ctx.db.patch(participant!._id, {
        operatorStepUpVerifiedAtMs: Date.now(),
        operatorStepUpSessionId: "session_operator",
      });
    });
    const request = await asOperator.mutation(
      api.bootstrap.requestCleanSeasonActivation,
      { stageId: stage.stageId, seasonYear },
    );
    expect(request.confirmationText).toContain(
      "development:only-pools-development",
    );
    expect(request.confirmationText).toContain(String(stage.stageId));
    expect(request.confirmationText).toContain(String(seasonYear));
  });

  it("refuses clean activation while an active pinned result exists, including after confirmation was requested", async () => {
    const t = convexTest(schema, modules);
    const stage = await persistValidStage(t);
    const asOperator = await establishSteppedUpOperator(t);
    const active = await seedOverrideAuditEpisode(t, "active");
    await expect(
      asOperator.mutation(
        api.bootstrap.requestCleanSeasonActivation,
        { stageId: stage.stageId, seasonYear },
      ),
    ).rejects.toThrow(/active pinned.*result|result.*active pin/i);

    await t.run(async (ctx) => {
      await ctx.db.patch(active.overrideId, {
        status: "released",
        releaseReason: "Prepare clean activation",
        releasedAtMs: Date.now(),
        releasedByTokenIdentifier:
          "https://auth.example.test|operator",
        releasedByClerkUserId: "operator",
      });
      await ctx.db.patch(active.gameId, {
        pinnedResultOverrideId: undefined,
      });
    });
    const request = await asOperator.mutation(
      api.bootstrap.requestCleanSeasonActivation,
      { stageId: stage.stageId, seasonYear },
    );
    await t.run(async (ctx) => {
      await ctx.db.patch(active.overrideId, {
        status: "active",
        releaseReason: undefined,
        releasedAtMs: undefined,
        releasedByTokenIdentifier: undefined,
        releasedByClerkUserId: undefined,
      });
      await ctx.db.patch(active.gameId, {
        pinnedResultOverrideId: active.overrideId,
      });
    });
    await expect(
      asOperator.mutation(
        api.bootstrap.activateCleanSeasonBootstrap,
        {
          requestId: request.requestId,
          confirmationText: request.confirmationText,
        },
      ),
    ).rejects.toThrow(/active pinned.*result|result.*active pin/i);
  });

  it("preserves released override identity and exact-episode evidence across clean activation", async () => {
    const t = convexTest(schema, modules);
    const stage = await persistValidStage(t);
    const asOperator = await establishSteppedUpOperator(t);
    const released = await seedOverrideAuditEpisode(t, "released");
    const unrelatedEvidenceId = await t.run(async (ctx) =>
      await ctx.db.insert("nflGameResultReconciliationObservations", {
        nflGameId: released.gameId,
        observedAtMs: 5,
        homeScore: 30,
        awayScore: 24,
        status: "FT",
        matchesVerified: true,
        disposition: "unchanged",
      }),
    );
    const request = await asOperator.mutation(
      api.bootstrap.requestCleanSeasonActivation,
      { stageId: stage.stageId, seasonYear },
    );
    await asOperator.mutation(
      api.bootstrap.activateCleanSeasonBootstrap,
      {
        requestId: request.requestId,
        confirmationText: request.confirmationText,
      },
    );
    const state = await t.run(async (ctx) => ({
      game: await ctx.db.get(released.gameId),
      override: await ctx.db.get(released.overrideId),
      evidence: await ctx.db.get(released.evidenceId),
      permanentEvidence: await ctx.db.get(
        released.permanentEvidenceId,
      ),
      unrelatedEvidence: await ctx.db.get(unrelatedEvidenceId),
    }));
    expect(state.game).toBeNull();
    expect(state.override).toMatchObject({
      status: "released",
      gameStableKey: "nfl:2025:w1:oa@oh",
      seasonLabel: "2025",
      gameWeek: 1,
      homeTeamAbbreviation: "OH",
      awayTeamAbbreviation: "OA",
      reason: "Permanent gamebook audit",
    });
    expect(state.override?.nflGameId).toBeUndefined();
    expect(state.override?.workflowCleanupId).toBeUndefined();
    expect(state.evidence).toBeNull();
    expect(state.unrelatedEvidence).toBeNull();
    expect(state.permanentEvidence).toMatchObject({
      overrideId: released.overrideId,
      observedAtMs: 3,
      disposition: "pinned_conflicting",
      homeScore: 27,
      awayScore: 24,
    });
    expect(state.permanentEvidence).not.toHaveProperty("nflGameId");
    expect(state.permanentEvidence).not.toHaveProperty(
      "pinnedOverrideId",
    );
    const history = await asOperator.query(
      api.resultOverrides.listOperatorResultOverrides,
      {
        status: "released",
        paginationOpts: { numItems: 10, cursor: null },
      },
    );
    expect(history.page).toContainEqual(
      expect.objectContaining({
        _id: released.overrideId,
        seasonLabel: "2025",
        week: 1,
        matchup: "OA at OH",
        latestConflicting: expect.objectContaining({
          observedAtMs: 3,
          homeScore: 27,
        }),
      }),
    );
  });

  it("retains every meaningful episode observation beyond 64 rows while deleting the bounded transient scope", async () => {
    const t = convexTest(schema, modules);
    const stage = await persistValidStage(t);
    const asOperator = await establishSteppedUpOperator(t);
    const released = await seedOverrideAuditEpisode(t, "released");
    await t.run(async (ctx) => {
      for (let index = 0; index < 64; index++) {
        const evidence = {
          nflGameId: released.gameId,
          pinnedOverrideId: released.overrideId,
          observedAtMs: 10 + index,
          homeScore: index % 2 === 0 ? 30 : 27,
          awayScore: 24,
          status: "FT",
          matchesVerified: index % 2 === 0,
          disposition:
            index % 2 === 0
              ? "pinned_matching"
              : "pinned_conflicting",
        } as const;
        await ctx.db.insert(
          "nflGameResultReconciliationObservations",
          evidence,
        );
        await ctx.db.insert("nflGameResultOverrideEvidence", {
          overrideId: released.overrideId,
          observedAtMs: evidence.observedAtMs,
          homeScore: evidence.homeScore,
          awayScore: evidence.awayScore,
          status: evidence.status,
          disposition: evidence.disposition,
          source: "api_sports_targeted",
        });
      }
    });
    const request = await asOperator.mutation(
      api.bootstrap.requestCleanSeasonActivation,
      { stageId: stage.stageId, seasonYear },
    );
    await asOperator.mutation(
      api.bootstrap.activateCleanSeasonBootstrap,
      {
        requestId: request.requestId,
        confirmationText: request.confirmationText,
      },
    );
    const retained = await t.run(async (ctx) => ({
      permanent: await ctx.db
        .query("nflGameResultOverrideEvidence")
        .collect(),
      transient: await ctx.db
        .query("nflGameResultReconciliationObservations")
        .collect(),
    }));
    expect(retained.permanent).toHaveLength(65);
    expect(retained.transient).toEqual([]);
  });

  it("replaces authorized domain data atomically and publishes an audited report", async () => {
    const t = convexTest(schema, modules);
    const stage = await persistValidStage(t);
    const asOperator = await establishSteppedUpOperator(t);
    await t.run(async (ctx) => {
      const stagedArizona = await ctx.db
        .query("seasonBootstrapStagedTeams")
        .withIndex("by_stageId_and_ordinal", (q) =>
          q.eq("stageId", stage.stageId).eq("ordinal", 0),
        )
        .unique();
      if (!stagedArizona) throw new Error("staged Arizona team missing");
      await ctx.db.patch(stagedArizona._id, {
        name: "Tampered Provider Name",
        logoUrl: "https://provider.invalid/tampered-artwork.png",
      });
    });

    const preservedGate = await t.run(async (ctx) => {
      return await ctx.db.insert("syncGate", {
        key: "deployment",
        enabled: false,
        updatedAtMs: 123,
        updatedByTokenIdentifier: "prior-operator",
      });
    });
    await t.run(async (ctx) => {
      const participant = await ctx.db
        .query("participants")
        .withIndex("by_clerkUserId", (q) =>
          q.eq("clerkUserId", "operator"),
        )
        .unique();
      const oldSeasonId = await ctx.db.insert("poolSeasons", {
        label: "2025",
        year: 2025,
        status: "available",
        usableStartWeek: 1,
        bootstrappedAtMs: 1,
      });
      const oldTeamId = await ctx.db.insert("nflTeams", {
        stableKey: "old-team",
        name: "Old Team",
        abbreviation: "OLD",
        sportsDbTeamId: "sports-db-old",
      });
      const oldGameId = await ctx.db.insert("nflGames", {
        stableKey: "old-game",
        seasonId: oldSeasonId,
        seasonLabel: "2025",
        week: 1,
        homeTeamId: oldTeamId,
        awayTeamId: oldTeamId,
        scheduledKickoffMs: 1,
        lifecycle: "scheduled",
        homeScore: null,
        awayScore: null,
        sportsDbEventId: "sports-db-old-game",
      });
      await ctx.db.insert("nflTeamAliases", {
        nflTeamId: oldTeamId,
        provider: "sports-db",
        externalId: "sports-db-old",
        isCurrent: true,
        firstObservedAtMs: 1,
        lastObservedAtMs: 1,
      });
      await ctx.db.insert("nflGameAliases", {
        nflGameId: oldGameId,
        provider: "sports-db",
        externalId: "sports-db-old-game",
        isCurrent: true,
        firstObservedAtMs: 1,
        lastObservedAtMs: 1,
      });
      await ctx.db.insert("nflGameScheduleHistory", {
        nflGameId: oldGameId,
        seasonId: oldSeasonId,
        week: 1,
        homeTeamId: oldTeamId,
        awayTeamId: oldTeamId,
        scheduledKickoffMs: 1,
        firstObservedAtMs: 1,
        lastObservedAtMs: 1,
      });
      if (!participant) throw new Error("operator participant missing");
      const poolId = await ctx.db.insert("pools", {
        name: "Old Pool",
        type: "survivor",
        seasonId: oldSeasonId,
        startWeek: 1,
        pickLockMode: "gameKickoff",
        status: "active",
        rulesFrozen: false,
        ownerParticipantId: participant._id,
        createdAtMs: 1,
      });
      await ctx.db.insert("poolMemberships", {
        poolId,
        participantId: participant._id,
        role: "owner",
        status: "active",
      });
    });

    const request = await asOperator.mutation(
      api.bootstrap.requestCleanSeasonActivation,
      { stageId: stage.stageId, seasonYear },
    );
    const activated = await asOperator.mutation(
      api.bootstrap.activateCleanSeasonBootstrap,
      {
        requestId: request.requestId,
        confirmationText: request.confirmationText,
      },
    );

    expect(activated).toMatchObject({
      seasonYear,
      status: "available",
      usableStartWeek: 1,
      deletedCounts: {
        participants: 1,
        poolSeasons: 1,
        nflTeams: 1,
        nflGames: 1,
        nflTeamAliases: 1,
        nflGameAliases: 1,
        nflGameScheduleHistory: 1,
        pools: 1,
        poolMemberships: 1,
      },
      rebuiltCounts: {
        poolSeasons: 1,
        nflTeams: 32,
        nflGames: 272,
        nflTeamAliases: 32,
        nflGameAliases: 272,
        nflGameScheduleHistory: 272,
      },
    });

    const database = await t.run(async (ctx) => ({
      participants: await ctx.db.query("participants").collect(),
      pools: await ctx.db.query("pools").collect(),
      seasons: await ctx.db.query("poolSeasons").collect(),
      teams: await ctx.db.query("nflTeams").collect(),
      games: await ctx.db.query("nflGames").collect(),
      teamAliases: await ctx.db.query("nflTeamAliases").collect(),
      gameAliases: await ctx.db.query("nflGameAliases").collect(),
      history: await ctx.db.query("nflGameScheduleHistory").collect(),
      gate: await ctx.db.get(preservedGate),
      stages: await ctx.db.query("seasonBootstrapStages").collect(),
      audits: await ctx.db.query("operatorAuditEvents").collect(),
    }));
    expect(database.participants).toEqual([]);
    expect(database.pools).toEqual([]);
    expect(database.seasons).toEqual([
      expect.objectContaining({
        label: String(seasonYear),
        year: seasonYear,
        status: "available",
        usableStartWeek: 1,
      }),
    ]);
    expect(database.teams).toHaveLength(32);
    expect(
      database.teams.find((team) => team.abbreviation === "ARI"),
    ).toMatchObject({
      stableKey: CANONICAL_NFL_TEAMS.ARI.stableKey,
      name: CANONICAL_NFL_TEAMS.ARI.name,
      logoUrl: CANONICAL_NFL_TEAMS.ARI.logoUrl,
    });
    expect(database.games).toHaveLength(272);
    expect(database.teamAliases).toHaveLength(32);
    expect(database.gameAliases).toHaveLength(272);
    expect(database.history).toHaveLength(272);
    expect(
      new Set(database.teams.map((team) => team.sportsDbTeamId)).size,
    ).toBe(32);
    expect(
      database.teams.every((team) =>
        team.sportsDbTeamId.startsWith(
          "legacy-unset:api-sports-team:",
        ),
      ),
    ).toBe(true);
    expect(
      new Set(database.games.map((game) => game.sportsDbEventId)).size,
    ).toBe(272);
    expect(
      database.games.every((game) =>
        game.sportsDbEventId.startsWith(
          "legacy-unset:api-sports-game:",
        ),
      ),
    ).toBe(true);
    expect(
      database.teamAliases.every(
        (alias) => alias.provider === "api-sports",
      ),
    ).toBe(true);
    expect(
      database.gameAliases.every(
        (alias) => alias.provider === "api-sports",
      ),
    ).toBe(true);
    expect(database.gate).toMatchObject({
      enabled: false,
      updatedAtMs: 123,
      updatedByTokenIdentifier: "prior-operator",
    });
    expect(database.stages).toHaveLength(1);
    expect(database.audits.map((audit) => audit.action)).toEqual(
      expect.arrayContaining([
        "season_bootstrap_staged",
        "season_bootstrap_activation_requested",
        "season_bootstrap_clean_activated",
      ]),
    );
    const legacySentinelLookups = await t.run(async (ctx) => {
      const teamSentinel = database.teams[0]!.sportsDbTeamId;
      const gameSentinel = database.games[0]!.sportsDbEventId;
      return {
        team: await ctx.db
          .query("nflTeams")
          .withIndex("by_sportsDbTeamId", (q) =>
            q.eq("sportsDbTeamId", teamSentinel),
          )
          .unique(),
        game: await ctx.db
          .query("nflGames")
          .withIndex("by_sportsDbEventId", (q) =>
            q.eq("sportsDbEventId", gameSentinel),
          )
          .unique(),
      };
    });
    expect(legacySentinelLookups.team?._id).toBe(database.teams[0]!._id);
    expect(legacySentinelLookups.game?._id).toBe(database.games[0]!._id);

    const report = await asOperator.query(
      api.bootstrap.getCleanSeasonActivationReport,
      { requestId: request.requestId },
    );
    expect(report).toMatchObject({
      status: "activated",
      stageId: stage.stageId,
      seasonYear,
      deployment: {
        kind: "development",
        id: "only-pools-development",
      },
      deletedCounts: activated.deletedCounts,
      rebuiltCounts: activated.rebuiltCounts,
      preservedCategories: expect.arrayContaining([
        "sync_gate",
        "production_operator_audit_history",
        "authentication_and_operator_environment_configuration",
        "checked_in_nfl_team_catalog",
      ]),
    });

    const asOperatorAgain = await establishSteppedUpOperator(t);
    await expect(
      asOperatorAgain.mutation(
        api.bootstrap.requestCleanSeasonActivation,
        { stageId: stage.stageId, seasonYear },
      ),
    ).rejects.toThrow(/already activated.*current deployment/i);
  });

  it("rejects a stale confirmation before deletion when a newer stage is invalid", async () => {
    const t = convexTest(schema, modules);
    const stage = await persistValidStage(t, Date.now() - 10);
    const asOperator = await establishSteppedUpOperator(t);
    const request = await asOperator.mutation(
      api.bootstrap.requestCleanSeasonActivation,
      { stageId: stage.stageId, seasonYear },
    );
    const sentinelSeasonId = await t.run(async (ctx) => {
      return await ctx.db.insert("poolSeasons", {
        label: "sentinel",
        year: 2025,
        status: "available",
        usableStartWeek: 1,
      });
    });

    const invalid = await t.mutation(
      internal.bootstrap.persistSeasonBootstrapStage,
      {
        seasonYear,
        sourceProvider: "api-sports",
        teams: [],
        games: [],
        actorTokenIdentifier:
          "https://auth.example.test|operator",
        actorClerkUserId: "operator",
        nowMs: Date.now() + 10,
      },
    );
    expect(invalid.report.activationEligible).toBe(false);

    await expect(
      asOperator.mutation(api.bootstrap.activateCleanSeasonBootstrap, {
        requestId: request.requestId,
        confirmationText: request.confirmationText,
      }),
    ).rejects.toThrow(/currently valid staged snapshot/i);
    expect(
      await t.run(async (ctx) => await ctx.db.get(sentinelSeasonId)),
    ).not.toBeNull();
    await expect(
      asOperator.mutation(
        api.bootstrap.requestCleanSeasonActivation,
        { stageId: invalid.stageId, seasonYear },
      ),
    ).rejects.toThrow(/currently valid staged snapshot/i);
  });

  it("requires distinct confirmations and activation audits in development and production", async () => {
    const t = convexTest(schema, modules);
    const stage = await persistValidStage(t);
    let asOperator = await establishSteppedUpOperator(t);

    const developmentRequest = await asOperator.mutation(
      api.bootstrap.requestCleanSeasonActivation,
      { stageId: stage.stageId, seasonYear },
    );
    await asOperator.mutation(api.bootstrap.activateCleanSeasonBootstrap, {
      requestId: developmentRequest.requestId,
      confirmationText: developmentRequest.confirmationText,
    });

    process.env.CLEAN_ACTIVATION_DEPLOYMENT_ID =
      "only-pools-development-2";
    asOperator = await establishSteppedUpOperator(t);
    const secondDevelopmentRequest = await asOperator.mutation(
      api.bootstrap.requestCleanSeasonActivation,
      { stageId: stage.stageId, seasonYear },
    );
    expect(secondDevelopmentRequest.confirmationText).not.toBe(
      developmentRequest.confirmationText,
    );
    await asOperator.mutation(api.bootstrap.activateCleanSeasonBootstrap, {
      requestId: secondDevelopmentRequest.requestId,
      confirmationText: secondDevelopmentRequest.confirmationText,
    });

    process.env.DEPLOYMENT_KIND = "production";
    process.env.CLEAN_ACTIVATION_DEPLOYMENT_ID =
      "only-pools-production";
    asOperator = await establishSteppedUpOperator(t);
    const productionRequest = await asOperator.mutation(
      api.bootstrap.requestCleanSeasonActivation,
      { stageId: stage.stageId, seasonYear },
    );
    expect(productionRequest.confirmationText).not.toBe(
      developmentRequest.confirmationText,
    );
    await asOperator.mutation(api.bootstrap.activateCleanSeasonBootstrap, {
      requestId: productionRequest.requestId,
      confirmationText: productionRequest.confirmationText,
    });

    const activationAudits = await t.run(async (ctx) => {
      const rows = await ctx.db.query("operatorAuditEvents").collect();
      return rows
        .filter(
          (row) => row.action === "season_bootstrap_clean_activated",
        )
        .map((row) => JSON.parse(row.detailsJson ?? "{}"));
    });
    expect(activationAudits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          deployment: {
            kind: "development",
            id: "only-pools-development",
          },
        }),
        expect.objectContaining({
          deployment: {
            kind: "development",
            id: "only-pools-development-2",
          },
        }),
        expect.objectContaining({
          deployment: {
            kind: "production",
            id: "only-pools-production",
          },
        }),
      ]),
    );
  });
});
