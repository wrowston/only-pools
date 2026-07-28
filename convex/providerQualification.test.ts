/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const NOW_MS = Date.UTC(2026, 8, 14, 20);

function rejectedCandidateEvidence(
  overrides: Partial<{
    actualExternalId: string | null;
    actualSeasonYear: number;
    actualScheduledKickoffMs: number;
    actualSeasonPhase:
      | "preseason"
      | "regular_season"
      | "postseason"
      | "unknown";
    actualProviderStage: string;
    actualHomeTeamAbbreviation: "DEN" | "KC";
    actualAwayTeamAbbreviation: "DEN" | "KC";
    actualHomeScore: number | null;
    actualAwayScore: number | null;
    actualStatus: string;
    providerObservedAtMs: number;
  }> = {},
) {
  return {
    actualExternalId: "fixture-wrong" as string | null,
    actualSeasonYear: 2026,
    actualScheduledKickoffMs: NOW_MS,
    actualSeasonPhase: "preseason" as const,
    actualProviderStage: "Pre Season",
    actualHomeTeamAbbreviation: "DEN" as const,
    actualAwayTeamAbbreviation: "KC" as const,
    actualHomeScore: 7 as number | null,
    actualAwayScore: 3 as number | null,
    actualStatus: "FT",
    providerObservedAtMs: NOW_MS + 10_000,
    ...overrides,
  };
}

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

async function seedSeason(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const seasonId = await ctx.db.insert("poolSeasons", {
      label: "2026",
      year: 2026,
      status: "available",
      usableStartWeek: 1,
      bootstrappedAtMs: NOW_MS - 1_000,
    });
    const homeTeamId = await ctx.db.insert("nflTeams", {
      stableKey: "nfl-team:den",
      name: "Denver",
      abbreviation: "DEN",
      sportsDbTeamId: "den",
    });
    const awayTeamId = await ctx.db.insert("nflTeams", {
      stableKey: "nfl-team:kc",
      name: "Kansas City",
      abbreviation: "KC",
      sportsDbTeamId: "kc",
    });
    const gameId = await ctx.db.insert("nflGames", {
      stableKey: "nfl:2026:w1:kc@den",
      seasonId,
      seasonLabel: "2026",
      week: 1,
      homeTeamId,
      awayTeamId,
      scheduledKickoffMs: NOW_MS,
      lifecycle: "in_progress",
      homeScore: 0,
      awayScore: 0,
      sportsDbEventId: "legacy-1",
      resultAuthority: "projected",
    });
    await ctx.db.insert("nflGameAliases", {
      nflGameId: gameId,
      provider: "api-sports",
      externalId: "fixture-1",
      isCurrent: true,
      firstObservedAtMs: NOW_MS,
      lastObservedAtMs: NOW_MS,
    });
    return { seasonId, gameId };
  });
}

async function establishOperator(t: ReturnType<typeof convexTest>) {
  const operator = t.withIdentity(identity("operator"));
  await operator.mutation(api.participants.ensureMyParticipant, {});
  await t.run(async (ctx) => {
    const participant = (await ctx.db.query("participants").collect()).find(
      (row) => row.clerkUserId === "operator",
    );
    await ctx.db.patch(participant!._id, {
      operatorStepUpVerifiedAtMs: NOW_MS,
      operatorStepUpSessionId: "session_operator",
    });
  });
  return operator;
}

async function createRunWithReference(
  t: ReturnType<typeof convexTest>,
  operator: Awaited<ReturnType<typeof establishOperator>>,
  seasonId: Id<"poolSeasons">,
) {
  const created = await operator.mutation(
    api.providerQualification.createQualificationRun,
    { provider: "api-sports", seasonId },
  );
  const registered = await operator.mutation(
    api.providerQualification.registerQualificationGame,
    {
      runId: created.runId,
      homeTeamAbbreviation: "DEN",
      awayTeamAbbreviation: "KC",
      scheduledKickoffMs: NOW_MS,
      apiSportsExternalId: "fixture-1",
    },
  );
  const reference = await operator.mutation(
    api.providerQualification.recordReferenceEvent,
    {
      runId: created.runId,
      gameKey: registered.gameKey,
      kind: "final",
      source: "official_nfl_view",
      clientNonce: `nonce-${String(created.runId)}`,
      homeTeamAbbreviation: "DEN",
      awayTeamAbbreviation: "KC",
      homeScore: 7,
      awayScore: 3,
      status: "FT",
    },
  );
  return {
    runId: created.runId,
    gameKey: registered.gameKey,
    eventSequence: reference.eventSequence,
  };
}

async function passAndEnable(
  t: ReturnType<typeof convexTest>,
  operator: Awaited<ReturnType<typeof establishOperator>>,
  seasonId: Id<"poolSeasons">,
) {
  const run = await createRunWithReference(t, operator, seasonId);
  vi.setSystemTime(NOW_MS + 45_000);
  await t.mutation(
    internal.providerQualification.recordQualificationProviderEvent,
    {
      runId: run.runId,
      gameKey: run.gameKey,
      externalId: "fixture-1",
      homeTeamAbbreviation: "DEN",
      awayTeamAbbreviation: "KC",
      homeScore: 7,
      awayScore: 3,
      status: "FT",
      providerIngestedAtMs: NOW_MS + 30_000,
    },
  );
  await operator.mutation(
    api.providerQualification.finalizeQualificationRun,
    {
      runId: run.runId,
      explanation: "Independent registered window passed.",
      allObservedEventsRecorded: true,
      confirmationText:
        "I recorded every observed scoring change and final.",
    },
  );
  await operator.mutation(
    api.providerQualification.setProductionCompetitiveSyncEnabled,
    { enabled: true, seasonId, provider: "api-sports" },
  );
  return run;
}

