/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { internal, api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const observedAtMs = Date.parse("2026-09-13T16:00:00Z");

const participantIdentity = {
  subject: "participant_schedule",
  issuer: "https://clerk.example.test",
  tokenIdentifier: "https://clerk.example.test|participant_schedule",
  name: "Schedule Participant",
  email: "participant@example.test",
  email_verified: true,
  phone_number: "+15555550199",
  phone_number_verified: true,
  sid: "session_schedule",
};

type Seeded = Awaited<ReturnType<typeof seedSchedule>>;

async function seedSchedule(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const seasonId = await ctx.db.insert("poolSeasons", {
      label: "2026",
      year: 2026,
      status: "available",
      usableStartWeek: 1,
      bootstrappedAtMs: observedAtMs - 30 * 24 * 60 * 60 * 1000,
    });
    const homeTeamId = await ctx.db.insert("nflTeams", {
      stableKey: "nfl-team:franchise-11",
      name: "Detroit Lions",
      abbreviation: "DET",
      logoUrl: "https://example.test/det.png",
    });
    const awayTeamId = await ctx.db.insert("nflTeams", {
      stableKey: "nfl-team:franchise-12",
      name: "Green Bay Packers",
      abbreviation: "GB",
      logoUrl: "https://example.test/gb.png",
    });
    const kickoffMs = observedAtMs + 60 * 60 * 1000;
    const gameId = await ctx.db.insert("nflGames", {
      stableKey: "nfl-game:2026:w1:franchise-12@franchise-11",
      seasonId,
      seasonLabel: "2026",
      week: 1,
      homeTeamId,
      awayTeamId,
      scheduledKickoffMs: kickoffMs,
      lifecycle: "scheduled",
      homeScore: null,
      awayScore: null,
    });
    await ctx.db.insert("nflGameAliases", {
      nflGameId: gameId,
      provider: "api-sports",
      externalId: "game-original",
      isCurrent: true,
      firstObservedAtMs: observedAtMs - 1,
      lastObservedAtMs: observedAtMs - 1,
    });
    await ctx.db.insert("nflGameScheduleHistory", {
      nflGameId: gameId,
      seasonId,
      week: 1,
      homeTeamId,
      awayTeamId,
      scheduledKickoffMs: kickoffMs,
      firstObservedAtMs: observedAtMs - 1,
      lastObservedAtMs: observedAtMs - 1,
    });
    const participantId = await ctx.db.insert("participants", {
      tokenIdentifier: participantIdentity.tokenIdentifier,
      clerkUserId: participantIdentity.subject,
      displayName: participantIdentity.name,
      email: participantIdentity.email,
      phone: participantIdentity.phone_number,
      emailVerified: true,
      phoneVerified: true,
      ageConfirmed: true,
      suspended: false,
      lastClerkSessionId: participantIdentity.sid,
    });
    const poolId = await ctx.db.insert("pools", {
      name: "Schedule Pool",
      type: "survivor",
      seasonId,
      startWeek: 1,
      pickLockMode: "gameKickoff",
      status: "active",
      rulesFrozen: false,
      ownerParticipantId: participantId,
      createdAtMs: observedAtMs - 1,
    });
    const membershipId = await ctx.db.insert("poolMemberships", {
      poolId,
      participantId,
      role: "owner",
      status: "active",
    });
    const entryId = await ctx.db.insert("poolEntries", {
      poolId,
      participantId,
      membershipId,
      entryNumber: 1,
      status: "active",
      createdAtMs: observedAtMs - 1,
    });
    const pickId = await ctx.db.insert("survivorPicks", {
      poolId,
      participantId,
      entryId,
      week: 1,
      nflTeamId: homeTeamId,
      gameId,
      locked: false,
      provenance: "authored",
      provisional: false,
      updatedAtMs: observedAtMs - 1,
    });
    return {
      seasonId,
      homeTeamId,
      awayTeamId,
      gameId,
      kickoffMs,
      poolId,
      pickId,
    };
  });
}

