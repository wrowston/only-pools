/// <reference types="vite/client" />
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "./_generated/api";
import {
  LEGACY_CONTRACTION_MAX_BATCH_BYTES_READ,
  LEGACY_CONTRACTION_MAX_BATCH_SIZE,
} from "./legacyContractionMigration";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const NOW_MS = Date.UTC(2026, 8, 14, 20);

type MigrationResult = Readonly<{
  phase: string;
  visited: number;
  removed: number;
  readyToComplete: boolean;
  completed: boolean;
}>;

const runBatch = makeFunctionReference<
  "mutation",
  { batchSize?: number },
  MigrationResult
>("legacyContractionMigration:runBatch");

const complete = makeFunctionReference<
  "mutation",
  Record<string, never>,
  MigrationResult & { refusalReason?: string }
>("legacyContractionMigration:complete");

const applyLegacyLiveObservation = makeFunctionReference<
  "mutation",
  {
    observation: {
      gameId: string;
      observedAtMs: number;
      lifecycle: "in_progress";
      homeScore: number;
      awayScore: number;
    };
  },
  unknown
>("syncLive:applyLiveObservation");

const applyApiSportsObservation = makeFunctionReference<
  "mutation",
  {
    observation: {
      externalId: string;
      observedAtMs: number;
      lifecycle: "in_progress";
      homeScore: number;
      awayScore: number;
      providerStatus: {
        rawShort: string;
        rawLong: string;
        recognized: boolean;
        terminal: boolean;
      };
    };
  },
  unknown
>("syncApiSportsLive:applyObservation");

const dispatchSyncWork = makeFunctionReference<
  "mutation",
  { nowMs?: number; maxClaims?: number },
  { denied: string | null; claimed: unknown[] }
>("syncLive:dispatchSyncWork");

const enableSyncGate = makeFunctionReference<
  "mutation",
  { enabled: boolean; actorTokenIdentifier?: string },
  unknown
>("sync:ensureSyncGate");

const seedDemoWorld = makeFunctionReference<
  "mutation",
  Record<string, never>,
  unknown
>("seedDemo:seedDemoWorld");

const openLegacyIncident = makeFunctionReference<
  "mutation",
  {
    type: "quarantine_past_confirmation";
    surface: string;
    scopeKey: string;
    participantVisible: boolean;
  },
  unknown
>("incidents:openIncidentForTest");

const runLegacyFetch = makeFunctionReference<
  "action",
  {
    workItemId: string;
    surface: string;
    gameId?: string;
    purpose?: string;
  },
  unknown
>("syncLive:runClaimedFetch");

const runCurrentLiveFetch = makeFunctionReference<
  "action",
  { workItemId: string },
  unknown
>("syncApiSportsLive:runClaimedLiveFetch");

const runCurrentScheduleFetch = makeFunctionReference<
  "action",
  { workItemId: string; seasonId: string },
  unknown
>("syncSchedule:runClaimedScheduleFetch");

function identity(subject: string) {
  return {
    subject,
    issuer: "https://auth.example.test",
    tokenIdentifier: `https://auth.example.test|${subject}`,
    email: `${subject}@example.test`,
    emailVerified: true,
    phoneNumber: "+15551234567",
    phoneNumberVerified: true,
    sid: `session_${subject}`,
  };
}

async function establishOperator(
  t: ReturnType<typeof convexTest>,
  withStepUp = true,
) {
  const asOperator = t.withIdentity(identity("operator"));
  const { participantId } = await asOperator.mutation(
    api.participants.ensureMyParticipant,
    {},
  );
  if (withStepUp) {
    await t.run(async (ctx) => {
      const participant = await ctx.db.get(participantId);
      if (!participant) throw new Error("fixture participant missing");
      await ctx.db.patch(participant._id, {
        operatorStepUpVerifiedAtMs: NOW_MS,
        operatorStepUpSessionId: "session_operator",
      });
    });
  }
  return asOperator;
}

const historicalEvidenceState = {
  scheduledKickoffMs: NOW_MS - 60_000,
  kickoffLockReachedAtMs: NOW_MS - 60_000,
  lifecycle: "terminal" as const,
  homeScore: 21,
  awayScore: 17,
  resultAuthority: "confirmation_pending" as const,
  verifiedResult: null,
  correctionCandidate: null,
  pinned: false,
};

