/**
 * Provider-normalized → Convex → participant live-score integration.
 * No HTTP: observations enter at the post-provider batch boundary.
 */
import { convexTest } from "convex-test";
import * as Effect from "effect/Effect";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { api, internal } from "./_generated/api";
import { ApiSportsProvider } from "./providers/apiSports";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const NOW_MS = Date.UTC(2026, 8, 13, 17);

function identity() {
  return {
    subject: "live_owner",
    issuer: "https://clerk.example",
    name: "Live Owner",
    email: "live@example.com",
    emailVerified: true,
    phoneNumber: "+15551234567",
    phoneNumberVerified: true,
    ageConfirmed: true,
    sid: "live_session",
  };
}

async function seed(t: ReturnType<typeof convexTest>) {
  const seeded = await t.run(async (ctx) => {
    const seasonId = await ctx.db.insert("poolSeasons", {
      label: "2026",
      year: 2026,
      status: "available",
      usableStartWeek: 1,
      bootstrappedAtMs: NOW_MS,
    });
    const homeTeamId = await ctx.db.insert("nflTeams", {
      stableKey: "nfl-team:gb",
      name: "Green Bay Packers",
      abbreviation: "GB",
      sportsDbTeamId: "legacy-gb",
    });
    const awayTeamId = await ctx.db.insert("nflTeams", {
      stableKey: "nfl-team:det",
      name: "Detroit Lions",
      abbreviation: "DET",
      sportsDbTeamId: "legacy-det",
    });
    const gameId = await ctx.db.insert("nflGames", {
      stableKey: "nfl:2026:w1:det@gb",
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
    await ctx.db.insert("nflGameAliases", {
      nflGameId: gameId,
      provider: "api-sports",
      externalId: "77779",
      isCurrent: true,
      firstObservedAtMs: NOW_MS,
      lastObservedAtMs: NOW_MS,
    });
    return { seasonId, gameId };
  });
  const asOwner = t.withIdentity(identity());
  await asOwner.mutation(api.participants.ensureMyParticipant, {});
  const pool = await asOwner.mutation(api.pools.createPool, {
    name: "Live Pool",
    type: "survivor",
    startWeek: 1,
    pickLockMode: "gameKickoff",
  });
  return { ...seeded, asOwner, poolId: pool.poolId };
}

function observation(overrides: Record<string, unknown> = {}) {
  return {
    externalId: "77779",
    observedAtMs: NOW_MS + 30_000,
    lifecycle: "in_progress" as const,
    homeScore: 14,
    awayScore: 10,
    providerStatus: {
      rawShort: "Q2",
      rawLong: "Second Quarter",
      recognized: true,
      terminal: false,
    },
    ...overrides,
  };
}

async function providerObservation() {
  const fetch: typeof globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        errors: [],
        response: [
          {
            game: {
              id: 77_779,
              stage: "Regular Season",
              week: "Week 1",
              date: { timestamp: NOW_MS / 1_000 },
              status: { short: "Q2", long: "Second Quarter" },
            },
            league: { id: 1, season: "2026" },
            teams: {
              home: { id: 12, name: "Green Bay Packers" },
              away: { id: 11, name: "Detroit Lions" },
            },
            scores: {
              home: { total: 14 },
              away: { total: 10 },
            },
          },
        ],
      }),
      { status: 200 },
    );
  const provider = new ApiSportsProvider({
    apiKey: "in-memory-test-key",
    fetch,
    nowMs: () => NOW_MS + 30_000,
  });
  const [game] = await Effect.runPromise(provider.listLiveGames());
  const alias = game!.providerAliases.find(
    (candidate) => candidate.provider === "api-sports",
  )!;
  return {
    externalId: alias.id,
    observedAtMs: game!.observedAtMs,
    lifecycle: game!.lifecycle,
    homeScore: game!.homeScore,
    awayScore: game!.awayScore,
    providerStatus: game!.providerStatus,
  };
}

async function seedTargetedWork(
  t: ReturnType<typeof convexTest>,
  gameId: Awaited<ReturnType<typeof seed>>["gameId"],
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("syncWorkItems", {
      surface: "live",
      scopeKey: `live-recovery:${gameId}`,
      priority: "confirmation",
      status: "claimed",
      dueAtMs: NOW_MS,
      claimedAtMs: NOW_MS,
      leaseExpiresAtMs: NOW_MS + 60_000,
      attemptCount: 1,
      gameId,
      purpose: "targeted_live_recovery",
    });
  });
}

