/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const NOW_MS = Date.UTC(2026, 8, 14, 20);

function identity(subject: string) {
  return {
    subject,
    issuer: "https://auth.example.test",
    tokenIdentifier: `https://auth.example.test|${subject}`,
    email: `${subject}@example.test`,
    emailVerified: true,
  };
}

async function seedGame(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const seasonId = await ctx.db.insert("poolSeasons", {
      label: "2026",
      year: 2026,
      status: "available",
      usableStartWeek: 1,
    });
    const homeTeamId = await ctx.db.insert("nflTeams", {
      stableKey: "denver-broncos",
      name: "Denver Broncos",
      abbreviation: "DEN",
      sportsDbTeamId: "legacy-den",
    });
    const awayTeamId = await ctx.db.insert("nflTeams", {
      stableKey: "kansas-city-chiefs",
      name: "Kansas City Chiefs",
      abbreviation: "KC",
      sportsDbTeamId: "legacy-kc",
    });
    const gameId = await ctx.db.insert("nflGames", {
      stableKey: "nfl:2026:w1:kc@den",
      seasonId,
      seasonLabel: "2026",
      week: 1,
      homeTeamId,
      awayTeamId,
      scheduledKickoffMs: NOW_MS,
      lifecycle: "scheduled",
      homeScore: null,
      awayScore: null,
      sportsDbEventId: "legacy-game",
      resultAuthority: "none",
    });
    return { seasonId, gameId };
  });
}

const scheduledState = {
  scheduledKickoffMs: NOW_MS,
  kickoffLockReachedAtMs: null,
  lifecycle: "scheduled" as const,
  homeScore: null,
  awayScore: null,
  resultAuthority: "none" as const,
  verifiedResult: null,
  correctionCandidate: null,
  pinned: false,
};