async function seedLegacyRows(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    await ctx.db.insert("operatorAuditEvents", {
      action: "season_bootstrap_clean_activated",
      actorTokenIdentifier: "operator-token",
      actorClerkUserId: "operator",
      atMs: NOW_MS - 120_000,
      detailsJson: JSON.stringify({ seasonYear: 2026, status: "activated" }),
    });
    const seasonId = await ctx.db.insert("poolSeasons", {
      label: "2026",
      year: 2026,
      status: "available",
      usableStartWeek: 1,
    });
    const teamIds = [];
    for (const [index, abbreviation] of ["DEN", "KC", "BUF"].entries()) {
      teamIds.push(
        await ctx.db.insert("nflTeams", {
          stableKey: `team:${abbreviation}`,
          name: `Team ${abbreviation}`,
          abbreviation,
          sportsDbTeamId: `legacy-team-${index}`,
        }),
      );
    }
    const gameIds = [];
    for (let index = 0; index < 3; index += 1) {
      gameIds.push(
        await ctx.db.insert("nflGames", {
          stableKey: `game:${index}`,
          seasonId,
          seasonLabel: "2026",
          week: index + 1,
          homeTeamId: teamIds[index % teamIds.length]!,
          awayTeamId: teamIds[(index + 1) % teamIds.length]!,
          scheduledKickoffMs: NOW_MS + index * 60_000,
          lifecycle: "scheduled",
          homeScore: index === 0 ? 21 : null,
          awayScore: index === 0 ? 17 : null,
          sportsDbEventId: `legacy-game-${index}`,
          resultAuthority:
            index === 0 ? "confirmation_pending" : "none",
          provisionalTerminalAtMs:
            index === 0 ? NOW_MS - 30_000 : undefined,
          confirmationObservations:
            index === 0
              ? [
                  {
                    observedAtMs: NOW_MS - 30_000,
                    homeScore: 21,
                    awayScore: 17,
                    status: "FT",
                  },
                ]
              : undefined,
        }),
      );
    }
    const confirmationWorkId = await ctx.db.insert("syncWorkItems", {
      surface: "confirmation",
      scopeKey: "confirmation:game:0",
      priority: "confirmation",
      status: "claimed",
      dueAtMs: NOW_MS - 10_000,
      claimedAtMs: NOW_MS - 9_000,
      leaseExpiresAtMs: NOW_MS + 30_000,
      attemptCount: 1,
      gameId: gameIds[0],
    });
    const confirmationPriorityWorkId = await ctx.db.insert(
      "syncWorkItems",
      {
        surface: "live",
        scopeKey: "live:legacy-confirmation-priority",
        priority: "confirmation",
        status: "due",
        dueAtMs: NOW_MS,
        attemptCount: 0,
        gameId: gameIds[0],
      },
    );
    const routineWorkId = await ctx.db.insert("syncWorkItems", {
      surface: "live",
      scopeKey: "live:preserved",
      priority: "routine",
      status: "due",
      dueAtMs: NOW_MS,
      attemptCount: 0,
      gameId: gameIds[1],
    });
    const confirmationClaimId = await ctx.db.insert(
      "providerFetchClaims",
      {
        surface: "confirmation",
        status: "claimed",
        claimedAtMs: NOW_MS - 8_000,
        priority: "confirmation",
        workItemId: confirmationWorkId,
      },
    );
    const confirmationPriorityClaimId = await ctx.db.insert(
      "providerFetchClaims",
      {
        surface: "live",
        status: "claimed",
        claimedAtMs: NOW_MS - 7_000,
        priority: "confirmation",
        workItemId: confirmationPriorityWorkId,
      },
    );
    const routineClaimId = await ctx.db.insert("providerFetchClaims", {
      surface: "live",
      status: "claimed",
      claimedAtMs: NOW_MS - 6_000,
      priority: "routine",
      workItemId: routineWorkId,
    });
    const quarantineIncidentId = await ctx.db.insert(
      "operatorIncidents",
      {
        type: "quarantine_past_confirmation",
        status: "open",
        surface: "confirmation",
        scopeKey: "confirmation:game:0",
        dedupeKey: "quarantine:game:0",
        participantVisible: false,
        summary: "Legacy confirmation quarantine",
        openedAtMs: NOW_MS - 5_000,
        maintenanceLock: false,
      },
    );
    const providerIncidentId = await ctx.db.insert("operatorIncidents", {
      type: "provider_exception",
      status: "open",
      surface: "live",
      scopeKey: "live:nfl",
      dedupeKey: "provider:live:nfl",
      participantVisible: false,
      summary: "Preserved provider exception",
      openedAtMs: NOW_MS - 4_000,
      maintenanceLock: false,
    });
    const overrideId = await ctx.db.insert("nflGameResultOverrides", {
      nflGameId: gameIds[0],
      gameStableKey: "game:0",
      seasonLabel: "2026",
      gameWeek: 1,
      homeTeamAbbreviation: "DEN",
      awayTeamAbbreviation: "KC",
      status: "released",
      reason: "Legacy fixture",
      replacedResult: {
        homeScore: 21,
        awayScore: 17,
        verifiedAtMs: NOW_MS - 40_000,
        status: "FT",
      },
      overrideResult: {
        homeScore: 24,
        awayScore: 17,
        verifiedAtMs: NOW_MS - 30_000,
        status: "FT",
      },
      actorTokenIdentifier: "operator-token",
      actorClerkUserId: "operator",
      pinnedAtMs: NOW_MS - 30_000,
      releaseReason: "Historical fixture",
      releasedAtMs: NOW_MS - 20_000,
      releasedByTokenIdentifier: "operator-token",
      releasedByClerkUserId: "operator",
    });
    const overrideEvidenceId = await ctx.db.insert(
      "nflGameResultOverrideEvidence",
      {
        overrideId,
        observedAtMs: NOW_MS - 25_000,
        homeScore: 24,
        awayScore: 17,
        status: "FT",
        disposition: "pinned_matching",
        source: "legacy_confirmation",
      },
    );
    const providerEvidenceId = await ctx.db.insert(
      "providerGameEvidence",
      {
        nflGameId: gameIds[0],
        gameStableKey: "game:0",
        seasonLabel: "2026",
        gameWeek: 1,
        homeTeamAbbreviation: "DEN",
        awayTeamAbbreviation: "KC",
        provider: "legacy",
        externalId: "legacy-game-0",
        source: "live",
        transitionKind: "terminal",
        changedFields: ["lifecycle", "homeScore", "awayScore"],
        before: null,
        after: historicalEvidenceState,
        fingerprint: "legacy-evidence-fingerprint",
        observedAtMs: NOW_MS - 25_000,
        recordedAtMs: NOW_MS - 24_000,
      },
    );
    return {
      seasonId,
      teamIds,
      gameIds,
      overrideId,
      overrideEvidenceId,
      providerEvidenceId,
      confirmationWorkId,
      confirmationPriorityWorkId,
      routineWorkId,
      confirmationClaimId,
      confirmationPriorityClaimId,
      routineClaimId,
      quarantineIncidentId,
      providerIncidentId,
    };
  });
}