describe("API-Sports live slate ingestion", () => {
  it("keeps batch fan-out in one action runtime", () => {
    const source = readFileSync(
      join(import.meta.dirname, "syncApiSportsLive.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/ctx\.runAction\s*\(/);
  });

  it("coalesces all active seasons into one global live:nfl work item and none outside the window", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await t.mutation(internal.sync.ensureSyncGate, { enabled: true });

    const active = await t.mutation(
      internal.syncLive.dispatchSyncWork,
      { nowMs: NOW_MS, maxClaims: 20 },
    );
    expect(
      active.claimed.filter((item) => item.scopeKey === "live:nfl"),
    ).toHaveLength(1);
    expect(
      active.claimed.some((item) => item.scopeKey.startsWith("live:") &&
        item.scopeKey !== "live:nfl"),
    ).toBe(false);

    const outside = await t.mutation(
      internal.syncLive.dispatchSyncWork,
      {
        nowMs: NOW_MS + 4 * 60 * 60_000 + 1,
        maxClaims: 20,
      },
    );
    expect(
      outside.claimed.filter((item) => item.scopeKey === "live:nfl"),
    ).toHaveLength(0);
  });

  it("shows valid scores as a participant-visible Projected Result and keeps duplicates/stale rows idempotent", async () => {
    const t = convexTest(schema, modules);
    const { asOwner, poolId, gameId } = await seed(t);
    const normalized = await providerObservation();

    await t.action(internal.syncApiSportsLive.applySuccessfulSlateBatch, {
      observations: [normalized],
      nowMs: NOW_MS + 30_000,
    });
    const board = await asOwner.query(api.pools.getWeekBoard, {
      poolId,
      week: 1,
    });
    expect(board.slate[0]).toMatchObject({
      gameId,
      projectedHomeScore: 14,
      projectedAwayScore: 10,
      resultAuthority: "projected",
      isOfficial: false,
      verifiedResult: null,
    });

    const afterFirst = await t.run(async (ctx) => ctx.db.get(gameId));
    const duplicate = await t.mutation(
      internal.syncApiSportsLive.applyObservation,
      { observation: observation() },
    );
    const stale = await t.mutation(
      internal.syncApiSportsLive.applyObservation,
      {
        observation: observation({
          observedAtMs: NOW_MS,
          homeScore: 99,
        }),
      },
    );
    const after = await t.run(async (ctx) => ctx.db.get(gameId));
    expect(duplicate.status).toBe("duplicate");
    expect(stale.status).toBe("stale");
    expect(after?.revision).toBe(afterFirst?.revision);
    expect(after?.homeScore).toBe(14);
  });

  it("preserves absent state and coalesces one targeted lookup after two successful misses", async () => {
    const t = convexTest(schema, modules);
    const { gameId } = await seed(t);

    const first = await t.action(
      internal.syncApiSportsLive.applySuccessfulSlateBatch,
      { observations: [], nowMs: NOW_MS },
    );
    expect(first.recoveryGameIds).toEqual([]);
    const second = await t.action(
      internal.syncApiSportsLive.applySuccessfulSlateBatch,
      { observations: [], nowMs: NOW_MS + 60_000 },
    );
    expect(second.recoveryGameIds).toEqual([gameId]);
    await t.action(internal.syncApiSportsLive.applySuccessfulSlateBatch, {
      observations: [],
      nowMs: NOW_MS + 120_000,
    });

    const state = await t.run(async (ctx) => {
      const game = await ctx.db.get(gameId);
      const work = await ctx.db
        .query("syncWorkItems")
        .withIndex("by_scopeKey", (q) =>
          q.eq("scopeKey", `live-recovery:${gameId}`),
        )
        .collect();
      return { game, work };
    });
    expect(state.game).toMatchObject({
      lifecycle: "scheduled",
      homeScore: null,
      awayScore: null,
      resultAuthority: "none",
    });
    expect(state.work).toHaveLength(1);
    expect(state.work[0]).toMatchObject({
      gameId,
      purpose: "targeted_live_recovery",
      status: "due",
    });
  });

  it("rejects a valid response for the wrong NFL Game and retries the claimed target", async () => {
    const t = convexTest(schema, modules);
    const { gameId } = await seed(t);
    const { otherGameId, workItemId } = await t.run(async (ctx) => {
      const target = await ctx.db.get(gameId);
      if (!target) throw new Error("target game missing");
      const otherGameId = await ctx.db.insert("nflGames", {
        stableKey: "nfl:2026:w2:det@gb",
        seasonId: target.seasonId,
        seasonLabel: target.seasonLabel,
        week: 2,
        homeTeamId: target.homeTeamId,
        awayTeamId: target.awayTeamId,
        scheduledKickoffMs: NOW_MS + 7 * 24 * 60 * 60_000,
        lifecycle: "scheduled",
        homeScore: null,
        awayScore: null,
        sportsDbEventId: "legacy-other-game",
        resultAuthority: "none",
      });
      await ctx.db.insert("nflGameAliases", {
        nflGameId: otherGameId,
        provider: "api-sports",
        externalId: "88888",
        isCurrent: true,
        firstObservedAtMs: NOW_MS,
        lastObservedAtMs: NOW_MS,
      });
      const workItemId = await ctx.db.insert("syncWorkItems", {
        surface: "live",
        scopeKey: `live-recovery:${gameId}`,
        priority: "confirmation",
        status: "claimed",
        dueAtMs: NOW_MS,
        claimedAtMs: NOW_MS,
        leaseExpiresAtMs: NOW_MS + 60_000,
        attemptCount: 1,
        gameId,
        purpose: "targeted_live_recovery",
      });
      return { otherGameId, workItemId };
    });

    const wrongGame = observation({
      externalId: "88888",
      homeScore: 35,
      awayScore: 7,
    });
    const first = await t.action(
      internal.syncApiSportsLive.applyTargetedLookupResult,
      {
        workItemId,
        gameId,
        requestedExternalId: "77779",
        observation: wrongGame,
        nowMs: NOW_MS + 30_000,
      },
    );
    const second = await t.action(
      internal.syncApiSportsLive.applyTargetedLookupResult,
      {
        workItemId,
        gameId,
        requestedExternalId: "77779",
        observation: wrongGame,
        nowMs: NOW_MS + 31_000,
      },
    );
    expect(first).toEqual({ ok: false, reason: "wrong_game_response" });
    expect(second).toEqual({ ok: false, reason: "wrong_game_response" });

    const state = await t.run(async (ctx) => ({
      target: await ctx.db.get(gameId),
      other: await ctx.db.get(otherGameId),
      work: await ctx.db.get(workItemId),
      incidents: await ctx.db.query("operatorIncidents").collect(),
    }));
    expect(state.target).toMatchObject({
      homeScore: null,
      awayScore: null,
      resultAuthority: "none",
    });
    expect(state.other).toMatchObject({
      homeScore: null,
      awayScore: null,
      resultAuthority: "none",
    });
    expect(state.work).toMatchObject({
      status: "due",
      dueAtMs: NOW_MS + 31_000 + 60_000,
    });
    expect(state.incidents).toHaveLength(1);
    expect(state.incidents[0]?.scopeKey).toBe(`recovery:${gameId}`);
  });

  it("preserves the target and retries when targeted lookup returns null", async () => {
    const t = convexTest(schema, modules);
    const { gameId } = await seed(t);
    const workItemId = await seedTargetedWork(t, gameId);

    const result = await t.action(
      internal.syncApiSportsLive.applyTargetedLookupResult,
      {
        workItemId,
        gameId,
        requestedExternalId: "77779",
        observation: null,
        nowMs: NOW_MS + 30_000,
      },
    );
    expect(result).toEqual({ ok: false, reason: "empty_lookup" });

    const state = await t.run(async (ctx) => ({
      target: await ctx.db.get(gameId),
      work: await ctx.db.get(workItemId),
      incidents: await ctx.db.query("operatorIncidents").collect(),
    }));
    expect(state.target).toMatchObject({
      homeScore: null,
      awayScore: null,
      resultAuthority: "none",
    });
    expect(state.work).toMatchObject({
      status: "due",
      dueAtMs: NOW_MS + 30_000 + 60_000,
    });
    expect(state.incidents).toHaveLength(1);
    expect(state.incidents[0]?.scopeKey).toBe(`recovery:${gameId}`);
  });

  it("rejects nonempty evidence when its provider identity is unresolved", async () => {
    const t = convexTest(schema, modules);
    const { gameId } = await seed(t);
    const workItemId = await seedTargetedWork(t, gameId);
    await t.run(async (ctx) => {
      await ctx.db.insert("nflGameAliases", {
        nflGameId: gameId,
        provider: "api-sports",
        externalId: "77779",
        isCurrent: true,
        firstObservedAtMs: NOW_MS,
        lastObservedAtMs: NOW_MS,
      });
    });

    const result = await t.action(
      internal.syncApiSportsLive.applyTargetedLookupResult,
      {
        workItemId,
        gameId,
        requestedExternalId: "77779",
        observation: observation(),
        nowMs: NOW_MS + 30_000,
      },
    );
    expect(result).toEqual({
      ok: false,
      reason: "unresolved_game_identity",
    });

    const state = await t.run(async (ctx) => ({
      target: await ctx.db.get(gameId),
      work: await ctx.db.get(workItemId),
      incidents: await ctx.db.query("operatorIncidents").collect(),
    }));
    expect(state.target).toMatchObject({
      homeScore: null,
      awayScore: null,
      resultAuthority: "none",
    });
    expect(state.work).toMatchObject({
      status: "due",
      dueAtMs: NOW_MS + 30_000 + 60_000,
    });
    expect(state.incidents).toHaveLength(1);
  });

  it("never lets a later live projection regress an existing Verified Result", async () => {
    const t = convexTest(schema, modules);
    const { asOwner, poolId, gameId } = await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(gameId, {
        lifecycle: "terminal",
        homeScore: 21,
        awayScore: 17,
        resultAuthority: "verified",
        verifiedResult: {
          homeScore: 21,
          awayScore: 17,
          verifiedAtMs: NOW_MS + 60_000,
          status: "FT",
        },
        lastObservedAtMs: NOW_MS + 60_000,
      });
    });

    const result = await t.mutation(
      internal.syncApiSportsLive.applyObservation,
      {
        observation: observation({
          observedAtMs: NOW_MS + 120_000,
          homeScore: 99,
          awayScore: 0,
        }),
      },
    );
    expect(result.status).toBe("trusted_state");
    const board = await asOwner.query(api.pools.getWeekBoard, {
      poolId,
      week: 1,
    });
    expect(board.slate[0]).toMatchObject({
      projectedHomeScore: 21,
      projectedAwayScore: 17,
      resultAuthority: "verified",
      isOfficial: true,
      verifiedResult: {
        homeScore: 21,
        awayScore: 17,
        status: "FT",
      },
    });
  });

  it("stores unknown status only as evidence and dedupes unresolved operator incidents", async () => {
    const t = convexTest(schema, modules);
    const { gameId } = await seed(t);
    const unknown = observation({
      lifecycle: "unknown",
      homeScore: 7,
      awayScore: 3,
      providerStatus: {
        rawShort: "NEW",
        rawLong: "New Provider Contract",
        recognized: false,
        terminal: false,
      },
    });
    const applied = await t.mutation(
      internal.syncApiSportsLive.applyObservation,
      { observation: unknown },
    );
    expect(applied.status).toBe("evidence_only");

    const unresolved = observation({ externalId: "unmatched" });
    await t.mutation(internal.syncApiSportsLive.applyObservation, {
      observation: unresolved,
    });
    await t.mutation(internal.syncApiSportsLive.applyObservation, {
      observation: unresolved,
    });

    const state = await t.run(async (ctx) => ({
      game: await ctx.db.get(gameId),
      evidence: await ctx.db.query("sportsDataStatusEvidence").collect(),
      incidents: await ctx.db.query("operatorIncidents").collect(),
    }));
    expect(state.game).toMatchObject({
      lifecycle: "scheduled",
      homeScore: null,
      awayScore: null,
    });
    expect(state.evidence).toHaveLength(1);
    expect(state.incidents).toHaveLength(1);
    expect(state.incidents[0]).toMatchObject({
      status: "open",
      surface: "live",
      participantVisible: false,
      maintenanceLock: false,
    });
  });
});