describe("API-Sports production qualification", () => {
  const previousOperator =
    process.env.PRODUCTION_OPERATOR_CLERK_USER_ID;
  const previousKind = process.env.DEPLOYMENT_KIND;
  const previousProvider = process.env.SPORTS_DATA_PROVIDER;
  const previousApiSportsKey = process.env.API_SPORTS_KEY;

  beforeEach(() => {
    process.env.PRODUCTION_OPERATOR_CLERK_USER_ID = "operator";
    process.env.DEPLOYMENT_KIND = "production";
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    if (previousOperator === undefined) {
      delete process.env.PRODUCTION_OPERATOR_CLERK_USER_ID;
    } else {
      process.env.PRODUCTION_OPERATOR_CLERK_USER_ID = previousOperator;
    }
    if (previousKind === undefined) {
      delete process.env.DEPLOYMENT_KIND;
    } else {
      process.env.DEPLOYMENT_KIND = previousKind;
    }
    if (previousProvider === undefined) {
      delete process.env.SPORTS_DATA_PROVIDER;
    } else {
      process.env.SPORTS_DATA_PROVIDER = previousProvider;
    }
    if (previousApiSportsKey === undefined) {
      delete process.env.API_SPORTS_KEY;
    } else {
      process.env.API_SPORTS_KEY = previousApiSportsKey;
    }
  });

  it.each([
    ["absent", null],
    ["blank", "   "],
    ["unknown", "staging"],
  ])(
    "fails closed before provider/apply/legacy work when DEPLOYMENT_KIND is %s",
    async (_label, value) => {
      if (value === null) delete process.env.DEPLOYMENT_KIND;
      else process.env.DEPLOYMENT_KIND = value;
      const t = convexTest(schema, modules);
      const { seasonId } = await seedSeason(t);
      const operator = await establishOperator(t);
      await expect(
        operator.mutation(
          api.providerQualification.setProductionCompetitiveSyncEnabled,
          { enabled: true, seasonId, provider: "api-sports" },
        ),
      ).rejects.toThrow(/deployment kind/i);
      await expect(
        t.mutation(
          internal.providerQualification.authorizeProductionProviderRequest,
          { intent: "competitive", expectedSeasonId: seasonId },
        ),
      ).resolves.toMatchObject({
        allowed: false,
        reason: "deployment_not_allowed",
      });
      await expect(
        t.mutation(
          internal.syncSchedule.applyScheduleGameObservation,
          {
            seasonId,
            observation: {
              seasonYear: 2026,
              week: 1,
              homeTeamAbbreviation: "DEN",
              awayTeamAbbreviation: "KC",
              scheduledKickoffMs: NOW_MS,
              lifecycle: "scheduled",
              observedAtMs: NOW_MS,
              providerAlias: {
                provider: "api-sports",
                id: "fixture-1",
              },
              providerStatus: {
                rawShort: "NS",
                rawLong: "Not Started",
                recognized: true,
              },
            },
          },
        ),
      ).rejects.toThrow(/qualification fence/i);
      const workItemId = await t.run(
        async (ctx) =>
          await ctx.db.insert("syncWorkItems", {
            surface: "live",
            scopeKey: `legacy:${String(value)}`,
            priority: "routine",
            status: "claimed",
            dueAtMs: NOW_MS,
            attemptCount: 1,
            claimedAtMs: NOW_MS,
            leaseExpiresAtMs: NOW_MS + 60_000,
          }),
      );
      await expect(
        t.action(internal.syncLive.runClaimedFetch, {
          workItemId,
          surface: "live",
        }),
      ).resolves.toMatchObject({
        ok: false,
        reason: "deployment_not_allowed",
      });
      process.env.DEPLOYMENT_KIND = "production";
    },
  );

  it.each(["development", "dev"])(
    "allows the explicit %s development bypass",
    async (kind) => {
      process.env.DEPLOYMENT_KIND = kind;
      const t = convexTest(schema, modules);
      const { seasonId } = await seedSeason(t);
      const operator = await establishOperator(t);

      await expect(
        operator.mutation(
          api.providerQualification.setProductionCompetitiveSyncEnabled,
          { enabled: true, seasonId, provider: "api-sports" },
        ),
      ).resolves.toMatchObject({ enabled: true });
      await expect(
        t.mutation(
          internal.providerQualification.authorizeProductionProviderRequest,
          { intent: "competitive", expectedSeasonId: seasonId },
        ),
      ).resolves.toMatchObject({ allowed: true, fence: null });
      process.env.DEPLOYMENT_KIND = "production";
    },
  );

  it("allows only the Production Operator with fresh step-up to create a selected-season run", async () => {
    const t = convexTest(schema, modules);
    const { seasonId } = await seedSeason(t);
    const participant = t.withIdentity(identity("participant"));
    await participant.mutation(api.participants.ensureMyParticipant, {});

    await expect(
      t.mutation(api.providerQualification.createQualificationRun, {
        provider: "api-sports",
        seasonId,
      }),
    ).rejects.toThrow(/Unauthenticated/i);
    await expect(
      participant.mutation(
        api.providerQualification.createQualificationRun,
        { provider: "api-sports", seasonId },
      ),
    ).rejects.toThrow(/Production Operator/i);

    const operator = t.withIdentity(identity("operator"));
    await operator.mutation(api.participants.ensureMyParticipant, {});
    await expect(
      operator.mutation(
        api.providerQualification.createQualificationRun,
        { provider: "api-sports", seasonId },
      ),
    ).rejects.toThrow(/Step-up/i);

    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("participants")
        .withIndex("by_clerkUserId", (q) =>
          q.eq("clerkUserId", "operator"),
        )
        .unique();
      await ctx.db.patch(row!._id, {
        operatorStepUpVerifiedAtMs: NOW_MS,
        operatorStepUpSessionId: "session_operator",
      });
    });
    await expect(
      operator.mutation(
        api.providerQualification.createQualificationRun,
        { provider: "api-sports", seasonId },
      ),
    ).resolves.toMatchObject({ status: "collecting" });
  });

  it("links each independent reference event to ingestion and visible-application evidence and audits a passing decision", async () => {
    const t = convexTest(schema, modules);
    const { seasonId, gameId } = await seedSeason(t);
    const operator = await establishOperator(t);
    const { runId, gameKey, eventSequence } =
      await createRunWithReference(
      t,
      operator,
      seasonId,
    );

    vi.setSystemTime(NOW_MS + 45_000);
    await t.mutation(
      internal.providerQualification.recordQualificationProviderEvent,
      {
        runId,
        gameKey,
        externalId: "fixture-1",
        homeTeamAbbreviation: "DEN",
        awayTeamAbbreviation: "KC",
        homeScore: 7,
        awayScore: 3,
        status: "FT",
        providerIngestedAtMs: NOW_MS + 30_000,
      },
    );
    const report = await operator.mutation(
      api.providerQualification.finalizeQualificationRun,
      {
        runId,
        explanation: "Independent scoreboard matched.",
        allObservedEventsRecorded: true,
        confirmationText:
          "I recorded every observed scoring change and final.",
      },
    );
    expect(report).toMatchObject({
      status: "passed",
      observedEvents: 1,
      correctnessErrors: 0,
      freshnessBreaches: 0,
      maxIngestionDelayMs: 30_000,
      maxApplicationDelayMs: 45_000,
    });

    const [operatorReport, audits, competitiveGame] = await Promise.all([
      operator.query(
        api.providerQualification.getOperatorQualificationRun,
        { runId },
      ),
      t.run(async (ctx) =>
        await ctx.db
        .query("operatorAuditEvents")
        .withIndex("by_atMs")
        .order("desc")
        .take(10),
      ),
      t.run(async (ctx) => await ctx.db.get(gameId)),
    ]);
    const evidence = operatorReport?.references.find(
      (event) => event.sequence === eventSequence,
    );
    expect(evidence).toMatchObject({
      providerIngestedAtMs: NOW_MS + 30_000,
      visibleAppliedAtMs: NOW_MS + 45_000,
      ingestionDelayMs: 30_000,
      applicationDelayMs: 45_000,
      outcome: "matched",
    });
    expect(competitiveGame).toMatchObject({
      homeScore: 0,
      awayScore: 0,
      resultAuthority: "projected",
    });
    expect(audits.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        "provider_qualification_created",
        "provider_qualification_reference_recorded",
        "provider_qualification_provider_event_recorded",
        "provider_qualification_passed",
      ]),
    );
    const referenceAudit = audits.find(
      (row) => row.action === "provider_qualification_reference_recorded",
    );
    const providerAudit = audits.find(
      (row) =>
        row.action === "provider_qualification_provider_event_recorded",
    );
    expect(JSON.parse(referenceAudit!.detailsJson!)).toMatchObject({
      runId,
      gameKey,
      eventSequence,
      referenceAtMs: NOW_MS,
      homeTeamAbbreviation: "DEN",
      awayTeamAbbreviation: "KC",
      homeScore: 7,
      awayScore: 3,
      status: "FT",
    });
    expect(JSON.parse(providerAudit!.detailsJson!)).toMatchObject({
      runId,
      gameKey,
      externalId: "fixture-1",
      providerIngestedAtMs: NOW_MS + 30_000,
      visibleAppliedAtMs: NOW_MS + 45_000,
      homeTeamAbbreviation: "DEN",
      awayTeamAbbreviation: "KC",
      homeScore: 7,
      awayScore: 3,
      status: "FT",
    });
  });

  it("durably fails a rejected candidate even after a later valid provider poll", async () => {
    const t = convexTest(schema, modules);
    const { seasonId } = await seedSeason(t);
    const operator = await establishOperator(t);
    const run = await createRunWithReference(t, operator, seasonId);

    await t.mutation(
      internal.providerQualification.recordQualificationPollRejection,
      {
        runId: run.runId,
        gameKey: run.gameKey,
        reason: "home_away_reversal",
        evidence: rejectedCandidateEvidence({
          actualHomeTeamAbbreviation: "KC",
          actualAwayTeamAbbreviation: "DEN",
        }),
      },
    );
    await expect(
      operator.mutation(
        api.providerQualification.registerQualificationGame,
        {
          runId: run.runId,
          homeTeamAbbreviation: "DEN",
          awayTeamAbbreviation: "KC",
          scheduledKickoffMs: NOW_MS + 60_000,
          apiSportsExternalId: "fixture-2",
        },
      ),
    ).rejects.toThrow(/window is locked/i);
    await expect(
      operator.mutation(
        api.providerQualification.bindQualificationGameProviderCandidate,
        {
          runId: run.runId,
          gameKey: run.gameKey,
          apiSportsExternalId: "fixture-1",
        },
      ),
    ).rejects.toThrow(/window is locked/i);
    vi.setSystemTime(NOW_MS + 30_000);
    await t.mutation(
      internal.providerQualification.recordQualificationProviderEvent,
      {
        runId: run.runId,
        gameKey: run.gameKey,
        externalId: "fixture-1",
        homeTeamAbbreviation: "DEN",
        awayTeamAbbreviation: "KC",
        homeScore: 7,
        awayScore: 3,
        status: "FT",
        providerIngestedAtMs: NOW_MS + 20_000,
      },
    );

    const report = await operator.mutation(
      api.providerQualification.finalizeQualificationRun,
      {
        runId: run.runId,
        explanation: "Rejected provider candidate remained part of the window.",
        allObservedEventsRecorded: true,
        confirmationText:
          "I recorded every observed scoring change and final.",
      },
    );
    expect(report).toMatchObject({
      status: "failed",
      correctnessErrors: 1,
      homeAwayReversals: 1,
    });
    const details = await operator.query(
      api.providerQualification.getOperatorQualificationRun,
      { runId: run.runId },
    );
    expect(details?.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "home_away_reversal",
          gameOrdinal: 1,
        }),
      ]),
    );
    const rejectionAudit = await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("operatorAuditEvents")
        .withIndex("by_atMs")
        .order("desc")
        .take(20);
      return rows.find(
        (row) => row.action === "provider_qualification_poll_rejected",
      );
    });
    expect(JSON.parse(rejectionAudit!.detailsJson!)).toMatchObject({
      runId: run.runId,
      gameKey: run.gameKey,
      reason: "home_away_reversal",
      actualExternalId: "fixture-wrong",
      actualSeasonYear: 2026,
      actualScheduledKickoffMs: NOW_MS,
      actualSeasonPhase: "preseason",
      actualProviderStage: "Pre Season",
      actualHomeTeamAbbreviation: "KC",
      actualAwayTeamAbbreviation: "DEN",
      actualHomeScore: 7,
      actualAwayScore: 3,
      actualStatus: "FT",
      providerObservedAtMs: NOW_MS + 10_000,
    });
  });

  it.each([
    ["external_id_mismatch", 1],
    ["season_year_mismatch", 1],
    ["kickoff_mismatch", 1],
    ["identity_mismatch", 1],
    ["phase_mismatch", 0],
  ] as const)(
    "keeps sticky %s counters exact after later valid evidence",
    async (reason, expectedIdentityMismatches) => {
      const t = convexTest(schema, modules);
      const { seasonId } = await seedSeason(t);
      const operator = await establishOperator(t);
      const run = await createRunWithReference(t, operator, seasonId);
      await t.mutation(
        internal.providerQualification.recordQualificationPollRejection,
        {
          runId: run.runId,
          gameKey: run.gameKey,
          reason,
          evidence: rejectedCandidateEvidence(),
        },
      );
      vi.setSystemTime(NOW_MS + 30_000);
      await t.mutation(
        internal.providerQualification.recordQualificationProviderEvent,
        {
          runId: run.runId,
          gameKey: run.gameKey,
          externalId: "fixture-1",
          homeTeamAbbreviation: "DEN",
          awayTeamAbbreviation: "KC",
          homeScore: 7,
          awayScore: 3,
          status: "FT",
          providerIngestedAtMs: NOW_MS + 20_000,
        },
      );
      await expect(
        operator.mutation(
          api.providerQualification.finalizeQualificationRun,
          {
            runId: run.runId,
            explanation: "Sticky candidate rejection was counted.",
            allObservedEventsRecorded: true,
            confirmationText:
              "I recorded every observed scoring change and final.",
          },
        ),
      ).resolves.toMatchObject({
        status: "failed",
        correctnessErrors: 1,
        identityMismatches: expectedIdentityMismatches,
        homeAwayReversals: 0,
      });
    },
  );

  it("captures references without Step-up, requires attestation and fresh Step-up for decisions, and redacts actor identifiers", async () => {
    const t = convexTest(schema, modules);
    const { seasonId } = await seedSeason(t);
    const operator = await establishOperator(t);
    const created = await operator.mutation(
      api.providerQualification.createQualificationRun,
      { provider: "api-sports", seasonId },
    );
    const registered = await operator.mutation(
      api.providerQualification.registerQualificationGame,
      {
        runId: created.runId,
        homeTeamAbbreviation: "DEN",
        awayTeamAbbreviation: "KC",
        scheduledKickoffMs: NOW_MS,
        apiSportsExternalId: "fixture-1",
      },
    );
    await t.run(async (ctx) => {
      const participant = await ctx.db
        .query("participants")
        .withIndex("by_clerkUserId", (q) =>
          q.eq("clerkUserId", "operator"),
        )
        .unique();
      await ctx.db.patch(participant!._id, {
        operatorStepUpVerifiedAtMs: NOW_MS - 60 * 60_000,
      });
    });
    await expect(
      operator.mutation(
        api.providerQualification.recordReferenceEvent,
        {
          runId: created.runId,
          gameKey: registered.gameKey,
          kind: "final",
          source: "official_nfl_view",
          clientNonce: "capture-without-stepup",
          homeTeamAbbreviation: "DEN",
          awayTeamAbbreviation: "KC",
          homeScore: 7,
          awayScore: 3,
          status: "FT",
        },
      ),
    ).resolves.toMatchObject({ replayed: false });
    await expect(
      operator.mutation(
        api.providerQualification.finalizeQualificationRun,
        {
          runId: created.runId,
          explanation: "Coverage was independently recorded.",
          allObservedEventsRecorded: true,
          confirmationText:
            "I recorded every observed scoring change and final.",
        },
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
        operatorStepUpVerifiedAtMs: NOW_MS,
      });
    });
    await expect(
      operator.mutation(
        api.providerQualification.finalizeQualificationRun,
        {
          runId: created.runId,
          explanation: "Coverage was independently recorded.",
          allObservedEventsRecorded: false,
          confirmationText: "",
        },
      ),
    ).rejects.toThrow(/attestation/i);

    const [rawRun, operatorReport] = await Promise.all([
      t.run(async (ctx) => await ctx.db.get(created.runId)),
      operator.query(
        api.providerQualification.getOperatorQualificationRun,
        { runId: created.runId },
      ),
    ]);
    expect(rawRun?.detailsJson).not.toContain("session_operator");
    expect(rawRun?.detailsJson).not.toContain(
      "https://auth.example.test|operator",
    );
    expect(JSON.stringify(operatorReport)).not.toContain(
      "https://auth.example.test|operator",
    );
  });

  it("locks the declared game window after evidence starts and keeps missing-final separate from missing-game", async () => {
    const t = convexTest(schema, modules);
    const { seasonId } = await seedSeason(t);
    const operator = await establishOperator(t);
    const created = await operator.mutation(
      api.providerQualification.createQualificationRun,
      { provider: "api-sports", seasonId },
    );
    const game = await operator.mutation(
      api.providerQualification.registerQualificationGame,
      {
        runId: created.runId,
        homeTeamAbbreviation: "DEN",
        awayTeamAbbreviation: "KC",
        scheduledKickoffMs: NOW_MS,
        apiSportsExternalId: "fixture-1",
      },
    );
    await operator.mutation(
      api.providerQualification.recordReferenceEvent,
      {
        runId: created.runId,
        gameKey: game.gameKey,
        kind: "score",
        source: "official_nfl_view",
        clientNonce: "score-reference-window-lock",
        homeTeamAbbreviation: "DEN",
        awayTeamAbbreviation: "KC",
        homeScore: 7,
        awayScore: 3,
      },
    );
    await expect(
      operator.mutation(
        api.providerQualification.registerQualificationGame,
        {
          runId: created.runId,
          homeTeamAbbreviation: "BUF",
          awayTeamAbbreviation: "MIA",
          scheduledKickoffMs: NOW_MS + 60_000,
          apiSportsExternalId: "fixture-2",
        },
      ),
    ).rejects.toThrow(/window is locked/i);
    await expect(
      operator.mutation(
        api.providerQualification.bindQualificationGameProviderCandidate,
        {
          runId: created.runId,
          gameKey: game.gameKey,
          apiSportsExternalId: "fixture-1",
        },
      ),
    ).rejects.toThrow(/window is locked/i);
    vi.setSystemTime(NOW_MS + 30_000);
    await t.mutation(
      internal.providerQualification.recordQualificationProviderEvent,
      {
        runId: created.runId,
        gameKey: game.gameKey,
        externalId: "fixture-1",
        homeTeamAbbreviation: "DEN",
        awayTeamAbbreviation: "KC",
        homeScore: 7,
        awayScore: 3,
        providerIngestedAtMs: NOW_MS + 20_000,
      },
    );
    const report = await operator.mutation(
      api.providerQualification.finalizeQualificationRun,
      {
        runId: created.runId,
        explanation: "Final reference was not declared.",
        allObservedEventsRecorded: true,
        confirmationText:
          "I recorded every observed scoring change and final.",
      },
    );
    expect(report).toMatchObject({
      status: "failed",
      missingGames: 0,
      scoreErrors: 0,
      finalStatusErrors: 0,
    });
    const details = await operator.query(
      api.providerQualification.getOperatorQualificationRun,
      { runId: created.runId },
    );
    expect(details?.findings).toEqual([
      expect.objectContaining({ code: "missing_final_reference" }),
    ]);
  });

  it("reports final-status-only failures without inflating score errors", async () => {
    const t = convexTest(schema, modules);
    const { seasonId } = await seedSeason(t);
    const operator = await establishOperator(t);
    const run = await createRunWithReference(t, operator, seasonId);
    vi.setSystemTime(NOW_MS + 30_000);
    await t.mutation(
      internal.providerQualification.recordQualificationProviderEvent,
      {
        runId: run.runId,
        gameKey: run.gameKey,
        externalId: "fixture-1",
        homeTeamAbbreviation: "DEN",
        awayTeamAbbreviation: "KC",
        homeScore: 7,
        awayScore: 3,
        status: "AOT",
        providerIngestedAtMs: NOW_MS + 20_000,
      },
    );
    const report = await operator.mutation(
      api.providerQualification.finalizeQualificationRun,
      {
        runId: run.runId,
        explanation: "Terminal status did not match.",
        allObservedEventsRecorded: true,
        confirmationText:
          "I recorded every observed scoring change and final.",
      },
    );
    expect(report).toMatchObject({
      status: "failed",
      missingGames: 0,
      scoreErrors: 0,
      finalStatusErrors: 1,
    });
  });

  it("reports missing evidence and keeps production unqualified until a later window passes", async () => {
    const t = convexTest(schema, modules);
    const { seasonId } = await seedSeason(t);
    const operator = await establishOperator(t);
    const first = await createRunWithReference(
      t,
      operator,
      seasonId,
    );
    vi.setSystemTime(NOW_MS + 2 * 60_000 + 1);
    const failed = await operator.mutation(
      api.providerQualification.finalizeQualificationRun,
      {
        runId: first.runId,
        explanation: "No provider event appeared.",
        allObservedEventsRecorded: true,
        confirmationText:
          "I recorded every observed scoring change and final.",
      },
    );
    expect(failed).toMatchObject({
      status: "failed",
      missingGames: 1,
    });
    await expect(
      operator.mutation(
        api.providerQualification.setProductionCompetitiveSyncEnabled,
        { enabled: true, seasonId, provider: "api-sports" },
      ),
    ).rejects.toThrow(/passing qualification/i);
    await expect(
      operator.mutation(
        api.providerQualification.finalizeQualificationRun,
      {
        runId: first.runId,
        explanation: "Try again.",
        allObservedEventsRecorded: true,
        confirmationText:
          "I recorded every observed scoring change and final.",
      },
      ),
    ).rejects.toThrow(/new qualification window/i);

    vi.setSystemTime(NOW_MS + 10 * 60_000);
    await t.run(async (ctx) => {
      const participant = await ctx.db
        .query("participants")
        .withIndex("by_clerkUserId", (q) =>
          q.eq("clerkUserId", "operator"),
        )
        .unique();
      await ctx.db.patch(participant!._id, {
        operatorStepUpVerifiedAtMs: NOW_MS + 10 * 60_000,
      });
    });
    const second = await createRunWithReference(
      t,
      operator,
      seasonId,
    );
    vi.setSystemTime(NOW_MS + 10 * 60_000 + 60_000);
    await t.mutation(
      internal.providerQualification.recordQualificationProviderEvent,
      {
        runId: second.runId,
        gameKey: second.gameKey,
        externalId: "fixture-1",
        homeTeamAbbreviation: "DEN",
        awayTeamAbbreviation: "KC",
        homeScore: 7,
        awayScore: 3,
        status: "FT",
        providerIngestedAtMs: NOW_MS + 10 * 60_000 + 30_000,
      },
    );
    await operator.mutation(
      api.providerQualification.finalizeQualificationRun,
      {
        runId: second.runId,
        explanation: "Later clean window.",
        allObservedEventsRecorded: true,
        confirmationText:
          "I recorded every observed scoring change and final.",
      },
    );
    await expect(
      operator.mutation(
        api.providerQualification.setProductionCompetitiveSyncEnabled,
        { enabled: true, seasonId, provider: "api-sports" },
      ),
    ).resolves.toMatchObject({ enabled: true });
    const authorized = await t.mutation(
      internal.providerQualification.authorizeProductionProviderRequest,
      { intent: "competitive" },
    );
    expect(authorized).toMatchObject({
      allowed: true,
      fence: {
        provider: "api-sports",
        seasonId,
        decisionRunId: second.runId,
      },
    });
    const otherSeasonId = await t.run(
      async (ctx) =>
        await ctx.db.insert("poolSeasons", {
          label: "2027",
          year: 2027,
          status: "available",
          usableStartWeek: 1,
          bootstrappedAtMs: NOW_MS,
        }),
    );
    await expect(
      t.mutation(
        internal.providerQualification.authorizeProductionProviderRequest,
        {
          intent: "competitive",
          expectedSeasonId: otherSeasonId,
        },
      ),
    ).resolves.toMatchObject({
      allowed: false,
      reason: "qualification_season_mismatch",
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(seasonId, {
        bootstrappedAtMs: NOW_MS + 1,
      });
    });
    await expect(
      t.mutation(
        internal.providerQualification.authorizeProductionProviderRequest,
        { intent: "competitive" },
      ),
    ).resolves.toMatchObject({
      allowed: false,
      reason: "qualification_stale",
    });

    vi.setSystemTime(NOW_MS + 12 * 60_000);
    const next = await operator.mutation(
      api.providerQualification.createQualificationRun,
      { provider: "api-sports", seasonId },
    );
    expect(next.status).toBe("collecting");
    await expect(
      t.mutation(
        internal.providerQualification.authorizeProductionProviderRequest,
        { intent: "competitive" },
      ),
    ).resolves.toMatchObject({
      allowed: false,
      reason: "qualification_required",
    });
  });

  it("keeps qualification fetches available before a pass but blocks production competitive enablement", async () => {
    const t = convexTest(schema, modules);
    const { seasonId } = await seedSeason(t);
    const operator = await establishOperator(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("syncGate", {
        key: "deployment",
        enabled: true,
        updatedAtMs: NOW_MS - 1,
      });
    });
    await expect(
      t.mutation(
        internal.providerQualification.authorizeProductionProviderRequest,
        { intent: "competitive" },
      ),
    ).resolves.toMatchObject({
      allowed: false,
      reason: "qualification_required",
    });
    const run = await operator.mutation(
      api.providerQualification.createQualificationRun,
      { provider: "api-sports", seasonId },
    );
    expect(
      await operator.mutation(
        api.providerQualification.claimQualificationProviderFetch,
        { runId: run.runId, surface: "live" },
      ),
    ).toMatchObject({ ok: true, mode: "qualification" });
    await expect(
      t.mutation(
        internal.providerQualification.authorizeProductionProviderRequest,
        {
          intent: "qualification",
          qualificationRunId: run.runId,
        },
      ),
    ).resolves.toMatchObject({ allowed: true, fence: null });
    await expect(
      operator.mutation(
        api.providerQualification.setProductionCompetitiveSyncEnabled,
        { enabled: true, seasonId, provider: "api-sports" },
      ),
    ).rejects.toThrow(/passing qualification/i);
  });

  it("authorizes the current receipt without globally scanning past unrelated audit rows", async () => {
    const t = convexTest(schema, modules);
    const { seasonId } = await seedSeason(t);
    const operator = await establishOperator(t);
    const run = await passAndEnable(t, operator, seasonId);
    await t.run(async (ctx) => {
      for (let index = 0; index < 1_001; index += 1) {
        await ctx.db.insert("operatorAuditEvents", {
          action: "unrelated_operator_audit",
          actorTokenIdentifier: "unrelated",
          actorClerkUserId: "unrelated",
          atMs: NOW_MS + 60_000 + index,
        });
      }
    });
    await expect(
      t.mutation(
        internal.providerQualification.authorizeProductionProviderRequest,
        { intent: "competitive", expectedSeasonId: seasonId },
      ),
    ).resolves.toMatchObject({
      allowed: true,
      fence: { decisionRunId: run.runId, seasonId },
    });
  });

  it("rejects a fetched slate at reconciliation when its qualification fence becomes stale", async () => {
    const t = convexTest(schema, modules);
    const { seasonId } = await seedSeason(t);
    const operator = await establishOperator(t);
    await passAndEnable(t, operator, seasonId);
    const authorization = await t.mutation(
      internal.providerQualification.authorizeProductionProviderRequest,
      { intent: "competitive", expectedSeasonId: seasonId },
    );
    if (!authorization.allowed || !authorization.fence) {
      throw new Error("Expected a production qualification fence");
    }
    const beforeCount = await t.run(
      async (ctx) =>
        (await ctx.db.query("liveGameIngestionState").collect()).length,
    );

    vi.setSystemTime(NOW_MS + 2 * 60_000);
    await operator.mutation(
      api.providerQualification.createQualificationRun,
      { provider: "api-sports", seasonId },
    );

    await expect(
      t.action(
        internal.syncApiSportsLive.applySuccessfulSlateBatch,
        {
          observations: [],
          nowMs: NOW_MS + 2 * 60_000,
          productionFence: authorization.fence,
        },
      ),
    ).rejects.toThrow(/qualification/i);
    const afterCount = await t.run(
      async (ctx) =>
        (await ctx.db.query("liveGameIngestionState").collect()).length,
    );
    expect(afterCount).toBe(beforeCount);
  });

  it("marks schedule work failed and requeues when qualification is revoked after HTTP", async () => {
    const t = convexTest(schema, modules);
    const { seasonId } = await seedSeason(t);
    const operator = await establishOperator(t);
    await passAndEnable(t, operator, seasonId);
    const workItemId = await t.run(
      async (ctx) =>
        await ctx.db.insert("syncWorkItems", {
          surface: "schedule",
          scopeKey: `schedule:${seasonId}`,
          priority: "routine",
          status: "claimed",
          dueAtMs: NOW_MS,
          claimedAtMs: NOW_MS,
          leaseExpiresAtMs: NOW_MS + 60_000,
          attemptCount: 1,
          seasonId,
        }),
    );
    process.env.SPORTS_DATA_PROVIDER = "api-sports";
    process.env.API_SPORTS_KEY = "test-key";
    const fetch = vi.fn(async () => {
      await operator.mutation(
        api.providerQualification.createQualificationRun,
        { provider: "api-sports", seasonId },
      );
      return new Response(
        JSON.stringify({ errors: [], response: [] }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetch);

    await expect(
      t.action(internal.syncSchedule.runClaimedScheduleFetch, {
        workItemId,
        seasonId,
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "schedule_fetch_failed",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const state = await t.run(async (ctx) => ({
      work: await ctx.db.get(workItemId),
      health: await ctx.db
        .query("syncSurfaceHealth")
        .withIndex("by_surface_and_scopeKey", (q) =>
          q
            .eq("surface", "schedule")
            .eq("scopeKey", `schedule:${seasonId}`),
        )
        .unique(),
    }));
    expect(state.work).toMatchObject({
      status: "due",
      attemptCount: 1,
    });
    expect(state.health).toMatchObject({
      consecutiveFailures: 1,
      providerException: true,
    });
    expect(state.health?.lastSuccessAtMs).toBeUndefined();
  });

  it.each([
    [
      "skips a stale lower baseline and matches the later exact transition",
      [
        { homeScore: 0, awayScore: 0 },
        { homeScore: 7, awayScore: 3 },
      ],
      "passed",
      null,
    ],
    [
      "does not rescue an overshoot with a later exact transition",
      [
        { homeScore: 8, awayScore: 3 },
        { homeScore: 7, awayScore: 3 },
      ],
      "failed",
      "score_error",
    ],
    [
      "does not rescue a provider regression with a later exact transition",
      [
        { homeScore: 3, awayScore: 0 },
        { homeScore: 2, awayScore: 0 },
        { homeScore: 7, awayScore: 3 },
      ],
      "failed",
      "score_error",
    ],
    [
      "diagnoses an unused erroneous transition after an exact match",
      [
        { homeScore: 7, awayScore: 3 },
        { homeScore: 8, awayScore: 3 },
      ],
      "failed",
      "score_error",
    ],
  ] as const)("%s", async (_label, transitions, expectedStatus, finding) => {
    const t = convexTest(schema, modules);
    const { seasonId } = await seedSeason(t);
    const operator = await establishOperator(t);
    const run = await createRunWithReference(t, operator, seasonId);
    for (const [index, transition] of transitions.entries()) {
      const atMs = NOW_MS + (index + 1) * 20_000;
      vi.setSystemTime(atMs);
      await t.mutation(
        internal.providerQualification.recordQualificationProviderEvent,
        {
          runId: run.runId,
          gameKey: run.gameKey,
          externalId: "fixture-1",
          homeTeamAbbreviation: "DEN",
          awayTeamAbbreviation: "KC",
          homeScore: transition.homeScore,
          awayScore: transition.awayScore,
          status: "FT",
          providerIngestedAtMs: atMs,
        },
      );
    }
    const report = await operator.mutation(
      api.providerQualification.finalizeQualificationRun,
      {
        runId: run.runId,
        explanation: "Matching behavior reviewed independently.",
        allObservedEventsRecorded: true,
        confirmationText:
          "I recorded every observed scoring change and final.",
      },
    );
    expect(report.status).toBe(expectedStatus);
    if (finding === "score_error") {
      expect(report.scoreErrors).toBeGreaterThan(0);
    }
    const details = await operator.query(
      api.providerQualification.getOperatorQualificationRun,
      { runId: run.runId },
    );
    if (finding) {
      expect(details?.findings.map((item) => item.code)).toContain(finding);
    } else {
      expect(details?.findings).toEqual([]);
      expect(details?.references[0]).toMatchObject({
        matchedProviderSequence: 3,
        ingestionDelayMs: 40_000,
        applicationDelayMs: 40_000,
        outcome: "matched",
      });
    }
  });

  it(
    "persists reference/provider overflow, audits every evidence append, and cannot pass",
    async () => {
      const t = convexTest(schema, modules);
      const { seasonId } = await seedSeason(t);
      const operator = await establishOperator(t);
      const created = await operator.mutation(
        api.providerQualification.createQualificationRun,
        { provider: "api-sports", seasonId },
      );
      const game = await operator.mutation(
        api.providerQualification.registerQualificationGame,
        {
          runId: created.runId,
          homeTeamAbbreviation: "DEN",
          awayTeamAbbreviation: "KC",
          scheduledKickoffMs: NOW_MS,
          apiSportsExternalId: "fixture-1",
        },
      );
      for (let index = 0; index < 256; index += 1) {
        await operator.mutation(
          api.providerQualification.recordReferenceEvent,
          {
            runId: created.runId,
            gameKey: game.gameKey,
            kind: index === 0 ? "final" : "score",
            source: "official_nfl_view",
            clientNonce: `overflow-reference-${index}`,
            homeTeamAbbreviation: "DEN",
            awayTeamAbbreviation: "KC",
            homeScore: 7,
            awayScore: 3,
            status: index === 0 ? "FT" : undefined,
          },
        );
      }
      await expect(
        operator.mutation(
          api.providerQualification.recordReferenceEvent,
          {
            runId: created.runId,
            gameKey: game.gameKey,
            kind: "score",
            source: "official_nfl_view",
            clientNonce: "overflow-reference-final-attempt",
            homeTeamAbbreviation: "DEN",
            awayTeamAbbreviation: "KC",
            homeScore: 7,
            awayScore: 3,
          },
        ),
      ).resolves.toMatchObject({
        recorded: false,
        overflowed: true,
      });
      for (let index = 0; index < 512; index += 1) {
        const atMs = NOW_MS + index + 1;
        vi.setSystemTime(atMs);
        await t.mutation(
          internal.providerQualification.recordQualificationProviderEvent,
          {
            runId: created.runId,
            gameKey: game.gameKey,
            externalId: "fixture-1",
            homeTeamAbbreviation: "DEN",
            awayTeamAbbreviation: "KC",
            homeScore: index,
            awayScore: 0,
            providerIngestedAtMs: atMs,
          },
        );
      }
      await expect(
        t.mutation(
          internal.providerQualification.recordQualificationProviderEvent,
          {
            runId: created.runId,
            gameKey: game.gameKey,
            externalId: "fixture-1",
            homeTeamAbbreviation: "DEN",
            awayTeamAbbreviation: "KC",
            homeScore: 513,
            awayScore: 0,
            providerIngestedAtMs: NOW_MS + 513,
          },
        ),
      ).resolves.toMatchObject({
        recorded: false,
        overflowed: true,
      });
      const before = await operator.query(
        api.providerQualification.getOperatorQualificationRun,
        { runId: created.runId },
      );
      expect(before?.run.coverageOverflowed).toBe(true);
      expect(before?.references).toHaveLength(256);
      expect(before?.providerEvents).toHaveLength(512);
      const report = await operator.mutation(
        api.providerQualification.finalizeQualificationRun,
        {
          runId: created.runId,
          explanation: "Evidence capacity overflowed.",
          allObservedEventsRecorded: true,
          confirmationText:
            "I recorded every observed scoring change and final.",
        },
      );
      expect(report.status).toBe("failed");
      const after = await operator.query(
        api.providerQualification.getOperatorQualificationRun,
        { runId: created.runId },
      );
      expect(after?.findings.map((finding) => finding.code)).toContain(
        "coverage_overflow",
      );
      const audits = await t.run(
        async (ctx) => await ctx.db.query("operatorAuditEvents").collect(),
      );
      expect(
        audits.filter(
          (audit) =>
            audit.action ===
            "provider_qualification_reference_recorded",
        ),
      ).toHaveLength(256);
      expect(
        audits.filter(
          (audit) =>
            audit.action ===
            "provider_qualification_provider_event_recorded",
        ),
      ).toHaveLength(512);
    },
    30_000,
  );

  it(
    "durably truncates worst-case finding detail while preserving exact counters",
    async () => {
      const t = convexTest(schema, modules);
      const { seasonId } = await seedSeason(t);
      const operator = await establishOperator(t);
      const created = await operator.mutation(
        api.providerQualification.createQualificationRun,
        { provider: "api-sports", seasonId },
      );
      const game = await operator.mutation(
        api.providerQualification.registerQualificationGame,
        {
          runId: created.runId,
          homeTeamAbbreviation: "DEN",
          awayTeamAbbreviation: "KC",
          scheduledKickoffMs: NOW_MS,
          apiSportsExternalId: "fixture-1",
        },
      );
      for (let index = 0; index < 256; index += 1) {
        await operator.mutation(
          api.providerQualification.recordReferenceEvent,
          {
            runId: created.runId,
            gameKey: game.gameKey,
            kind: "final",
            source: "official_nfl_view",
            clientNonce: `worst-reference-${index}`,
            homeTeamAbbreviation: "DEN",
            awayTeamAbbreviation: "KC",
            homeScore: index,
            awayScore: 0,
            status: "FT",
          },
        );
      }
      await t.mutation(
      internal.providerQualification.recordQualificationPollRejection,
      {
        runId: created.runId,
        gameKey: game.gameKey,
        reason: "phase_mismatch",
        evidence: rejectedCandidateEvidence({
          actualSeasonPhase: "regular_season",
          actualProviderStage: "Regular Season",
        }),
      },
      );
      vi.setSystemTime(NOW_MS + 3 * 60_000 + 1);
      for (let index = 0; index < 512; index += 1) {
        await t.mutation(
          internal.providerQualification.recordQualificationProviderEvent,
          {
            runId: created.runId,
            gameKey: game.gameKey,
            externalId: "fixture-1",
            homeTeamAbbreviation: "DEN",
            awayTeamAbbreviation: "KC",
            homeScore: 1_000 + index,
            awayScore: 0,
            status: "FT",
            providerIngestedAtMs: NOW_MS + 3 * 60_000,
          },
        );
      }

      const report = await operator.mutation(
        api.providerQualification.finalizeQualificationRun,
        {
          runId: created.runId,
          explanation: "Worst-case bounded report remained durable.",
          allObservedEventsRecorded: true,
          confirmationText:
            "I recorded every observed scoring change and final.",
        },
      );
      expect(report).toMatchObject({
        status: "failed",
        correctnessErrors: 513,
        freshnessBreaches: 256,
        scoreErrors: 512,
      });
      const details = await operator.query(
        api.providerQualification.getOperatorQualificationRun,
        { runId: created.runId },
      );
      expect(details?.run.findingsTruncated).toBe(true);
      expect(details?.findings).toHaveLength(512);
      expect(details?.findings.at(-1)?.code).toBe("findings_truncated");
      expect(details?.candidateRejections).toEqual([
        expect.objectContaining({ code: "phase_mismatch" }),
      ]);
    },
    30_000,
  );

  it("uses bounded operator queries and denies Pool roles independently of their role", async () => {
    const t = convexTest(schema, modules);
    const { seasonId } = await seedSeason(t);
    const operator = await establishOperator(t);
    await operator.mutation(
      api.providerQualification.createQualificationRun,
      { provider: "api-sports", seasonId },
    );
    const participant = t.withIdentity(identity("pool-owner"));
    await participant.mutation(api.participants.ensureMyParticipant, {});

    await expect(
      participant.query(
        api.providerQualification.listOperatorQualificationRuns,
        { limit: 25 },
      ),
    ).rejects.toThrow(/Production Operator/i);
    await expect(
      operator.query(
        api.providerQualification.listOperatorQualificationRuns,
        { limit: 201 },
      ),
    ).rejects.toThrow(/limit/i);
    await expect(
      operator.query(
        api.providerQualification.listOperatorQualificationRuns,
        { limit: 25 },
      ),
    ).resolves.toHaveLength(1);
  });
});