function scheduleObservation(
  seeded: Seeded,
  overrides: Record<string, unknown> = {},
) {
  return {
    seasonId: seeded.seasonId,
    observation: {
      seasonYear: 2026,
      week: 1,
      homeTeamAbbreviation: "DET" as const,
      awayTeamAbbreviation: "GB" as const,
      scheduledKickoffMs: seeded.kickoffMs + 3 * 60 * 60 * 1000,
      lifecycle: "scheduled" as const,
      observedAtMs,
      providerAlias: { provider: "api-sports" as const, id: "game-original" },
      providerStatus: {
        rawShort: "NS",
        rawLong: "Not Started",
        recognized: true,
      },
      ...overrides,
    },
  };
}

describe("API-Sports schedule synchronization", () => {
  const previousDeploymentKind = process.env.DEPLOYMENT_KIND;

  beforeAll(() => {
    process.env.DEPLOYMENT_KIND = "development";
  });

  afterAll(() => {
    if (previousDeploymentKind === undefined) {
      delete process.env.DEPLOYMENT_KIND;
    } else {
      process.env.DEPLOYMENT_KIND = previousDeploymentKind;
    }
  });

  beforeEach(() => {
    delete process.env.SENTRY_DSN;
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
  });

  it("updates an exact alias and exposes the new schedule to participants", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedSchedule(t);

    const result = await t.mutation(
      internal.syncSchedule.applyScheduleGameObservation,
      scheduleObservation(seeded),
    );

    expect(result).toMatchObject({ status: "applied", gameId: seeded.gameId });
    const participantSchedule = await t
      .withIdentity(participantIdentity)
      .query(api.syncSchedule.getParticipantPoolSchedule, {
        poolId: seeded.poolId,
        week: 1,
      });
    expect(participantSchedule).toMatchObject([
      {
        gameId: seeded.gameId,
        scheduledKickoffMs: seeded.kickoffMs + 3 * 60 * 60 * 1000,
        lifecycle: "scheduled",
        locked: false,
      },
    ]);
  });

  it("attaches one exact replacement record and preserves the NFL Game identity", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedSchedule(t);

    const result = await t.mutation(
      internal.syncSchedule.applyScheduleGameObservation,
      scheduleObservation(seeded, {
        providerAlias: {
          provider: "api-sports",
          id: "game-replacement",
        },
      }),
    );
    const aliases = await t.run(async (ctx) =>
      await ctx.db
        .query("nflGameAliases")
        .withIndex("by_nflGameId_and_provider_and_isCurrent", (q) =>
          q.eq("nflGameId", seeded.gameId).eq("provider", "api-sports"),
        )
        .take(10),
    );

    expect(result).toMatchObject({ status: "applied", gameId: seeded.gameId });
    expect(aliases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          externalId: "game-original",
          isCurrent: false,
        }),
        expect.objectContaining({
          externalId: "game-replacement",
          isCurrent: true,
        }),
      ]),
    );
  });

  it("preserves state and deduplicates incidents for an unresolved replacement", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedSchedule(t);
    const unresolved = scheduleObservation(seeded, {
      providerAlias: { provider: "api-sports", id: "unknown-game" },
      homeTeamAbbreviation: "GB",
      awayTeamAbbreviation: "DET",
    });

    const first = await t.mutation(
      internal.syncSchedule.applyScheduleGameObservation,
      unresolved,
    );
    const second = await t.mutation(
      internal.syncSchedule.applyScheduleGameObservation,
      unresolved,
    );
    const state = await t.run(async (ctx) => ({
      game: await ctx.db.get(seeded.gameId),
      incidents: await ctx.db.query("operatorIncidents").take(10),
    }));

    expect(first).toMatchObject({ status: "unresolved" });
    expect(second).toMatchObject({ status: "unresolved" });
    expect(state.game?.scheduledKickoffMs).toBe(seeded.kickoffMs);
    expect(state.incidents).toHaveLength(1);
    expect(state.incidents[0]).toMatchObject({
      status: "open",
      surface: "schedule",
    });
  });

  it("preserves state and opens one incident for multiple exact candidates", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedSchedule(t);
    const duplicateId = await t.run(async (ctx) =>
      await ctx.db.insert("nflGames", {
        stableKey: "nfl-game:2026:w1:franchise-12@franchise-11:duplicate",
        seasonId: seeded.seasonId,
        seasonLabel: "2026",
        week: 1,
        homeTeamId: seeded.homeTeamId,
        awayTeamId: seeded.awayTeamId,
        scheduledKickoffMs: seeded.kickoffMs + 1,
        lifecycle: "scheduled",
        homeScore: null,
        awayScore: null,
      }),
    );

    const result = await t.mutation(
      internal.syncSchedule.applyScheduleGameObservation,
      scheduleObservation(seeded, {
        providerAlias: { provider: "api-sports", id: "ambiguous" },
      }),
    );
    const state = await t.run(async (ctx) => ({
      original: await ctx.db.get(seeded.gameId),
      duplicate: await ctx.db.get(duplicateId),
      incidents: await ctx.db.query("operatorIncidents").take(10),
    }));

    expect(result.status).toBe("unresolved");
    expect(state.original?.scheduledKickoffMs).toBe(seeded.kickoffMs);
    expect(state.duplicate?.scheduledKickoffMs).toBe(seeded.kickoffMs + 1);
    expect(state.incidents).toHaveLength(1);
  });

  it("stores unknown status evidence while preserving trusted lifecycle", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedSchedule(t);
    const unknown = scheduleObservation(seeded, {
      lifecycle: "unknown",
      providerStatus: {
        rawShort: "MYSTERY",
        rawLong: "New Provider Status",
        recognized: false,
      },
    });

    await t.mutation(
      internal.syncSchedule.applyScheduleGameObservation,
      unknown,
    );
    await t.mutation(
      internal.syncSchedule.applyScheduleGameObservation,
      unknown,
    );
    const state = await t.run(async (ctx) => ({
      game: await ctx.db.get(seeded.gameId),
      evidence: await ctx.db
        .query("sportsDataStatusEvidence")
        .take(10),
      diagnostics: await ctx.db
        .query("providerRequestDiagnostics")
        .withIndex(
          "by_nflGameId_and_lastRecordedAtMs",
          (q) => q.eq("nflGameId", seeded.gameId),
        )
        .take(10),
      incidents: await ctx.db.query("operatorIncidents").take(10),
    }));

    expect(state.game?.lifecycle).toBe("scheduled");
    expect(state.evidence).toEqual([]);
    expect(state.diagnostics).toEqual([
      expect.objectContaining({
        provider: "api-sports",
        requestExternalId: "game-original",
        outcome: "quarantined",
        observationCount: 2,
        nflGameId: seeded.gameId,
        retentionClass: "diagnostic_30d",
      }),
    ]);
    expect(state.incidents).toHaveLength(1);
  });

  it("quarantines a started schedule lifecycle weeks before kickoff without latching the Pick Lock", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedSchedule(t);
    const futureKickoffMs =
      observedAtMs + 45 * 24 * 60 * 60 * 1_000;

    const result = await t.mutation(
      internal.syncSchedule.applyScheduleGameObservation,
      scheduleObservation(seeded, {
        scheduledKickoffMs: futureKickoffMs,
        lifecycle: "terminal",
        providerStatus: {
          rawShort: "FT",
          rawLong: "Finished",
          recognized: true,
        },
      }),
    );

    expect(result.status).toBe("outside_live_window");
    const mismatchedKickoffResult = await t.mutation(
      internal.syncSchedule.applyScheduleGameObservation,
      scheduleObservation(seeded, {
        scheduledKickoffMs: observedAtMs - 1,
        lifecycle: "terminal",
        providerStatus: {
          rawShort: "FT",
          rawLong: "Finished",
          recognized: true,
        },
      }),
    );
    expect(mismatchedKickoffResult.status).toBe(
      "outside_live_window",
    );
    const state = await t.run(async (ctx) => ({
      game: await ctx.db.get(seeded.gameId),
      incidents: await ctx.db.query("operatorIncidents").take(10),
      diagnostics: await ctx.db
        .query("providerRequestDiagnostics")
        .withIndex(
          "by_nflGameId_and_lastRecordedAtMs",
          (q) => q.eq("nflGameId", seeded.gameId),
        )
        .take(10),
    }));
    expect(state.game).toMatchObject({
      scheduledKickoffMs: seeded.kickoffMs,
      lifecycle: "scheduled",
      homeScore: null,
      awayScore: null,
    });
    expect(state.game?.kickoffLockReachedAtMs).toBeUndefined();
    expect(state.incidents).toHaveLength(1);
    expect(state.incidents[0]).toMatchObject({
      status: "open",
      surface: "schedule",
      participantVisible: false,
      maintenanceLock: false,
    });
    expect(state.diagnostics).toEqual([
      expect.objectContaining({
        nflGameId: seeded.gameId,
        outcome: "quarantined",
      }),
    ]);

    const recovery = await t.mutation(
      internal.syncSchedule.applyScheduleGameObservation,
      scheduleObservation(seeded),
    );
    expect(recovery.status).toBe("applied");
    const incidentsAfterRecovery = await t.run(async (ctx) =>
      ctx.db.query("operatorIncidents").take(10),
    );
    expect(incidentsAfterRecovery).toEqual([
      expect.objectContaining({
        scopeKey: `game:${seeded.gameId}:outside-live-window`,
        status: "resolved",
        resolvedAutomatically: true,
        participantVisible: false,
      }),
    ]);
  });

  it("latches a newly discovered earlier kickoff without rewriting accepted picks", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedSchedule(t);
    const earlierKickoffMs = observedAtMs - 1;

    await t.mutation(
      internal.syncSchedule.applyScheduleGameObservation,
      scheduleObservation(seeded, {
        scheduledKickoffMs: earlierKickoffMs,
      }),
    );
    const state = await t.run(async (ctx) => ({
      game: await ctx.db.get(seeded.gameId),
      pick: await ctx.db.get(seeded.pickId),
    }));

    expect(state.game?.kickoffLockReachedAtMs).toBe(observedAtMs);
    expect(state.pick).toMatchObject({
      nflTeamId: seeded.homeTeamId,
      locked: false,
      updatedAtMs: observedAtMs - 1,
    });
  });

  it("isolates an unresolved NFL Game while applying valid batch siblings", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedSchedule(t);

    const summary = await t.action(
      internal.syncSchedule.applyScheduleObservationBatch,
      {
        observations: [
          scheduleObservation(seeded, {
            providerAlias: { provider: "api-sports", id: "unresolved" },
            homeTeamAbbreviation: "GB",
            awayTeamAbbreviation: "DET",
          }),
          scheduleObservation(seeded),
        ],
      },
    );

    expect(summary).toMatchObject({
      observed: 2,
      applied: 1,
      unresolved: 1,
      failed: 0,
    });
    expect((await t.run((ctx) => ctx.db.get(seeded.gameId)))?.scheduledKickoffMs)
      .toBe(seeded.kickoffMs + 3 * 60 * 60 * 1000);
  });

  it("queues one coalesced schedule claim through the shared dispatcher", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedSchedule(t);
    await t.mutation(internal.sync.ensureSyncGate, { enabled: true });

    const first = await t.mutation(
      internal.syncLive.dispatchSyncWork,
      { nowMs: observedAtMs, maxClaims: 1 },
    );
    const rowsAfterFirst = await t.run(async (ctx) =>
      await ctx.db
        .query("syncWorkItems")
        .withIndex("by_scopeKey", (q) =>
          q.eq("scopeKey", `schedule:${seeded.seasonId}`),
        )
        .take(10),
    );

    expect(first.claimed).toEqual([
      expect.objectContaining({
        surface: "schedule",
        scopeKey: `schedule:${seeded.seasonId}`,
      }),
    ]);
    expect(rowsAfterFirst).toHaveLength(1);
    expect(rowsAfterFirst[0]?.status).toBe("claimed");
  });

  it("polls an Available preseason slate live without routine schedule sync", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedSchedule(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(seeded.seasonId, {
        competitionPhase: "preseason",
      });
      await ctx.db.patch(seeded.gameId, {
        scheduledKickoffMs: observedAtMs + 5 * 60 * 1000,
      });
    });
    await t.mutation(internal.sync.ensureSyncGate, { enabled: true });

    await t.mutation(internal.syncLive.dispatchSyncWork, {
      nowMs: observedAtMs,
      maxClaims: 0,
    });
    const work = await t.run(async (ctx) =>
      await ctx.db.query("syncWorkItems").take(10),
    );

    expect(work.some((item) => item.surface === "schedule")).toBe(false);
    expect(work.some((item) => item.surface === "live")).toBe(true);
  });

  it("bounds phase-aware work to four Available Seasons", async () => {
    const t = convexTest(schema, modules);
    const seasonIds = await t.run(async (ctx) => {
      const ids = [];
      for (let index = 0; index < 5; index += 1) {
        ids.push(
          await ctx.db.insert("poolSeasons", {
            label: `202${index}`,
            year: 2020 + index,
            status: "available",
            usableStartWeek: 1,
          }),
        );
      }
      return ids;
    });
    await t.mutation(internal.sync.ensureSyncGate, { enabled: true });

    await t.mutation(internal.syncLive.dispatchSyncWork, {
      nowMs: observedAtMs,
      maxClaims: 0,
    });
    const scheduleWork = await t.run(async (ctx) =>
      await ctx.db.query("syncWorkItems").take(10),
    );

    expect(seasonIds).toHaveLength(5);
    expect(scheduleWork.filter((item) => item.surface === "schedule"))
      .toHaveLength(4);
  });

  it("bounds active-window inspection to 400 NFL Games per season", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const seasonId = await ctx.db.insert("poolSeasons", {
        label: "2026",
        year: 2026,
        status: "available",
        usableStartWeek: 1,
      });
      const homeTeamId = await ctx.db.insert("nflTeams", {
        stableKey: "nfl-team:franchise-11",
        name: "Detroit Lions",
        abbreviation: "DET",
      });
      const awayTeamId = await ctx.db.insert("nflTeams", {
        stableKey: "nfl-team:franchise-12",
        name: "Green Bay Packers",
        abbreviation: "GB",
      });
      for (let index = 0; index < 401; index += 1) {
        await ctx.db.insert("nflGames", {
          stableKey: `bounded-game:${index}`,
          seasonId,
          seasonLabel: "2026",
          week: 1,
          homeTeamId,
          awayTeamId,
          scheduledKickoffMs:
            index === 400
              ? observedAtMs + 5 * 60 * 1000
              : observedAtMs + 30 * 24 * 60 * 60 * 1000,
          lifecycle: "scheduled",
          homeScore: null,
          awayScore: null,
        });
      }
    });
    await t.mutation(internal.sync.ensureSyncGate, { enabled: true });

    await t.mutation(internal.syncLive.dispatchSyncWork, {
      nowMs: observedAtMs,
      maxClaims: 0,
    });
    const work = await t.run(async (ctx) =>
      await ctx.db.query("syncWorkItems").take(10),
    );

    expect(work.some((item) => item.surface === "schedule")).toBe(true);
    expect(work.some((item) => item.surface === "live")).toBe(false);
  });

  it("keeps only sanitized status diagnostics on the Production Operator surface", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedSchedule(t);
    await t.mutation(
      internal.syncSchedule.applyScheduleGameObservation,
      scheduleObservation(seeded, {
        lifecycle: "unknown",
        providerStatus: {
          rawShort: "MYSTERY",
          rawLong:
            "Bearer provider-secret-canary participant-canary@example.com",
          recognized: false,
        },
      }),
    );
    await t.run(async (ctx) => {
      for (let index = 0; index < 101; index += 1) {
        await ctx.db.insert("operatorIncidents", {
          type: "provider_exception",
          status: "open",
          surface: "live",
          scopeKey: `live:${index}`,
          dedupeKey: `provider_exception:live:${index}`,
          participantVisible: true,
          summary: "Scores delayed.",
          openedAtMs: observedAtMs + index + 1,
          maintenanceLock: false,
        });
      }
    });

    const previousOperator =
      process.env.PRODUCTION_OPERATOR_CLERK_USER_ID;
    process.env.PRODUCTION_OPERATOR_CLERK_USER_ID = "schedule_operator";
    try {
      const operator = t.withIdentity({
        ...participantIdentity,
        subject: "schedule_operator",
        tokenIdentifier:
          "https://clerk.example.test|schedule_operator",
      });
      const state = await operator.query(
        api.syncSchedule.listOperatorScheduleEvidence,
        {},
      );
      expect(state.evidence).toEqual([]);
      const diagnostics = await operator.query(
        api.providerEvidence.listOperatorGameEvidence,
        { gameId: seeded.gameId },
      );
      expect(diagnostics).not.toBeNull();
      expect(diagnostics!.diagnostics).toEqual([
        expect.objectContaining({
          outcome: "quarantined",
          providerStatus: {
            short: "MYSTERY",
            long: null,
            fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
            redacted: true,
          },
          request: expect.objectContaining({
            externalId: "game-original",
          }),
        }),
      ]);
      expect(JSON.stringify(diagnostics)).not.toMatch(
        /provider-secret-canary|participant-canary@example\.com/,
      );
      for (let page = 1; page <= 55; page += 1) {
        await t.mutation(
          internal.providerEvidence.recordApiSportsDiagnostic,
          {
            surface: "schedule",
            scopeKey: `game:${seeded.gameId}`,
            gameId: seeded.gameId,
            endpoint: "/games",
            parameters: { page },
            outcome: "no_change",
          },
        );
      }
      const persistedProviderEvidence = await t.run(async (ctx) => ({
        diagnostics: await ctx.db
          .query("providerRequestDiagnostics")
          .collect(),
        statusEvidence: await ctx.db
          .query("sportsDataStatusEvidence")
          .collect(),
        incidents: await ctx.db.query("operatorIncidents").collect(),
      }));
      expect(JSON.stringify(persistedProviderEvidence)).not.toMatch(
        /provider-secret-canary|participant-canary@example\.com/,
      );
      const scheduleIncident =
        persistedProviderEvidence.incidents.find(
          (incident) => incident.surface === "schedule",
        );
      expect(scheduleIncident).toBeDefined();
      const incidentEvidence = await operator.query(
        api.providerEvidence.listOperatorIncidentEvidence,
        { incidentId: scheduleIncident!._id, limit: 10 },
      );
      expect(incidentEvidence.diagnostics).toEqual([
        expect.objectContaining({
          outcome: "quarantined",
          providerStatus: expect.objectContaining({
            redacted: true,
          }),
        }),
      ]);
      expect(state.incidents).toHaveLength(1);
      expect(state.incidents[0]?.surface).toBe("schedule");
    } finally {
      if (previousOperator === undefined) {
        delete process.env.PRODUCTION_OPERATOR_CLERK_USER_ID;
      } else {
        process.env.PRODUCTION_OPERATOR_CLERK_USER_ID =
          previousOperator;
      }
    }
  });
});
