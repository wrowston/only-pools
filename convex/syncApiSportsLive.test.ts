/**
 * Provider-normalized → Convex → participant live-score integration.
 * No HTTP: observations enter at the post-provider batch boundary.
 */
import { convexTest } from "convex-test";
import * as Effect from "effect/Effect";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { api, internal } from "./_generated/api";
import { computeWeeklyCutoffMs } from "./lib/pickLock";
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
    return { seasonId, gameId, homeTeamId, awayTeamId };
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

function terminalObservation(overrides: Record<string, unknown> = {}) {
  return observation({
    lifecycle: "terminal",
    homeScore: 27,
    awayScore: 24,
    providerStatus: {
      rawShort: "FT",
      rawLong: "Finished",
      recognized: true,
      terminal: true,
    },
    ...overrides,
  });
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

async function providerTerminalObservation() {
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
              status: { short: "FT", long: "Finished" },
            },
            league: { id: 1, season: "2026" },
            teams: {
              home: { id: 12, name: "Green Bay Packers" },
              away: { id: 11, name: "Detroit Lions" },
            },
            scores: {
              home: { total: 27 },
              away: { total: 24 },
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

  it("dispatches correction work through the API-Sports targeted reconciliation action", () => {
    const source = readFileSync(
      join(import.meta.dirname, "syncLive.ts"),
      "utf8",
    );
    expect(source).toMatch(
      /item\.surface === "correction"[\s\S]*runClaimedResultReconciliation/,
    );
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

  it("makes the first coherent terminal observation immediately Verified and publishes one scoring revision", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      const { asOwner, poolId, gameId } = await seed(t);
      const terminal = await providerTerminalObservation();

      const first = await t.action(
        internal.syncApiSportsLive.applySuccessfulSlateBatch,
        {
          observations: [terminal],
          nowMs: terminal.observedAtMs,
        },
      );
      expect(first.results[0]?.status).toBe("verified");
      const board = await asOwner.query(api.pools.getWeekBoard, {
        poolId,
        week: 1,
      });
      expect(board.slate[0]).toMatchObject({
        gameId,
        lifecycle: "terminal",
        projectedHomeScore: 27,
        projectedAwayScore: 24,
        resultAuthority: "verified",
        isOfficial: true,
        verifiedResult: {
          homeScore: 27,
          awayScore: 24,
          status: "FT",
        },
      });
      const confirmationWork = await t.run(async (ctx) =>
        ctx.db
          .query("syncWorkItems")
          .filter((q) => q.eq(q.field("surface"), "confirmation"))
          .collect(),
      );
      expect(confirmationWork).toEqual([]);
      const correctionWork = await t.run(async (ctx) =>
        ctx.db
          .query("syncWorkItems")
          .filter((q) => q.eq(q.field("surface"), "correction"))
          .collect(),
      );
      expect(
        correctionWork
          .map((item) => ({ purpose: item.purpose, dueAtMs: item.dueAtMs }))
          .sort((a, b) => a.dueAtMs - b.dueAtMs),
      ).toEqual([
        {
          purpose: "result_reconciliation_15m",
          dueAtMs: terminal.observedAtMs + 15 * 60_000,
        },
        {
          purpose: "result_reconciliation_30m",
          dueAtMs: terminal.observedAtMs + 30 * 60_000,
        },
        {
          purpose: "result_reconciliation_60m",
          dueAtMs: terminal.observedAtMs + 60 * 60_000,
        },
        {
          purpose: "result_reconciliation_120m",
          dueAtMs: terminal.observedAtMs + 120 * 60_000,
        },
        {
          purpose: "result_reconciliation_next_morning",
          dueAtMs: Date.UTC(2026, 8, 14, 14),
        },
      ]);

      await t.finishAllScheduledFunctions(() => vi.runAllTimers());
      await t.action(internal.syncApiSportsLive.applySuccessfulSlateBatch, {
        observations: [terminal],
        nowMs: terminal.observedAtMs,
      });
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());
      const revisions = await t.run(async (ctx) =>
        ctx.db.query("scoringRevisions").collect(),
      );
      expect(revisions).toHaveLength(1);
      expect(revisions[0]).toMatchObject({
        poolId,
        week: 1,
        kind: "survivor",
        revisionNumber: 1,
        status: "published",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("records unchanged reconciliation evidence without another scoring revision", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      const { gameId } = await seed(t);
      const terminal = terminalObservation();
      await t.action(internal.syncApiSportsLive.applySuccessfulSlateBatch, {
        observations: [terminal],
        nowMs: terminal.observedAtMs,
      });
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());
      const workItemId = await t.run(async (ctx) => {
        const [item] = await ctx.db
          .query("syncWorkItems")
          .filter((q) => q.eq(q.field("surface"), "correction"))
          .collect();
        return item!._id;
      });

      const result = await t.action(
        internal.syncApiSportsLive.applyReconciliationLookupResult,
        {
          workItemId,
          gameId,
          requestedExternalId: "77779",
          observation: terminalObservation({
            observedAtMs: terminal.observedAtMs + 15 * 60_000,
          }),
          nowMs: terminal.observedAtMs + 15 * 60_000,
        },
      );
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());

      expect(result).toMatchObject({ ok: true, result: "unchanged" });
      const stale = await t.action(
        internal.syncApiSportsLive.applyReconciliationLookupResult,
        {
          workItemId,
          gameId,
          requestedExternalId: "77779",
          observation: terminalObservation({
            observedAtMs: terminal.observedAtMs + 10 * 60_000,
            homeScore: 99,
          }),
          nowMs: terminal.observedAtMs + 16 * 60_000,
        },
      );
      expect(stale).toMatchObject({ ok: true, result: "stale" });
      const state = await t.run(async (ctx) => ({
        game: await ctx.db.get(gameId),
        revisions: await ctx.db.query("scoringRevisions").collect(),
        observations: await ctx.db
          .query("nflGameResultReconciliationObservations")
          .withIndex("by_nflGameId", (q) => q.eq("nflGameId", gameId))
          .collect(),
      }));
      expect(state.game?.verifiedResult?.verifiedAtMs).toBe(
        terminal.observedAtMs,
      );
      expect(state.observations.map((row) => row.disposition)).toEqual([
        "unchanged",
        "stale",
      ]);
      expect(state.game?.correctionCandidate).toBeUndefined();
      expect(state.revisions).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retains every coherent reconciliation observation beyond the former document bound", async () => {
    const t = convexTest(schema, modules);
    const { gameId } = await seed(t);
    const terminal = terminalObservation();
    await t.action(internal.syncApiSportsLive.applySuccessfulSlateBatch, {
      observations: [terminal],
      nowMs: terminal.observedAtMs,
    });

    for (let minute = 1; minute <= 20; minute++) {
      const result = await t.mutation(
        internal.syncApiSportsLive.applyReconciliationObservation,
        {
          gameId,
          observation: terminalObservation({
            observedAtMs: terminal.observedAtMs + minute * 60_000,
          }),
        },
      );
      expect(result.result).toBe("unchanged");
    }

    const observations = await t.run(async (ctx) =>
      ctx.db
        .query("nflGameResultReconciliationObservations")
        .withIndex("by_nflGameId", (q) => q.eq("nflGameId", gameId))
        .collect(),
    );
    expect(observations).toHaveLength(20);
  });

  it("auto-applies a safe changed terminal result and preserves the prior audit timestamps", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      const { gameId } = await seed(t);
      const terminal = terminalObservation();
      await t.action(internal.syncApiSportsLive.applySuccessfulSlateBatch, {
        observations: [terminal],
        nowMs: terminal.observedAtMs,
      });
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());
      const workItemId = await t.run(async (ctx) => {
        const [item] = await ctx.db
          .query("syncWorkItems")
          .filter((q) => q.eq(q.field("surface"), "correction"))
          .collect();
        return item!._id;
      });
      const correctedAtMs = terminal.observedAtMs + 15 * 60_000;

      const result = await t.action(
        internal.syncApiSportsLive.applyReconciliationLookupResult,
        {
          workItemId,
          gameId,
          requestedExternalId: "77779",
          observation: terminalObservation({
            observedAtMs: correctedAtMs,
            homeScore: 20,
            awayScore: 28,
          }),
          nowMs: correctedAtMs,
        },
      );
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());

      expect(result).toMatchObject({ ok: true, result: "corrected" });
      const state = await t.run(async (ctx) => ({
        game: await ctx.db.get(gameId),
        revisions: await ctx.db.query("scoringRevisions").collect(),
      }));
      expect(state.game).toMatchObject({
        resultAuthority: "verified",
        homeScore: 20,
        awayScore: 28,
        verifiedResult: {
          homeScore: 20,
          awayScore: 28,
          verifiedAtMs: correctedAtMs,
          status: "FT",
        },
        priorVerifiedResult: {
          homeScore: 27,
          awayScore: 24,
          verifiedAtMs: terminal.observedAtMs,
          status: "FT",
          supersededAtMs: correctedAtMs,
        },
      });
      expect(state.game?.correctionCandidate).toBeUndefined();
      expect(state.revisions).toHaveLength(2);

      const secondWorkItemId = await t.run(async (ctx) => {
        const items = await ctx.db
          .query("syncWorkItems")
          .filter((q) =>
            q.and(
              q.eq(q.field("surface"), "correction"),
              q.eq(q.field("status"), "due"),
            ),
          )
          .collect();
        return items.sort((a, b) => a.dueAtMs - b.dueAtMs)[0]!._id;
      });
      const correctedAgainAtMs = terminal.observedAtMs + 30 * 60_000;
      const correctedAgain = await t.action(
        internal.syncApiSportsLive.applyReconciliationLookupResult,
        {
          workItemId: secondWorkItemId,
          gameId,
          requestedExternalId: "77779",
          observation: terminalObservation({
            observedAtMs: correctedAgainAtMs,
            homeScore: 17,
            awayScore: 10,
          }),
          nowMs: correctedAgainAtMs,
        },
      );
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());
      expect(correctedAgain).toMatchObject({
        ok: true,
        result: "corrected",
      });

      const afterSecond = await t.run(async (ctx) => ({
        game: await ctx.db.get(gameId),
        history: await ctx.db
          .query("nflGameResultHistory")
          .withIndex("by_nflGameId_and_supersededAtMs", (q) =>
            q.eq("nflGameId", gameId),
          )
          .collect(),
        observations: await ctx.db
          .query("nflGameResultReconciliationObservations")
          .withIndex("by_nflGameId_and_observedAtMs", (q) =>
            q.eq("nflGameId", gameId),
          )
          .collect(),
        revisions: await ctx.db.query("scoringRevisions").collect(),
      }));
      expect(afterSecond.history).toMatchObject([
        {
          homeScore: 27,
          awayScore: 24,
          verifiedAtMs: terminal.observedAtMs,
          supersededAtMs: correctedAtMs,
        },
        {
          homeScore: 20,
          awayScore: 28,
          verifiedAtMs: correctedAtMs,
          supersededAtMs: correctedAgainAtMs,
        },
      ]);
      expect(afterSecond.observations.map((row) => row.disposition)).toEqual([
        "corrected",
        "corrected",
      ]);
      expect(afterSecond.game?.priorVerifiedResult).toMatchObject({
        homeScore: 20,
        awayScore: 28,
        verifiedAtMs: correctedAtMs,
        supersededAtMs: correctedAgainAtMs,
      });
      expect(afterSecond.game?.verifiedResult).toMatchObject({
        homeScore: 17,
        awayScore: 10,
        verifiedAtMs: correctedAgainAtMs,
      });
      expect(afterSecond.revisions).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not materialize an empty scheduled Survivor week or block a safe correction", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      const {
        asOwner,
        poolId,
        gameId,
        seasonId,
        homeTeamId,
        awayTeamId,
      } = await seed(t);
      await t.run(async (ctx) => {
        await ctx.db.patch(poolId, { maxEntriesPerUser: 2 });
        await ctx.db.insert("nflGames", {
          stableKey: "nfl:2026:w2:det@gb",
          seasonId,
          seasonLabel: "2026",
          week: 2,
          homeTeamId,
          awayTeamId,
          scheduledKickoffMs: NOW_MS + 7 * 24 * 60 * 60_000,
          lifecycle: "scheduled",
          homeScore: null,
          awayScore: null,
          sportsDbEventId: "legacy-game-week-2-without-picks",
          resultAuthority: "none",
        });
      });
      const secondEntry = await asOwner.mutation(api.pools.addPoolEntry, {
        poolId,
      });
      const entries = await asOwner.query(api.pools.listMyPoolEntries, {
        poolId,
        nowMs: Date.now(),
      });
      const primaryEntryId = entries.entries.find(
        (entry) => entry.entryId !== secondEntry.entryId,
      )!.entryId;
      for (const entryId of [primaryEntryId, secondEntry.entryId]) {
        await asOwner.mutation(api.survivorPicks.autosaveSurvivorPick, {
          poolId,
          week: 1,
          nflTeamId: homeTeamId,
          entryId,
        });
      }

      const terminal = terminalObservation();
      await t.action(internal.syncApiSportsLive.applySuccessfulSlateBatch, {
        observations: [terminal],
        nowMs: terminal.observedAtMs,
      });
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());
      const before = await t.run(async (ctx) => ({
        revisions: await ctx.db
          .query("scoringRevisions")
          .withIndex("by_poolId_and_week", (q) => q.eq("poolId", poolId))
          .collect(),
        work: await ctx.db
          .query("syncWorkItems")
          .filter((q) => q.eq(q.field("surface"), "correction"))
          .first(),
      }));
      expect(before.revisions.map((revision) => revision.week)).toEqual([1]);

      const correctedAtMs = terminal.observedAtMs + 15 * 60_000;
      const result = await t.action(
        internal.syncApiSportsLive.applyReconciliationLookupResult,
        {
          workItemId: before.work!._id,
          gameId,
          requestedExternalId: "77779",
          observation: terminalObservation({
            observedAtMs: correctedAtMs,
            homeScore: 20,
            awayScore: 28,
          }),
          nowMs: correctedAtMs,
        },
      );
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());

      expect(result).toMatchObject({ ok: true, result: "corrected" });
      const after = await t.run(async (ctx) => ({
        game: await ctx.db.get(gameId),
        revisions: await ctx.db
          .query("scoringRevisions")
          .withIndex("by_poolId_and_week", (q) => q.eq("poolId", poolId))
          .collect(),
      }));
      expect(after.game?.verifiedResult).toMatchObject({
        homeScore: 20,
        awayScore: 28,
        verifiedAtMs: correctedAtMs,
      });
      expect(after.revisions.map((revision) => revision.week)).toEqual([1, 1]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("replays Pool Weeks in order and restores valid later provisional Survivor picks", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      const {
        asOwner,
        poolId,
        gameId,
        seasonId,
        homeTeamId,
        awayTeamId,
      } = await seed(t);
      await t.run(async (ctx) => {
        await ctx.db.patch(poolId, { maxEntriesPerUser: 2 });
        await ctx.db.insert("nflGames", {
          stableKey: "nfl:2026:w2:det@gb",
          seasonId,
          seasonLabel: "2026",
          week: 2,
          homeTeamId,
          awayTeamId,
          scheduledKickoffMs: NOW_MS + 7 * 24 * 60 * 60_000,
          lifecycle: "scheduled",
          homeScore: null,
          awayScore: null,
          sportsDbEventId: "legacy-game-week-2",
          resultAuthority: "none",
        });
      });
      const secondEntry = await asOwner.mutation(api.pools.addPoolEntry, {
        poolId,
      });
      const entries = await asOwner.query(api.pools.listMyPoolEntries, {
        poolId,
        nowMs: Date.now(),
      });
      const primaryEntryId = entries.entries.find(
        (entry) => entry.entryId !== secondEntry.entryId,
      )!.entryId;
      for (const entryId of [primaryEntryId, secondEntry.entryId]) {
        await asOwner.mutation(api.survivorPicks.autosaveSurvivorPick, {
          poolId,
          week: 1,
          nflTeamId: homeTeamId,
          entryId,
        });
        await asOwner.mutation(api.survivorPicks.autosaveSurvivorPick, {
          poolId,
          week: 2,
          nflTeamId: awayTeamId,
          entryId,
        });
      }

      const terminal = terminalObservation({
        homeScore: 20,
        awayScore: 28,
      });
      await t.action(internal.syncApiSportsLive.applySuccessfulSlateBatch, {
        observations: [terminal],
        nowMs: terminal.observedAtMs,
      });
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());
      const before = await t.run(async (ctx) => ({
        picks: await ctx.db
          .query("survivorPicks")
          .withIndex("by_poolId_and_week", (q) =>
            q.eq("poolId", poolId).eq("week", 2),
          )
          .collect(),
        work: await ctx.db
          .query("syncWorkItems")
          .filter((q) => q.eq(q.field("surface"), "correction"))
          .first(),
      }));
      expect(before.picks).toHaveLength(2);
      expect(before.picks.every((pick) => pick.invalidated)).toBe(true);
      expect(
        before.picks.every(
          (pick) => pick.invalidationReason === "earlier_elimination",
        ),
      ).toBe(true);

      const correctedAtMs = terminal.observedAtMs + 15 * 60_000;
      await t.action(
        internal.syncApiSportsLive.applyReconciliationLookupResult,
        {
          workItemId: before.work!._id,
          gameId,
          requestedExternalId: "77779",
          observation: terminalObservation({
            observedAtMs: correctedAtMs,
            homeScore: 28,
            awayScore: 20,
          }),
          nowMs: correctedAtMs,
        },
      );
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());

      const after = await t.run(async (ctx) => ({
        picks: await ctx.db
          .query("survivorPicks")
          .withIndex("by_poolId_and_week", (q) =>
            q.eq("poolId", poolId).eq("week", 2),
          )
          .collect(),
        reservations: await ctx.db
          .query("survivorTeamReservations")
          .filter((q) =>
            q.and(
              q.eq(q.field("poolId"), poolId),
              q.eq(q.field("week"), 2),
            ),
          )
          .collect(),
        revisions: await ctx.db
          .query("scoringRevisions")
          .withIndex("by_poolId_and_week", (q) => q.eq("poolId", poolId))
          .collect(),
      }));
      expect(after.picks.every((pick) => !pick.invalidated)).toBe(true);
      expect(
        after.picks.every((pick) => pick.invalidationReason === undefined),
      ).toBe(true);
      expect(after.reservations.every((row) => !row.released)).toBe(true);
      expect(after.revisions.slice(-2).map((revision) => revision.week)).toEqual(
        [1, 2],
      );

      await t.mutation(
        internal.survivorScoring.scoreSurvivorPoolsForVerifiedGame,
        { gameId },
      );
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());
      const afterIdenticalReplay = await t.run(async (ctx) => {
        return await ctx.db
          .query("scoringRevisions")
          .withIndex("by_poolId_and_week", (q) => q.eq("poolId", poolId))
          .collect();
      });
      expect(afterIdenticalReplay).toHaveLength(after.revisions.length);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retains an unsafe correction candidate after a later Pool Week lock", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      const { gameId, poolId } = await seed(t);
      const terminal = terminalObservation();
      await t.action(internal.syncApiSportsLive.applySuccessfulSlateBatch, {
        observations: [terminal],
        nowMs: terminal.observedAtMs,
      });
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());
      const workItemId = await t.run(async (ctx) => {
        const pool = (await ctx.db.get(poolId))!;
        const entry = (await ctx.db
          .query("poolEntries")
          .withIndex("by_poolId", (q) => q.eq("poolId", poolId))
          .first())!;
        await ctx.db.insert("survivorPicks", {
          poolId,
          participantId: pool.ownerParticipantId,
          entryId: entry._id,
          week: 2,
          locked: true,
          lockedAtMs: terminal.observedAtMs,
          provenance: "omission",
          provisional: true,
          updatedAtMs: terminal.observedAtMs,
        });
        const [item] = await ctx.db
          .query("syncWorkItems")
          .filter((q) => q.eq(q.field("surface"), "correction"))
          .collect();
        return item!._id;
      });
      const observedAtMs = terminal.observedAtMs + 15 * 60_000;

      const result = await t.action(
        internal.syncApiSportsLive.applyReconciliationLookupResult,
        {
          workItemId,
          gameId,
          requestedExternalId: "77779",
          observation: terminalObservation({
            observedAtMs,
            homeScore: 20,
            awayScore: 28,
          }),
          nowMs: observedAtMs,
        },
      );
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());

      expect(result).toMatchObject({ ok: true, result: "candidate" });
      const state = await t.run(async (ctx) => ({
        game: await ctx.db.get(gameId),
        revisions: await ctx.db.query("scoringRevisions").collect(),
      }));
      expect(state.game).toMatchObject({
        resultAuthority: "verified",
        homeScore: 27,
        awayScore: 24,
        verifiedResult: {
          homeScore: 27,
          awayScore: 24,
          verifiedAtMs: terminal.observedAtMs,
        },
        correctionCandidate: {
          homeScore: 20,
          awayScore: 28,
          observedAtMs,
          status: "FT",
        },
      });
      expect(state.game?.priorVerifiedResult).toBeUndefined();
      expect(state.revisions).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retains an unsafe correction candidate after a later Pool Week settles", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      const { gameId, poolId } = await seed(t);
      const terminal = terminalObservation();
      await t.action(internal.syncApiSportsLive.applySuccessfulSlateBatch, {
        observations: [terminal],
        nowMs: terminal.observedAtMs,
      });
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());
      const workItemId = await t.run(async (ctx) => {
        await ctx.db.insert("poolWeeks", {
          poolId,
          week: 2,
          settled: true,
          updatedAtMs: terminal.observedAtMs,
        });
        const [item] = await ctx.db
          .query("syncWorkItems")
          .filter((q) => q.eq(q.field("surface"), "correction"))
          .collect();
        return item!._id;
      });
      const observedAtMs = terminal.observedAtMs + 15 * 60_000;

      const result = await t.action(
        internal.syncApiSportsLive.applyReconciliationLookupResult,
        {
          workItemId,
          gameId,
          requestedExternalId: "77779",
          observation: terminalObservation({
            observedAtMs,
            homeScore: 20,
            awayScore: 28,
          }),
          nowMs: observedAtMs,
        },
      );

      expect(result).toMatchObject({ ok: true, result: "candidate" });
      const game = await t.run(async (ctx) => ctx.db.get(gameId));
      expect(game).toMatchObject({
        resultAuthority: "verified",
        homeScore: 27,
        awayScore: 24,
        correctionCandidate: {
          homeScore: 20,
          awayScore: 28,
          observedAtMs,
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    { lockMode: "gameKickoff" as const, label: "scheduled kickoff" },
    { lockMode: "weeklyCutoff" as const, label: "weekly cutoff" },
  ])(
    "derives an unmaterialized later $label lock at correction receipt time",
    async ({ lockMode }) => {
      const t = convexTest(schema, modules);
      const {
        gameId,
        poolId,
        seasonId,
        homeTeamId,
        awayTeamId,
      } = await seed(t);
      const laterKickoffMs = NOW_MS + 7 * 24 * 60 * 60_000 + 3 * 60 * 60_000;
      const observedAtMs =
        lockMode === "weeklyCutoff"
          ? computeWeeklyCutoffMs(laterKickoffMs) + 1
          : laterKickoffMs + 1;
      await t.run(async (ctx) => {
        await ctx.db.patch(poolId, { pickLockMode: lockMode });
        await ctx.db.insert("nflGames", {
          stableKey: "nfl:2026:w2:det@gb",
          seasonId,
          seasonLabel: "2026",
          week: 2,
          homeTeamId,
          awayTeamId,
          scheduledKickoffMs: laterKickoffMs,
          lifecycle: "scheduled",
          homeScore: null,
          awayScore: null,
          sportsDbEventId: "legacy-game-week-2-derived-lock",
          resultAuthority: "none",
        });
      });
      const terminal = terminalObservation();
      await t.action(internal.syncApiSportsLive.applySuccessfulSlateBatch, {
        observations: [terminal],
        nowMs: terminal.observedAtMs,
      });
      const workItemId = await t.run(async (ctx) => {
        const [item] = await ctx.db
          .query("syncWorkItems")
          .filter((q) => q.eq(q.field("surface"), "correction"))
          .collect();
        return item!._id;
      });

      const result = await t.action(
        internal.syncApiSportsLive.applyReconciliationLookupResult,
        {
          workItemId,
          gameId,
          requestedExternalId: "77779",
          observation: terminalObservation({
            observedAtMs,
            homeScore: 20,
            awayScore: 28,
          }),
          nowMs: observedAtMs,
        },
      );

      expect(result).toMatchObject({ ok: true, result: "candidate" });
      const game = await t.run(async (ctx) => ctx.db.get(gameId));
      expect(game?.verifiedResult).toMatchObject({
        homeScore: 27,
        awayScore: 24,
      });
      expect(game?.correctionCandidate).toMatchObject({
        homeScore: 20,
        awayScore: 28,
        observedAtMs,
      });
    },
  );

  it("fails closed when correction dependency scope exceeds its bounded Pool read", async () => {
    const t = convexTest(schema, modules);
    const { gameId, poolId, seasonId } = await seed(t);
    await t.run(async (ctx) => {
      const ownerParticipantId = (await ctx.db.get(poolId))!.ownerParticipantId;
      for (let index = 0; index < 200; index++) {
        await ctx.db.insert("pools", {
          name: `Bounded Pool ${index}`,
          type: "survivor",
          seasonId,
          startWeek: 1,
          pickLockMode: "gameKickoff",
          status: "active",
          rulesFrozen: false,
          ownerParticipantId,
          createdAtMs: NOW_MS,
        });
      }
    });
    const terminal = terminalObservation();
    await t.action(internal.syncApiSportsLive.applySuccessfulSlateBatch, {
      observations: [terminal],
      nowMs: terminal.observedAtMs,
    });

    const result = await t.mutation(
      internal.syncApiSportsLive.applyReconciliationObservation,
      {
        gameId,
        observation: terminalObservation({
          observedAtMs: terminal.observedAtMs + 15 * 60_000,
          homeScore: 20,
          awayScore: 28,
        }),
      },
    );

    expect(result.result).toBe("candidate");
    const game = await t.run(async (ctx) => ctx.db.get(gameId));
    expect(game?.verifiedResult).toMatchObject({
      homeScore: 27,
      awayScore: 24,
    });
  });

  it("preserves the Verified Result and upserts one incident when reconciliation fails", async () => {
    const t = convexTest(schema, modules);
    const { gameId } = await seed(t);
    const terminal = terminalObservation();
    await t.action(internal.syncApiSportsLive.applySuccessfulSlateBatch, {
      observations: [terminal],
      nowMs: terminal.observedAtMs,
    });
    const workItemId = await t.run(async (ctx) => {
      const [item] = await ctx.db
        .query("syncWorkItems")
        .filter((q) => q.eq(q.field("surface"), "correction"))
        .collect();
      return item!._id;
    });

    for (const nowMs of [
      terminal.observedAtMs + 15 * 60_000,
      terminal.observedAtMs + 16 * 60_000,
    ]) {
      await t.action(
        internal.syncApiSportsLive.applyReconciliationLookupResult,
        {
          workItemId,
          gameId,
          requestedExternalId: "77779",
          observation: null,
          nowMs,
        },
      );
    }

    const state = await t.run(async (ctx) => ({
      game: await ctx.db.get(gameId),
      incidents: await ctx.db
        .query("operatorIncidents")
        .filter((q) => q.eq(q.field("scopeKey"), `correction:${gameId}`))
        .collect(),
    }));
    expect(state.game?.verifiedResult).toMatchObject({
      homeScore: 27,
      awayScore: 24,
      verifiedAtMs: terminal.observedAtMs,
    });
    expect(state.incidents).toHaveLength(1);
  });

  it("preserves the last trusted state and opens an incident for incoherent terminal scores", async () => {
    const t = convexTest(schema, modules);
    const { gameId } = await seed(t);
    await t.action(internal.syncApiSportsLive.applySuccessfulSlateBatch, {
      observations: [observation()],
      nowMs: NOW_MS + 30_000,
    });

    const result = await t.action(
      internal.syncApiSportsLive.applySuccessfulSlateBatch,
      {
        observations: [
          terminalObservation({
            observedAtMs: NOW_MS + 60_000,
            homeScore: 27.5,
          }),
        ],
        nowMs: NOW_MS + 60_000,
      },
    );
    expect(result.results[0]?.status).toBe("incoherent_terminal");

    const state = await t.run(async (ctx) => ({
      game: await ctx.db.get(gameId),
      incidents: await ctx.db.query("operatorIncidents").collect(),
    }));
    expect(state.game).toMatchObject({
      lifecycle: "in_progress",
      homeScore: 14,
      awayScore: 10,
      resultAuthority: "projected",
    });
    expect(state.game?.verifiedResult).toBeUndefined();
    expect(state.incidents).toHaveLength(1);
    expect(state.incidents[0]).toMatchObject({
      scopeKey: "terminal:77779",
      status: "open",
    });
  });

  it("preserves Survivor tie elimination and winner rules through immediate verification", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      const { asOwner, poolId, gameId, homeTeamId } = await seed(t);
      await asOwner.mutation(api.survivorPicks.autosaveSurvivorPick, {
        poolId,
        week: 1,
        nflTeamId: homeTeamId,
      });
      await t.run(async (ctx) => {
        await ctx.db.patch(gameId, {
          scheduledKickoffMs: Date.now() - 1_000,
        });
      });
      await asOwner.mutation(
        api.survivorPicks.materializeSurvivorLocks,
        { poolId, week: 1 },
      );

      await t.action(internal.syncApiSportsLive.applySuccessfulSlateBatch, {
        observations: [
          terminalObservation({ homeScore: 21, awayScore: 21 }),
        ],
        nowMs: NOW_MS + 30_000,
      });
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());

      const standings = await asOwner.query(
        api.survivorScoring.getSurvivorStandings,
        { poolId },
      );
      expect(standings?.rows[0]).toMatchObject({
        eligibility: "winner",
        eliminationReason: "tie",
      });
      const pool = await t.run(async (ctx) => ctx.db.get(poolId));
      expect(pool?.status).toBe("completed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("invalidates and releases a pre-lock canceled pick before Survivor scoring", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      const { asOwner, poolId, homeTeamId } = await seed(t);
      await asOwner.mutation(api.survivorPicks.autosaveSurvivorPick, {
        poolId,
        week: 1,
        nflTeamId: homeTeamId,
      });

      await t.action(internal.syncApiSportsLive.applySuccessfulSlateBatch, {
        observations: [
          terminalObservation({
            lifecycle: "canceled",
            homeScore: null,
            awayScore: null,
            providerStatus: {
              rawShort: "CANC",
              rawLong: "Cancelled",
              recognized: true,
              terminal: true,
            },
          }),
        ],
        nowMs: NOW_MS + 30_000,
      });
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());

      const state = await t.run(async (ctx) => ({
        picks: await ctx.db
          .query("survivorPicks")
          .withIndex("by_poolId_and_week", (q) =>
            q.eq("poolId", poolId).eq("week", 1),
          )
          .collect(),
        reservations: await ctx.db
          .query("survivorTeamReservations")
          .filter((q) => q.eq(q.field("poolId"), poolId))
          .collect(),
        outcomes: await ctx.db
          .query("survivorPickOutcomes")
          .withIndex("by_poolId_and_week", (q) =>
            q.eq("poolId", poolId).eq("week", 1),
          )
          .collect(),
      }));
      expect(state.picks[0]).toMatchObject({
        invalidated: true,
        locked: false,
      });
      expect(state.reservations[0]?.released).toBe(true);
      expect(state.outcomes).toHaveLength(1);
      expect(state.outcomes[0]?.outcome).toBe("missing_pick");
    } finally {
      vi.useRealTimers();
    }
  });

  it("accepts scoreless cancellation and preserves locked No-Contest Advance", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      const { asOwner, poolId, gameId, homeTeamId } = await seed(t);
      await asOwner.mutation(api.survivorPicks.autosaveSurvivorPick, {
        poolId,
        week: 1,
        nflTeamId: homeTeamId,
      });
      await t.run(async (ctx) => {
        await ctx.db.patch(gameId, {
          scheduledKickoffMs: Date.now() - 1_000,
        });
      });
      await asOwner.mutation(
        api.survivorPicks.materializeSurvivorLocks,
        { poolId, week: 1 },
      );

      await t.action(internal.syncApiSportsLive.applySuccessfulSlateBatch, {
        observations: [
          terminalObservation({
            lifecycle: "canceled",
            homeScore: null,
            awayScore: null,
            providerStatus: {
              rawShort: "CANC",
              rawLong: "Cancelled",
              recognized: true,
              terminal: true,
            },
          }),
        ],
        nowMs: NOW_MS + 30_000,
      });
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());

      const state = await t.run(async (ctx) => ({
        game: await ctx.db.get(gameId),
        outcomes: await ctx.db
          .query("survivorPickOutcomes")
          .withIndex("by_poolId_and_week", (q) =>
            q.eq("poolId", poolId).eq("week", 1),
          )
          .collect(),
        picks: await ctx.db
          .query("survivorPicks")
          .withIndex("by_poolId_and_week", (q) =>
            q.eq("poolId", poolId).eq("week", 1),
          )
          .collect(),
      }));
      expect(state.game?.verifiedResult).toMatchObject({
        homeScore: 0,
        awayScore: 0,
        status: "CANC",
      });
      expect(state.outcomes[0]?.outcome).toBe("no_contest_advance");
      expect(state.picks[0]?.invalidated).not.toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("publishes Confidence Weekly and Season Standings from the first terminal observation", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      const { asOwner, gameId, homeTeamId } = await seed(t);
      const confidence = await asOwner.mutation(api.pools.createPool, {
        name: "Immediate Confidence Pool",
        type: "confidence",
        startWeek: 1,
        pickLockMode: "gameKickoff",
      });
      await asOwner.mutation(api.confidencePicks.ensurePickSheet, {
        poolId: confidence.poolId,
        week: 1,
      });
      await asOwner.mutation(api.confidencePicks.autosaveConfidence, {
        poolId: confidence.poolId,
        week: 1,
        predictions: [{ gameId, pickedTeamId: homeTeamId }],
        tiebreakerPrediction: 51,
      });
      await t.run(async (ctx) => {
        await ctx.db.patch(gameId, {
          scheduledKickoffMs: Date.now() - 1_000,
        });
      });
      await asOwner.mutation(
        api.confidencePicks.materializeConfidenceLocks,
        { poolId: confidence.poolId, week: 1 },
      );

      await t.action(internal.syncApiSportsLive.applySuccessfulSlateBatch, {
        observations: [terminalObservation()],
        nowMs: NOW_MS + 30_000,
      });
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());

      const standings = await asOwner.query(
        api.confidenceScoring.getConfidenceStandings,
        { poolId: confidence.poolId, week: 1 },
      );
      expect(standings?.weekly.official).toBe(true);
      expect(standings?.weekly.rows[0]).toMatchObject({
        points: 16,
        possibleRemainingPoints: 0,
        rank: 1,
        correctPickCount: 1,
      });
      expect(standings?.season.official).toBe(true);
      expect(standings?.season.rows[0]).toMatchObject({
        seasonPoints: 16,
        seasonRank: 1,
        wins: 1,
        losses: 0,
      });
      const revisions = await t.run(async (ctx) =>
        ctx.db
          .query("scoringRevisions")
          .withIndex("by_poolId_and_week", (q) =>
            q.eq("poolId", confidence.poolId).eq("week", 1),
          )
          .collect(),
      );
      expect(revisions).toHaveLength(1);
      expect(revisions[0]?.kind).toBe("confidence");
    } finally {
      vi.useRealTimers();
    }
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