describe("provider evidence retention", () => {
  const previousOperator =
    process.env.PRODUCTION_OPERATOR_CLERK_USER_ID;

  beforeEach(() => {
    process.env.PRODUCTION_OPERATOR_CLERK_USER_ID = "operator";
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS + 5_000);
  });

  afterEach(() => {
    vi.useRealTimers();
    if (previousOperator === undefined) {
      delete process.env.PRODUCTION_OPERATOR_CLERK_USER_ID;
    } else {
      process.env.PRODUCTION_OPERATOR_CLERK_USER_ID = previousOperator;
    }
  });

  it("retains only normalized transitions and records a change away and back", async () => {
    const t = convexTest(schema, modules);
    const { gameId } = await seedGame(t);
    const liveState = {
      ...scheduledState,
      lifecycle: "in_progress" as const,
      kickoffLockReachedAtMs: NOW_MS + 1_000,
      homeScore: 7,
      awayScore: 0,
      resultAuthority: "projected" as const,
    };

    await t.mutation(
      internal.providerEvidence.recordGameTransitionForTest,
      {
        gameId,
        provider: "api-sports",
        externalId: "12345",
        source: "live",
        observedAtMs: NOW_MS + 1_000,
        before: scheduledState,
        after: liveState,
      },
    );
    const duplicate = await t.mutation(
      internal.providerEvidence.recordGameTransitionForTest,
      {
        gameId,
        provider: "api-sports",
        externalId: "12345",
        source: "live",
        observedAtMs: NOW_MS + 2_000,
        before: liveState,
        after: liveState,
      },
    );
    await t.mutation(
      internal.providerEvidence.recordGameTransitionForTest,
      {
        gameId,
        provider: "api-sports",
        externalId: "12345",
        source: "live",
        observedAtMs: NOW_MS + 3_000,
        before: liveState,
        after: scheduledState,
      },
    );

    expect(duplicate).toEqual({ recorded: false });
    const evidence = await t.run(async (ctx) =>
      ctx.db
        .query("providerGameEvidence")
        .withIndex("by_nflGameId_and_recordedAtMs", (q) =>
          q.eq("nflGameId", gameId),
        )
        .collect(),
    );
    expect(evidence).toHaveLength(2);
    expect(evidence.map((row) => row.transitionKind)).toEqual([
      "kickoff_lock",
      "kickoff_lock",
    ]);
    expect(evidence[0]).toMatchObject({
      gameStableKey: "nfl:2026:w1:kc@den",
      seasonLabel: "2026",
      gameWeek: 1,
      homeTeamAbbreviation: "DEN",
      awayTeamAbbreviation: "KC",
      changedFields: [
        "kickoffLockReachedAtMs",
        "lifecycle",
        "homeScore",
        "awayScore",
        "resultAuthority",
      ],
      before: scheduledState,
      after: liveState,
    });
  });

  it("deduplicates concurrent identical permanent transitions", async () => {
    const t = convexTest(schema, modules);
    const { gameId } = await seedGame(t);
    const after = {
      ...scheduledState,
      lifecycle: "in_progress" as const,
      kickoffLockReachedAtMs: NOW_MS,
    };
    const input = {
      gameId,
      provider: "api-sports" as const,
      externalId: "12345",
      source: "live" as const,
      observedAtMs: NOW_MS,
      before: scheduledState,
      after,
    };

    await Promise.all([
      t.mutation(
        internal.providerEvidence.recordGameTransitionForTest,
        input,
      ),
      t.mutation(
        internal.providerEvidence.recordGameTransitionForTest,
        input,
      ),
    ]);

    expect(
      await t.run(async (ctx) =>
        ctx.db.query("providerGameEvidence").collect(),
      ),
    ).toHaveLength(1);
  });

  it("coalesces identical request diagnostics and stores only server-allowlisted metadata", async () => {
    const t = convexTest(schema, modules);
    const { gameId } = await seedGame(t);
    const args = {
      surface: "correction" as const,
      scopeKey: `game:${gameId}`,
      gameId,
      endpoint: "/games",
      parameters: {
        id: "12345",
        authorization: "Bearer provider-secret",
        participantEmail: "person@example.com",
      },
      outcome: "success" as const,
      httpStatus: 200,
      responseSummary: {
        bodyBytes: 512,
        bodyDigest: "a".repeat(64),
        resultCount: 1,
        pagingCurrent: 1,
        pagingTotal: 1,
      },
      quota: {
        dailyLimit: 7_500,
        dailyRemaining: 7_499,
        minuteLimit: 60,
        minuteRemaining: 59,
      },
      providerStatus: {
        short: "Q5",
        long: "Quarter 5",
      },
    };

    await t.mutation(
      internal.providerEvidence.recordApiSportsDiagnostic,
      args,
    );
    vi.setSystemTime(NOW_MS + 6_000);
    await t.mutation(
      internal.providerEvidence.recordApiSportsDiagnostic,
      args,
    );

    const diagnostics = await t.run(async (ctx) =>
      ctx.db.query("providerRequestDiagnostics").collect(),
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      gameStableKey: "nfl:2026:w1:kc@den",
      endpoint: "/games",
      requestExternalId: "12345",
      observationCount: 2,
      firstRecordedAtMs: NOW_MS + 5_000,
      lastRecordedAtMs: NOW_MS + 6_000,
      expiresAtMs:
        NOW_MS + 5_000 + 30 * 24 * 60 * 60 * 1_000,
      retentionClass: "diagnostic_30d",
      quotaDailyLimit: 7_500,
      quotaMinuteRemaining: 59,
      statusShortPreview: "Q5",
      statusLongPreview: "Quarter 5",
      statusRedacted: false,
    });
    expect(JSON.stringify(diagnostics)).not.toMatch(
      /provider-secret|bearer|person@example\.com|authorization|participantEmail/i,
    );

    const nextBucketAtMs =
      NOW_MS + 5_000 + 30 * 24 * 60 * 60 * 1_000;
    vi.setSystemTime(nextBucketAtMs);
    await t.mutation(
      internal.providerEvidence.recordApiSportsDiagnostic,
      args,
    );
    const nextBucket = await t.run(async (ctx) =>
      ctx.db.query("providerRequestDiagnostics").unique(),
    );
    expect(nextBucket).toMatchObject({
      firstRecordedAtMs: nextBucketAtMs,
      lastRecordedAtMs: nextBucketAtMs,
      observationCount: 1,
      expiresAtMs:
        nextBucketAtMs + 30 * 24 * 60 * 60 * 1_000,
    });
  });

  it("deletes expired diagnostics in resumable bounded batches and never touches permanent evidence", async () => {
    const t = convexTest(schema, modules);
    const { gameId } = await seedGame(t);
    await t.mutation(
      internal.providerEvidence.recordGameTransitionForTest,
      {
        gameId,
        provider: "api-sports",
        externalId: "12345",
        source: "live",
        observedAtMs: NOW_MS,
        before: scheduledState,
        after: {
          ...scheduledState,
          lifecycle: "in_progress",
          kickoffLockReachedAtMs: NOW_MS,
        },
      },
    );
    await t.run(async (ctx) => {
      for (let index = 0; index < 208; index++) {
        const expiresAtMs =
          index < 205
            ? NOW_MS - (index % 3)
            : NOW_MS + index;
        await ctx.db.insert("providerRequestDiagnostics", {
          fingerprint: `expired-${index}`,
          provider: "api-sports",
          surface: "live",
          gameStableKey: "nfl:2026:w1:kc@den",
          endpoint: "/games",
          outcome: "no_change",
          firstRecordedAtMs: NOW_MS - 31 * 24 * 60 * 60 * 1_000,
          lastRecordedAtMs: NOW_MS - 31 * 24 * 60 * 60 * 1_000,
          observationCount: 1,
          expiresAtMs,
          retentionClass: "diagnostic_30d",
        });
      }
      const game = await ctx.db.get(gameId);
      if (!game) throw new Error("missing game");
      await ctx.db.patch(gameId, {
        lifecycle: "terminal",
        homeScore: 24,
        awayScore: 17,
        resultAuthority: "verified",
        verifiedResult: {
          homeScore: 24,
          awayScore: 17,
          status: "FT",
          verifiedAtMs: NOW_MS - 10_000,
        },
      });
      await ctx.db.insert("nflGameResultHistory", {
        nflGameId: gameId,
        homeScore: 21,
        awayScore: 17,
        status: "FT",
        verifiedAtMs: NOW_MS - 20_000,
        supersededAtMs: NOW_MS - 10_000,
      });
      await ctx.db.insert(
        "nflGameResultReconciliationObservations",
        {
          nflGameId: gameId,
          observedAtMs: NOW_MS - 10_000,
          homeScore: 24,
          awayScore: 17,
          status: "FT",
          matchesVerified: false,
          disposition: "corrected",
        },
      );
      const overrideId = await ctx.db.insert(
        "nflGameResultOverrides",
        {
          nflGameId: gameId,
          gameStableKey: game.stableKey,
          seasonLabel: game.seasonLabel,
          gameWeek: game.week,
          homeTeamAbbreviation: "DEN",
          awayTeamAbbreviation: "KC",
          status: "released",
          reason: "Test permanent override",
          replacedResult: {
            homeScore: 21,
            awayScore: 17,
            status: "FT",
            verifiedAtMs: NOW_MS - 20_000,
          },
          overrideResult: {
            homeScore: 24,
            awayScore: 17,
            status: "FT",
            verifiedAtMs: NOW_MS - 10_000,
          },
          actorTokenIdentifier: "operator-token",
          actorClerkUserId: "operator",
          pinnedAtMs: NOW_MS - 10_000,
          releaseReason: "Confirmed",
          releasedAtMs: NOW_MS - 5_000,
          releasedByTokenIdentifier: "operator-token",
          releasedByClerkUserId: "operator",
        },
      );
      await ctx.db.insert("nflGameResultOverrideEvidence", {
        overrideId,
        observedAtMs: NOW_MS - 9_000,
        homeScore: 24,
        awayScore: 17,
        status: "FT",
        disposition: "pinned_matching",
        source: "api_sports_targeted",
      });
      await ctx.db.insert("nflGameScheduleHistory", {
        nflGameId: gameId,
        seasonId: game.seasonId,
        week: game.week,
        homeTeamId: game.homeTeamId,
        awayTeamId: game.awayTeamId,
        scheduledKickoffMs: game.scheduledKickoffMs,
        firstObservedAtMs: NOW_MS - 50_000,
        lastObservedAtMs: NOW_MS - 40_000,
      });
      const participantId = await ctx.db.insert("participants", {
        tokenIdentifier: "protected-owner-token",
        clerkUserId: "protected-owner",
        displayName: "Protected owner",
        emailVerified: true,
        phoneVerified: true,
        ageConfirmed: true,
        suspended: false,
      });
      const poolId = await ctx.db.insert("pools", {
        name: "Protected pool",
        type: "survivor",
        seasonId: game.seasonId,
        startWeek: 1,
        pickLockMode: "gameKickoff",
        status: "active",
        rulesFrozen: true,
        ownerParticipantId: participantId,
        createdAtMs: NOW_MS - 60_000,
      });
      await ctx.db.insert("scoringRevisions", {
        poolId,
        week: 1,
        kind: "survivor",
        revisionNumber: 2,
        fingerprint: "protected-revision",
        publishedAtMs: NOW_MS - 4_000,
        status: "published",
      });
      await ctx.db.insert("operatorAuditEvents", {
        action: "protected_action",
        actorTokenIdentifier: "operator-token",
        actorClerkUserId: "operator",
        atMs: NOW_MS - 3_000,
      });
      await ctx.db.insert("operatorIncidents", {
        type: "provider_exception",
        status: "open",
        surface: "live",
        scopeKey: `game:${gameId}`,
        dedupeKey: `provider_exception:game:${gameId}`,
        participantVisible: true,
        summary: "Sanitized incident",
        openedAtMs: NOW_MS - 2_000,
        maintenanceLock: false,
      });
    });
    const protectedSnapshot = async () =>
      await t.run(async (ctx) => ({
        games: await ctx.db.query("nflGames").collect(),
        permanent: await ctx.db
          .query("providerGameEvidence")
          .collect(),
        resultHistory: await ctx.db
          .query("nflGameResultHistory")
          .collect(),
        reconciliation: await ctx.db
          .query("nflGameResultReconciliationObservations")
          .collect(),
        overrides: await ctx.db
          .query("nflGameResultOverrides")
          .collect(),
        overrideEvidence: await ctx.db
          .query("nflGameResultOverrideEvidence")
          .collect(),
        scheduleHistory: await ctx.db
          .query("nflGameScheduleHistory")
          .collect(),
        scoringRevisions: await ctx.db
          .query("scoringRevisions")
          .collect(),
        operatorAudit: await ctx.db
          .query("operatorAuditEvents")
          .collect(),
        incidents: await ctx.db
          .query("operatorIncidents")
          .collect(),
      }));
    const protectedBefore = await protectedSnapshot();

    const first = await t.mutation(
      internal.providerEvidence.cleanupExpiredDiagnostics,
      { cutoffMs: NOW_MS, batchSize: 100 },
    );
    expect(first).toMatchObject({
      deleted: 100,
      deletedTotal: 100,
      status: "running",
      continuationScheduled: true,
    });
    expect(
      await t.run(async (ctx) =>
        ctx.db.query("providerRequestDiagnostics").collect(),
      ),
    ).toHaveLength(108);
    await t.run(async (ctx) => {
      await ctx.db.insert("providerRequestDiagnostics", {
        fingerprint: "backdated-during-cleanup",
        provider: "api-sports",
        surface: "live",
        endpoint: "/games",
        outcome: "no_change",
        firstRecordedAtMs: NOW_MS - 40 * 24 * 60 * 60 * 1_000,
        lastRecordedAtMs: NOW_MS - 40 * 24 * 60 * 60 * 1_000,
        observationCount: 1,
        expiresAtMs: NOW_MS - 1,
        retentionClass: "diagnostic_30d",
      });
    });
    const staleContinuation = await t.mutation(
      internal.providerEvidence.cleanupExpiredDiagnostics,
      {
        cutoffMs: NOW_MS,
        batchSize: 100,
        generation: first.generation + 1,
      },
    );
    expect(staleContinuation).toMatchObject({
      deleted: 0,
      deletedTotal: 100,
      status: "stale",
      continuationScheduled: false,
    });

    const second = await t.mutation(
      internal.providerEvidence.cleanupExpiredDiagnostics,
      {
        cutoffMs: NOW_MS,
        batchSize: 100,
        generation: first.generation,
      },
    );
    expect(second.deleted).toBe(100);
    const third = await t.mutation(
      internal.providerEvidence.cleanupExpiredDiagnostics,
      {
        cutoffMs: NOW_MS,
        batchSize: 100,
        generation: first.generation,
      },
    );
    expect(third).toMatchObject({
      deleted: 6,
      deletedTotal: 206,
      status: "complete",
      continuationScheduled: false,
    });
    const rerun = await t.mutation(
      internal.providerEvidence.cleanupExpiredDiagnostics,
      {
        cutoffMs: NOW_MS,
        batchSize: 100,
        generation: first.generation,
      },
    );
    expect(rerun).toMatchObject({
      deleted: 0,
      deletedTotal: 206,
      status: "complete",
    });
    const remaining = await t.run(async (ctx) =>
      ctx.db.query("providerRequestDiagnostics").collect(),
    );
    expect(remaining).toHaveLength(3);
    expect(
      remaining.every((row) => row.expiresAtMs > NOW_MS),
    ).toBe(true);
    expect(await protectedSnapshot()).toEqual(protectedBefore);
  });

  it("allows only the Production Operator to inspect recent evidence by game or incident", async () => {
    const t = convexTest(schema, modules);
    const { gameId } = await seedGame(t);
    await t.mutation(
      internal.providerEvidence.recordGameTransitionForTest,
      {
        gameId,
        provider: "api-sports",
        externalId: "12345",
        source: "live",
        observedAtMs: NOW_MS,
        before: scheduledState,
        after: {
          ...scheduledState,
          lifecycle: "in_progress",
          kickoffLockReachedAtMs: NOW_MS,
        },
      },
    );
    await t.mutation(
      internal.providerEvidence.recordApiSportsDiagnostic,
      {
        surface: "live",
        scopeKey: "live:nfl",
        gameId,
        endpoint: "/games",
        parameters: { league: 1, live: "all" },
        outcome: "no_change",
        httpStatus: 200,
      },
    );
    const opened = await t.mutation(
      internal.incidents.evaluateAndOpenIncident,
      {
        trigger: { kind: "provider_exception" },
        surface: "live",
        scopeKey: "live:nfl",
        summary: "Provider data needs operator review.",
        nowMs: NOW_MS,
      },
    );
    if (opened.incidentId === null) {
      throw new Error("expected an incident");
    }
    const recoveryIncident = await t.mutation(
      internal.incidents.evaluateAndOpenIncident,
      {
        trigger: { kind: "provider_exception" },
        surface: "live",
        scopeKey: `recovery:${gameId}`,
        summary: "Targeted recovery needs operator review.",
        nowMs: NOW_MS + 1,
      },
    );
    if (recoveryIncident.incidentId === null) {
      throw new Error("expected a recovery incident");
    }
    const malformedIncident = await t.mutation(
      internal.incidents.evaluateAndOpenIncident,
      {
        trigger: { kind: "provider_exception" },
        surface: "live",
        scopeKey: "malformed-live-slate-row",
        summary: "Malformed live row needs operator review.",
        nowMs: NOW_MS + 2,
      },
    );
    if (malformedIncident.incidentId === null) {
      throw new Error("expected a malformed-row incident");
    }
    const correctionIncident = await t.mutation(
      internal.incidents.evaluateAndOpenIncident,
      {
        trigger: { kind: "provider_exception" },
        surface: "live",
        scopeKey: `correction:${gameId}`,
        summary: "Correction lookup needs operator review.",
        nowMs: NOW_MS + 3,
      },
    );
    if (correctionIncident.incidentId === null) {
      throw new Error("expected a correction incident");
    }

    await expect(
      t.query(api.providerEvidence.listOperatorGameEvidence, {
        gameId,
        limit: 25,
      }),
    ).rejects.toThrow(/Unauthenticated/i);
    const asOwner = t.withIdentity(identity("owner"));
    await expect(
      asOwner.query(
        api.providerEvidence.listOperatorIncidentEvidence,
        {
          incidentId: opened.incidentId,
          limit: 25,
        },
      ),
    ).rejects.toThrow(/Production Operator/i);

    const asOperator = t.withIdentity(identity("operator"));
    const gameEvidence = await asOperator.query(
      api.providerEvidence.listOperatorGameEvidence,
      { gameId, limit: 25 },
    );
    expect(gameEvidence).toMatchObject({
      game: {
        stableKey: "nfl:2026:w1:kc@den",
        seasonLabel: "2026",
        week: 1,
      },
      permanent: [{ transitionKind: "kickoff_lock" }],
      diagnostics: [{ outcome: "no_change", endpoint: "/games" }],
    });
    await t.mutation(
      internal.providerEvidence.recordApiSportsDiagnostic,
      {
        surface: "correction",
        scopeKey: `game:${gameId}`,
        gameId,
        endpoint: "/games",
        parameters: { id: "12345" },
        outcome: "http_error",
        httpStatus: 503,
      },
    );
    await t.run(async (ctx) => {
      await ctx.db.delete(gameId);
    });
    const gameEvidenceByStableKey = await asOperator.query(
      api.providerEvidence.listOperatorGameEvidence,
      { gameStableKey: "nfl:2026:w1:kc@den", limit: 25 },
    );
    expect(gameEvidenceByStableKey?.permanent).toHaveLength(1);
    expect(
      await asOperator.query(
        api.providerEvidence.listOperatorGameEvidence,
        { gameStableKey: "2026-w99-missing", limit: 25 },
      ),
    ).toBeNull();
    const incidentEvidence = await asOperator.query(
      api.providerEvidence.listOperatorIncidentEvidence,
      { incidentId: opened.incidentId, limit: 25 },
    );
    expect(incidentEvidence).toMatchObject({
      incident: {
        type: "provider_exception",
        surface: "live",
        scopeKey: "live:nfl",
      },
      diagnostics: [{ outcome: "no_change", endpoint: "/games" }],
    });
    expect(JSON.stringify(incidentEvidence)).not.toMatch(
      /actor|clerk|tokenIdentifier|email|phone|headers|responseBody/i,
    );
    const recoveryEvidence = await asOperator.query(
      api.providerEvidence.listOperatorIncidentEvidence,
      {
        incidentId: recoveryIncident.incidentId,
        limit: 25,
      },
    );
    expect(recoveryEvidence.diagnostics).toEqual([
      expect.objectContaining({
        gameStableKey: "nfl:2026:w1:kc@den",
        outcome: "no_change",
      }),
    ]);
    const malformedEvidence = await asOperator.query(
      api.providerEvidence.listOperatorIncidentEvidence,
      {
        incidentId: malformedIncident.incidentId,
        limit: 25,
      },
    );
    expect(malformedEvidence.diagnostics).toEqual([
      expect.objectContaining({
        surface: "live",
        scopeKey: "live:nfl",
      }),
    ]);
    const correctionEvidence = await asOperator.query(
      api.providerEvidence.listOperatorIncidentEvidence,
      {
        incidentId: correctionIncident.incidentId,
        limit: 25,
      },
    );
    expect(correctionEvidence.diagnostics).toEqual([
      expect.objectContaining({
        gameStableKey: "nfl:2026:w1:kc@den",
        surface: "correction",
        outcome: "http_error",
      }),
    ]);
  });

  it("serializes concurrent cleanup starters without double-deleting", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (let index = 0; index < 150; index += 1) {
        await ctx.db.insert("providerRequestDiagnostics", {
          fingerprint: `concurrent-${index}`,
          provider: "api-sports",
          surface: "live",
          endpoint: "/games",
          outcome: "no_change",
          firstRecordedAtMs: NOW_MS - 1,
          lastRecordedAtMs: NOW_MS - 1,
          observationCount: 1,
          expiresAtMs: NOW_MS,
          retentionClass: "diagnostic_30d",
        });
      }
    });

    await Promise.all([
      t.mutation(
        internal.providerEvidence.cleanupExpiredDiagnostics,
        { cutoffMs: NOW_MS, batchSize: 100 },
      ),
      t.mutation(
        internal.providerEvidence.cleanupExpiredDiagnostics,
        { cutoffMs: NOW_MS, batchSize: 100 },
      ),
    ]);

    expect(
      await t.run(async (ctx) =>
        ctx.db.query("providerRequestDiagnostics").collect(),
      ),
    ).toEqual([]);
    expect(
      await t.run(async (ctx) =>
        ctx.db
          .query("providerDiagnosticCleanupRuns")
          .withIndex("by_key", (q) =>
            q.eq("key", "provider-diagnostics"),
          )
          .unique(),
      ),
    ).toMatchObject({
      status: "complete",
      deletedCount: 150,
    });
  });

  it("derives migration-era expiry from server timestamps at the exact boundary", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("providerFetchClaims", {
        surface: "live",
        status: "claimed",
        claimedAtMs: NOW_MS - 1,
        expiresAtMs: NOW_MS,
      });
      await ctx.db.insert("providerFetchClaims", {
        surface: "legacy",
        status: "claimed",
        claimedAtMs:
          NOW_MS - 30 * 24 * 60 * 60 * 1_000,
      });
      await ctx.db.insert("providerFetchClaims", {
        surface: "recent-legacy",
        status: "claimed",
        claimedAtMs:
          NOW_MS - 30 * 24 * 60 * 60 * 1_000 + 1,
      });
      await ctx.db.insert("providerExceptions", {
        kind: "sync_failure",
        scopeKey: "live:nfl",
        message: "Sanitized provider exception",
        createdAtMs: NOW_MS - 1,
        expiresAtMs: NOW_MS,
      });
      await ctx.db.insert("sportsDataStatusEvidence", {
        provider: "api-sports",
        externalId: "123",
        rawShort: "LEGACY",
        rawLong: "Legacy sanitized status",
        recognized: false,
        firstObservedAtMs: NOW_MS - 1,
        lastObservedAtMs: NOW_MS - 1,
        observationCount: 1,
        expiresAtMs: NOW_MS,
      });
    });

    const cleanup = await t.mutation(
      internal.providerEvidence.cleanupExpiredDiagnostics,
      { cutoffMs: NOW_MS, batchSize: 100 },
    );
    expect(cleanup).toMatchObject({
      deleted: 4,
      status: "complete",
    });
    const remaining = await t.run(async (ctx) => ({
      claims: await ctx.db.query("providerFetchClaims").collect(),
      exceptions: await ctx.db.query("providerExceptions").collect(),
      statuses: await ctx.db.query("sportsDataStatusEvidence").collect(),
    }));
    expect(remaining.claims).toEqual([
      expect.objectContaining({
        surface: "recent-legacy",
      }),
    ]);
    expect(remaining.claims[0]).not.toHaveProperty("expiresAtMs");
    expect(remaining.exceptions).toEqual([]);
    expect(remaining.statuses).toEqual([]);
  });
});
