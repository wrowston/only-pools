/**
 * Fixture-driven sync pipeline tests — scenarios 24, 28–31.
 * No live HTTP: observations are injected via internal mutations.
 */

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { CONFIRMATION_MIN_ELAPSED_MS } from "./lib/confirmationPolicy";
import { deriveFreshness, LEAGUE_LIVE_LATE_MS } from "./lib/freshness";
import { PROVIDER_BUDGET } from "./lib/providerBudget";

const modules = import.meta.glob("./**/*.ts");

function fullyVerifiedIdentity(overrides: Record<string, unknown> = {}) {
  return {
    subject: "clerk_user_sync",
    issuer: "https://viable-eagle-73.clerk.accounts.dev",
    name: "Sync Owner",
    email: "sync@example.com",
    emailVerified: true,
    phoneNumber: "+15551234567",
    phoneNumberVerified: true,
    ageConfirmed: true,
    sid: "sess_sync_1",
    ...overrides,
  };
}

async function seedGame(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const seasonId = await ctx.db.insert("poolSeasons", {
      label: "2025",
      year: 2025,
      status: "available",
      usableStartWeek: 1,
      bootstrappedAtMs: Date.now(),
    });
    const homeId = await ctx.db.insert("nflTeams", {
      stableKey: "nfl-team:kc",
      name: "Kansas City Chiefs",
      abbreviation: "KC",
      sportsDbTeamId: "134922",
    });
    const awayId = await ctx.db.insert("nflTeams", {
      stableKey: "nfl-team:buf",
      name: "Buffalo Bills",
      abbreviation: "BUF",
      sportsDbTeamId: "134918",
    });
    const gameId = await ctx.db.insert("nflGames", {
      stableKey: "nfl:2025:w1:buf@kc",
      seasonId,
      seasonLabel: "2025",
      week: 1,
      homeTeamId: homeId,
      awayTeamId: awayId,
      scheduledKickoffMs: Date.now() + 7 * 24 * 60 * 60 * 1000,
      lifecycle: "scheduled",
      homeScore: null,
      awayScore: null,
      sportsDbEventId: "evt_sync_1",
      resultAuthority: "none",
    });
    await ctx.db.insert("syncGate", {
      key: "deployment",
      enabled: true,
      updatedAtMs: Date.now(),
    });
    return { seasonId, homeId, awayId, gameId };
  });
}

async function seedPoolWithBoard(
  t: ReturnType<typeof convexTest>,
  _gameSeed: Awaited<ReturnType<typeof seedGame>>,
) {
  const asOwner = t.withIdentity(fullyVerifiedIdentity());
  await asOwner.mutation(api.participants.ensureMyParticipant, {});
  const created = await asOwner.mutation(api.pools.createPool, {
    name: "Sync Pool",
    type: "survivor",
    startWeek: 1,
    pickLockMode: "gameKickoff",
  });
  return { asOwner, poolId: created.poolId };
}