describe("legacy owner-field contraction migration", () => {
  const previousOperator =
    process.env.PRODUCTION_OPERATOR_CLERK_USER_ID;

  beforeEach(() => {
    process.env.PRODUCTION_OPERATOR_CLERK_USER_ID = "operator";
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
  });

  afterEach(() => {
    vi.useRealTimers();
    if (previousOperator === undefined) {
      delete process.env.PRODUCTION_OPERATOR_CLERK_USER_ID;
    } else {
      process.env.PRODUCTION_OPERATOR_CLERK_USER_ID = previousOperator;
    }
  });

  it("requires the allowlisted Production Operator with fresh step-up", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(runBatch, {})).rejects.toThrow(
      /Unauthenticated/,
    );
    const asOperator = await establishOperator(t, false);
    await expect(asOperator.mutation(runBatch, {})).rejects.toThrow(
      /Fresh Step-up Verification/,
    );
  });

  it("requires successful clean activation before creating the durable lock", async () => {
    const t = convexTest(schema, modules);
    const asOperator = await establishOperator(t);
    await expect(asOperator.mutation(runBatch, {})).rejects.toThrow(
      /clean Season Bootstrap activation is required/i,
    );
    const rows = await t.run((ctx) =>
      ctx.db.query("operatorAuditEvents").collect(),
    );
    expect(
      rows.some(
        (row) => row.action === "legacy_contract_migration_locked_v1",
      ),
    ).toBe(false);
  });

  it("contracts every legacy state in bounded resumable batches and preserves evidence exactly", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedLegacyRows(t);
    const before = await t.run(async (ctx) => ({
      overrideEvidence: await ctx.db.get(fixture.overrideEvidenceId),
      providerEvidence: await ctx.db.get(fixture.providerEvidenceId),
    }));
    const asOperator = await establishOperator(t);

    let result = await asOperator.mutation(runBatch, { batchSize: 2 });
    expect(result.visited).toBeLessThanOrEqual(2);
    expect(result.completed).toBe(false);
    for (let attempts = 0; !result.readyToComplete; attempts += 1) {
      expect(attempts).toBeLessThan(20);
      result = await asOperator.mutation(runBatch, { batchSize: 2 });
      expect(result.visited).toBeLessThanOrEqual(2);
    }

    const ready = await t.run(async (ctx) => ({
      teams: await Promise.all(fixture.teamIds.map((id) => ctx.db.get(id))),
      games: await Promise.all(fixture.gameIds.map((id) => ctx.db.get(id))),
      overrideEvidence: await ctx.db.get(fixture.overrideEvidenceId),
      providerEvidence: await ctx.db.get(fixture.providerEvidenceId),
      audits: await ctx.db
        .query("operatorAuditEvents")
        .withIndex("by_atMs")
        .collect(),
      gate: await ctx.db
        .query("syncGate")
        .withIndex("by_key", (q) => q.eq("key", "deployment"))
        .unique(),
      confirmationWork: await ctx.db.get(fixture.confirmationWorkId),
      confirmationPriorityWork: await ctx.db.get(
        fixture.confirmationPriorityWorkId,
      ),
      routineWork: await ctx.db.get(fixture.routineWorkId),
      confirmationClaim: await ctx.db.get(fixture.confirmationClaimId),
      confirmationPriorityClaim: await ctx.db.get(
        fixture.confirmationPriorityClaimId,
      ),
      routineClaim: await ctx.db.get(fixture.routineClaimId),
      quarantineIncident: await ctx.db.get(fixture.quarantineIncidentId),
      providerIncident: await ctx.db.get(fixture.providerIncidentId),
    }));
    expect(
      ready.teams.every(
        (team) => team && team.sportsDbTeamId === undefined,
      ),
    ).toBe(true);
    expect(
      ready.games.every(
        (game) =>
          game &&
          game.sportsDbEventId === undefined &&
          game.resultAuthority !== "confirmation_pending" &&
          game.provisionalTerminalAtMs === undefined &&
          game.confirmationObservations === undefined,
      ),
    ).toBe(true);
    expect(ready.games[0]?.resultAuthority).toBe("projected");
    expect(ready.confirmationWork).toBeNull();
    expect(ready.confirmationPriorityWork).toBeNull();
    expect(ready.routineWork).not.toBeNull();
    expect(ready.confirmationClaim).toBeNull();
    expect(ready.confirmationPriorityClaim).toBeNull();
    expect(ready.routineClaim).not.toBeNull();
    expect(ready.quarantineIncident).toBeNull();
    expect(ready.providerIncident).not.toBeNull();
    expect(ready.overrideEvidence).toEqual(before.overrideEvidence);
    expect(ready.providerEvidence).toEqual(before.providerEvidence);
    expect(ready.gate).toMatchObject({ enabled: false });
    expect(
      ready.audits.filter(
        (event) =>
          event.action === "legacy_contract_migration_locked_v1",
      ),
    ).toHaveLength(1);
    expect(
      ready.audits.some((event) =>
        event.detailsJson?.includes('"preservedEvidenceRows":1'),
      ),
    ).toBe(true);

    const completed = await asOperator.mutation(complete, {});
    expect(completed.completed).toBe(true);
  });

  it("refuses completion until every category is traversed and re-audits post-audit legacy evidence", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedLegacyRows(t);
    const asOperator = await establishOperator(t);

    const early = await asOperator.mutation(complete, {});
    expect(early).toMatchObject({
      completed: false,
      refusalReason: "categories_not_traversed",
    });

    let result = await asOperator.mutation(runBatch, { batchSize: 10 });
    while (!result.readyToComplete) {
      result = await asOperator.mutation(runBatch, { batchSize: 10 });
    }
    await t.run((ctx) =>
      ctx.db.patch(fixture.teamIds[0]!, {
        sportsDbTeamId: "late-legacy-owner-field",
      }),
    );
    expect(await asOperator.mutation(complete, {})).toMatchObject({
      completed: false,
      refusalReason: "legacy_owner_fields_remaining",
    });
    do {
      result = await asOperator.mutation(runBatch, { batchSize: 10 });
    } while (!result.readyToComplete);

    const appendedEvidenceId = await t.run(async (ctx) =>
      ctx.db.insert("nflGameResultOverrideEvidence", {
        overrideId: fixture.overrideId,
        observedAtMs: NOW_MS - 5_000,
        homeScore: 27,
        awayScore: 17,
        status: "FT",
        disposition: "pinned_conflicting",
        source: "legacy_live",
      }),
    );
    const refused = await asOperator.mutation(complete, {});
    expect(refused).toMatchObject({
      completed: false,
      refusalReason: "post_audit_legacy_evidence",
    });

    do {
      result = await asOperator.mutation(runBatch, { batchSize: 10 });
    } while (!result.readyToComplete);
    expect((await asOperator.mutation(complete, {})).completed).toBe(true);
    const appended = await t.run((ctx) => ctx.db.get(appendedEvidenceId));
    expect(appended?.source).toBe("legacy_live");
  });

  it("restarts after completion when strict-incompatible state is injected", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedLegacyRows(t);
    const asOperator = await establishOperator(t);
    let result = await asOperator.mutation(runBatch, { batchSize: 50 });
    while (!result.readyToComplete) {
      result = await asOperator.mutation(runBatch, { batchSize: 50 });
    }
    expect((await asOperator.mutation(complete, {})).completed).toBe(true);

    await t.run(async (ctx) => {
      await ctx.db.patch(fixture.gameIds[1]!, {
        resultAuthority: "confirmation_pending",
        provisionalTerminalAtMs: NOW_MS,
        confirmationObservations: [
          {
            observedAtMs: NOW_MS,
            homeScore: 10,
            awayScore: 7,
            status: "FT",
          },
        ],
      });
      await ctx.db.insert("syncWorkItems", {
        surface: "confirmation",
        scopeKey: "late-confirmation",
        priority: "confirmation",
        status: "due",
        dueAtMs: NOW_MS,
        attemptCount: 0,
      });
    });

    result = await asOperator.mutation(runBatch, { batchSize: 50 });
    expect(result.completed).toBe(false);
    expect(result.phase).not.toBe("complete");
    while (!result.readyToComplete) {
      result = await asOperator.mutation(runBatch, { batchSize: 50 });
    }
    expect((await asOperator.mutation(complete, {})).completed).toBe(true);
    const repaired = await t.run(async (ctx) => ({
      game: await ctx.db.get(fixture.gameIds[1]!),
      work: await ctx.db
        .query("syncWorkItems")
        .filter((q) => q.eq(q.field("surface"), "confirmation"))
        .first(),
    }));
    expect(repaired.game).toMatchObject({ resultAuthority: "projected" });
    expect(repaired.game?.provisionalTerminalAtMs).toBeUndefined();
    expect(repaired.game?.confirmationObservations).toBeUndefined();
    expect(repaired.work).toBeNull();
  });

  it("fences legacy and current provider dispatch, apply, bootstrap, and gate enable paths", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedLegacyRows(t);
    const asOperator = await establishOperator(t);
    let migration = await asOperator.mutation(runBatch, { batchSize: 50 });
    while (!migration.readyToComplete) {
      migration = await asOperator.mutation(runBatch, { batchSize: 50 });
    }
    expect((await asOperator.mutation(complete, {})).completed).toBe(true);

    await expect(
      t.mutation(applyLegacyLiveObservation, {
        observation: {
          gameId: fixture.gameIds[0]!,
          observedAtMs: NOW_MS,
          lifecycle: "in_progress",
          homeScore: 7,
          awayScore: 3,
        },
      }),
    ).rejects.toThrow(/migration is locked/i);
    await expect(
      t.mutation(applyApiSportsObservation, {
        observation: {
          externalId: "api-sports-game-1",
          observedAtMs: NOW_MS,
          lifecycle: "in_progress",
          homeScore: 7,
          awayScore: 3,
          providerStatus: {
            rawShort: "2Q",
            rawLong: "Second Quarter",
            recognized: true,
            terminal: false,
          },
        },
      }),
    ).rejects.toThrow(/migration is locked/i);
    expect(
      await t.mutation(dispatchSyncWork, {
        nowMs: NOW_MS,
        maxClaims: 20,
      }),
    ).toMatchObject({
      denied: "legacy_contract_locked",
      claimed: [],
    });
    await expect(
      t.mutation(enableSyncGate, {
        enabled: true,
        actorTokenIdentifier: "operator-token",
      }),
    ).rejects.toThrow(/cannot be enabled/i);
    await expect(
      asOperator.action(api.bootstrap.stageSeasonBootstrap, {
        seasonYear: 2026,
      }),
    ).rejects.toThrow(/provider actions are disabled/i);
    await expect(
      t.action(runLegacyFetch, {
        workItemId: fixture.routineWorkId,
        surface: "live",
        gameId: fixture.gameIds[1]!,
      }),
    ).rejects.toThrow(/provider actions are disabled/i);
    await expect(
      t.action(runCurrentLiveFetch, {
        workItemId: fixture.routineWorkId,
      }),
    ).rejects.toThrow(/provider actions are disabled/i);
    await expect(
      t.action(runCurrentScheduleFetch, {
        workItemId: fixture.routineWorkId,
        seasonId: fixture.seasonId,
      }),
    ).rejects.toThrow(/provider actions are disabled/i);
    await expect(t.mutation(seedDemoWorld, {})).rejects.toThrow(
      /migration is locked/i,
    );
    await expect(
      t.mutation(openLegacyIncident, {
        type: "quarantine_past_confirmation",
        surface: "confirmation",
        scopeKey: "late-quarantine",
        participantVisible: false,
      }),
    ).rejects.toThrow(/confirmation incidents are disabled/i);
  });

  it("enforces the 50-row and 4 MiB batch contracts", async () => {
    expect(LEGACY_CONTRACTION_MAX_BATCH_SIZE).toBe(50);
    expect(LEGACY_CONTRACTION_MAX_BATCH_BYTES_READ).toBe(4 * 1_024 * 1_024);
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("operatorAuditEvents", {
        action: "season_bootstrap_clean_activated",
        actorTokenIdentifier: "operator-token",
        actorClerkUserId: "operator",
        atMs: NOW_MS - 1,
      });
      for (let index = 0; index < 51; index += 1) {
        await ctx.db.insert("nflTeams", {
          stableKey: `bounded-team:${index}`,
          name: `Bounded ${index}`,
          abbreviation: `B${index}`,
          sportsDbTeamId: `legacy-${index}`,
        });
      }
    });
    const asOperator = await establishOperator(t);
    const first = await asOperator.mutation(runBatch, { batchSize: 50 });
    expect(first.visited).toBe(50);
    await expect(
      asOperator.mutation(runBatch, { batchSize: 51 }),
    ).rejects.toThrow(/1 to 50/);

    const byteBounded = convexTest(schema, modules);
    await byteBounded.run(async (ctx) => {
      await ctx.db.insert("operatorAuditEvents", {
        action: "season_bootstrap_clean_activated",
        actorTokenIdentifier: "operator-token",
        actorClerkUserId: "operator",
        atMs: NOW_MS - 1,
      });
      const payload = "x".repeat(700_000);
      for (let index = 0; index < 7; index += 1) {
        await ctx.db.insert("nflTeams", {
          stableKey: `byte-bounded-team:${index}`,
          name: payload,
          abbreviation: `X${index}`,
          sportsDbTeamId: `legacy-byte-${index}`,
        });
      }
    });
    const byteOperator = await establishOperator(byteBounded);
    const byteBatch = await byteOperator.mutation(runBatch, {
      batchSize: 50,
    });
    expect(byteBatch.visited).toBeGreaterThan(0);
    expect(byteBatch.visited).toBeLessThan(7);
  });
});