describe("sync live → Verified Results (scenarios 24, 28–31)", () => {
  it("scenario 24: provisional FT is not official; Verified Result is", async () => {
    const t = convexTest(schema, modules);
    const { gameId } = await seedGame(t);
    const T0 = 1_700_000_000_000;

    const first = await t.mutation(internal.syncLive.applyLiveObservation, {
      observation: {
        gameId,
        observedAtMs: T0,
        lifecycle: "terminal",
        homeScore: 27,
        awayScore: 24,
        terminalStatus: "FT",
      },
    });
    expect(first.resultAuthority).toBe("confirmation_pending");
    expect(first.scheduledConfirmationLookups).toEqual([
      "confirmation_15",
      "confirmation_60",
    ]);

    const projection = await t.query(internal.syncLive.getGameSyncProjection, {
      gameId,
    });
    expect(projection?.isOfficial).toBe(false);
    expect(projection?.resultAuthority).toBe("confirmation_pending");
    expect(projection?.projectedHomeScore).toBe(27);

    const verified = await t.mutation(
      internal.syncLive.applyConfirmationObservationMutation,
      {
        observation: {
          gameId,
          observedAtMs: T0 + CONFIRMATION_MIN_ELAPSED_MS,
          homeScore: 27,
          awayScore: 24,
          status: "FT",
        },
      },
    );
    expect(verified.resultAuthority).toBe("verified");
    expect(verified.justVerified).toBe(true);
    expect(verified.verifiedResult?.homeScore).toBe(27);

    const after = await t.query(internal.syncLive.getGameSyncProjection, {
      gameId,
    });
    expect(after?.isOfficial).toBe(true);
  });

  it("scenario 28: Convex-only pipeline — Sync Gate OFF refuses claims; observations apply via mutations", async () => {
    const t = convexTest(schema, modules);
    const { gameId, seasonId } = await seedGame(t);

    await t.mutation(internal.sync.ensureSyncGate, { enabled: false });

    await t.mutation(internal.syncLive.enqueueSyncWork, {
      surface: "live",
      scopeKey: `live:${seasonId}`,
      priority: "routine",
      dueAtMs: Date.now() - 1_000,
      seasonId,
      purpose: "league_live",
    });

    const denied = await t.mutation(internal.syncLive.dispatchSyncWork, {
      nowMs: Date.now(),
    });
    expect(denied.gateEnabled).toBe(false);
    expect(denied.claimed).toHaveLength(0);
    expect(denied.denied).toBe("sync_gate_off");

    // Pipeline still applies through normalized mutations (no frontend provider).
    const applied = await t.mutation(internal.syncLive.applyLiveObservation, {
      observation: {
        gameId,
        observedAtMs: Date.now(),
        lifecycle: "in_progress",
        homeScore: 14,
        awayScore: 7,
      },
    });
    expect(applied.resultAuthority).toBe("projected");
  });

  it("scenario 29: confirmation clock — 15 keeps pending; 60 verifies; contradiction restarts", async () => {
    const t = convexTest(schema, modules);
    const { gameId } = await seedGame(t);
    const T0 = 1_700_100_000_000;

    await t.mutation(internal.syncLive.applyLiveObservation, {
      observation: {
        gameId,
        observedAtMs: T0,
        lifecycle: "terminal",
        homeScore: 20,
        awayScore: 17,
        terminalStatus: "FT",
      },
    });

    const at15 = await t.mutation(
      internal.syncLive.applyConfirmationObservationMutation,
      {
        observation: {
          gameId,
          observedAtMs: T0 + 15 * 60 * 1000,
          homeScore: 20,
          awayScore: 17,
          status: "FT",
        },
      },
    );
    expect(at15.resultAuthority).toBe("confirmation_pending");
    expect(at15.justVerified).toBe(false);

    const contradiction = await t.mutation(
      internal.syncLive.applyConfirmationObservationMutation,
      {
        observation: {
          gameId,
          observedAtMs: T0 + 30 * 60 * 1000,
          homeScore: 23,
          awayScore: 17,
          status: "FT",
        },
      },
    );
    expect(contradiction.restarted).toBe(true);
    expect(contradiction.resultAuthority).toBe("confirmation_pending");

    const T1 = T0 + 30 * 60 * 1000;
    const tooEarly = await t.mutation(
      internal.syncLive.applyConfirmationObservationMutation,
      {
        observation: {
          gameId,
          observedAtMs: T1 + 15 * 60 * 1000,
          homeScore: 23,
          awayScore: 17,
          status: "FT",
        },
      },
    );
    expect(tooEarly.resultAuthority).toBe("confirmation_pending");

    const verified = await t.mutation(
      internal.syncLive.applyConfirmationObservationMutation,
      {
        observation: {
          gameId,
          observedAtMs: T1 + CONFIRMATION_MIN_ELAPSED_MS,
          homeScore: 23,
          awayScore: 17,
          status: "FT",
        },
      },
    );
    expect(verified.resultAuthority).toBe("verified");
    expect(verified.justVerified).toBe(true);
  });

  it("scenario 29b: failed confirmation lookup leaves Pending + retry", async () => {
    const t = convexTest(schema, modules);
    const { gameId } = await seedGame(t);
    const T0 = 1_700_200_000_000;

    await t.mutation(internal.syncLive.applyLiveObservation, {
      observation: {
        gameId,
        observedAtMs: T0,
        lifecycle: "terminal",
        homeScore: 10,
        awayScore: 3,
        terminalStatus: "FT",
      },
    });

    const failed = await t.mutation(
      internal.syncLive.applyConfirmationObservationMutation,
      {
        observation: {
          gameId,
          observedAtMs: T0 + CONFIRMATION_MIN_ELAPSED_MS,
          homeScore: 10,
          awayScore: 3,
          status: "FT",
          lookupFailed: true,
        },
      },
    );
    expect(failed.resultAuthority).toBe("confirmation_pending");
    expect(failed.pendingRetry).toBe(true);
    expect(failed.verifiedResult).toBeNull();
  });

  it("scenario 30: Late alone raises no banner; Stale / Provider Exception distinguishable", async () => {
    const now = 1_700_300_000_000;
    const late = deriveFreshness({
      surface: "league_live",
      lastSuccessAtMs: now - LEAGUE_LIVE_LATE_MS - 5_000,
      nowMs: now,
    });
    expect(late.state).toBe("late");
    expect(late.raisesParticipantBanner).toBe(false);

    const t = convexTest(schema, modules);
    await seedGame(t);

    const health = await t.mutation(internal.syncLive.recordSyncSurfaceHealth, {
      surface: "league_live",
      scopeKey: "live:test",
      success: false,
      nowMs: now,
      providerException: true,
      exceptionMessage: "malformed livescore",
    });
    expect(health.state).toBe("provider_exception");
    expect(health.raisesParticipantBanner).toBe(true);

    const exceptions = await t.run(async (ctx) =>
      ctx.db.query("providerExceptions").collect(),
    );
    expect(exceptions).toHaveLength(1);
    expect(exceptions[0]!.kind).toBe("sync_failure");
  });

  it("scenario 31: routine work cannot starve confirmation/operator reserves", async () => {
    const t = convexTest(schema, modules);
    const { seasonId, gameId } = await seedGame(t);
    const nowMs = Date.now();

    // Saturate routine budget with live claims via dispatcher.
    for (let i = 0; i < PROVIDER_BUDGET.routineMax; i++) {
      await t.mutation(internal.syncLive.enqueueSyncWork, {
        surface: "live",
        scopeKey: `live:${seasonId}:batch:${i}`,
        priority: "routine",
        dueAtMs: nowMs - 1_000,
        seasonId,
        purpose: "league_live",
      });
    }
    await t.mutation(internal.syncLive.enqueueSyncWork, {
      surface: "confirmation",
      scopeKey: `confirmation:${gameId}:confirmation_60`,
      priority: "confirmation",
      dueAtMs: nowMs - 1_000,
      gameId,
      seasonId,
      purpose: "confirmation_60",
    });
    await t.mutation(internal.syncLive.enqueueSyncWork, {
      surface: "operator",
      scopeKey: `operator:${seasonId}:manual`,
      priority: "operator",
      dueAtMs: nowMs - 1_000,
      seasonId,
      purpose: "manual_resync",
    });

    const result = await t.mutation(internal.syncLive.dispatchSyncWork, {
      nowMs,
      maxClaims: PROVIDER_BUDGET.routineMax + 20,
    });

    expect(result.gateEnabled).toBe(true);
    const confirmationClaims = result.claimed.filter(
      (c: { priority: string }) => c.priority === "confirmation",
    );
    const operatorClaims = result.claimed.filter(
      (c: { priority: string }) => c.priority === "operator",
    );
    const routineClaims = result.claimed.filter(
      (c: { priority: string }) => c.priority === "routine",
    );

    expect(routineClaims.length).toBe(PROVIDER_BUDGET.routineMax);
    expect(confirmationClaims.length).toBeGreaterThanOrEqual(1);
    expect(operatorClaims.length).toBeGreaterThanOrEqual(1);
  });

  it("Week Board exposes projected results labeled non-official until verified", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedGame(t);
    const { asOwner, poolId } = await seedPoolWithBoard(t, seed);
    const T0 = Date.now();

    await t.mutation(internal.syncLive.applyLiveObservation, {
      observation: {
        gameId: seed.gameId,
        observedAtMs: T0,
        lifecycle: "in_progress",
        homeScore: 21,
        awayScore: 14,
      },
    });

    const board = await asOwner.query(api.pools.getWeekBoard, { poolId });
    const row = board.slate[0]!;
    expect(row.projectedHomeScore).toBe(21);
    expect(row.projectedAwayScore).toBe(14);
    expect(row.isOfficial).toBe(false);
    expect(row.resultAuthority).toBe("projected");
    expect(board.syncFreshness.raisesParticipantBanner).toBe(false);

    await t.mutation(internal.syncLive.applyLiveObservation, {
      observation: {
        gameId: seed.gameId,
        observedAtMs: T0 + 1_000,
        lifecycle: "terminal",
        homeScore: 28,
        awayScore: 14,
        terminalStatus: "FT",
      },
    });
    const provisionalBoard = await asOwner.query(api.pools.getWeekBoard, {
      poolId,
    });
    expect(provisionalBoard.slate[0]!.resultAuthority).toBe(
      "confirmation_pending",
    );
    expect(provisionalBoard.slate[0]!.isOfficial).toBe(false);

    await t.mutation(internal.syncLive.applyConfirmationObservationMutation, {
      observation: {
        gameId: seed.gameId,
        observedAtMs: T0 + 1_000 + CONFIRMATION_MIN_ELAPSED_MS,
        homeScore: 28,
        awayScore: 14,
        status: "FT",
      },
    });
    const verifiedBoard = await asOwner.query(api.pools.getWeekBoard, {
      poolId,
    });
    expect(verifiedBoard.slate[0]!.isOfficial).toBe(true);
    expect(verifiedBoard.slate[0]!.verifiedResult?.homeScore).toBe(28);
  });
});
