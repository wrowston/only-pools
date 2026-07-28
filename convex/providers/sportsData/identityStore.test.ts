/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import schema from "../../schema";
import { CANONICAL_NFL_TEAMS } from "./catalog";
import {
  attachNflGameAlias,
  attachNflTeamAlias,
  inspectNflGameIdentityByAlias,
  inspectNflTeamIdentityByAlias,
  persistReconciledNflGame,
  reconcileStoredNflGame,
  reconcileStoredNflTeam,
  recordNflGameSchedule,
  SportsIdentityConflict,
} from "./identityStore";

const modules = import.meta.glob("../../**/*.ts");
const PROVIDER = "api-sports";

async function seedGame(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const seasonId = await ctx.db.insert("poolSeasons", {
      label: "2026",
      year: 2026,
      status: "available",
      usableStartWeek: 1,
    });
    const homeTeamId = await ctx.db.insert("nflTeams", {
      stableKey: CANONICAL_NFL_TEAMS.GB.stableKey,
      name: CANONICAL_NFL_TEAMS.GB.name,
      abbreviation: "GB",
    });
    const awayTeamId = await ctx.db.insert("nflTeams", {
      stableKey: CANONICAL_NFL_TEAMS.DET.stableKey,
      name: CANONICAL_NFL_TEAMS.DET.name,
      abbreviation: "DET",
    });
    const scheduledKickoffMs = Date.parse("2026-09-27T17:00:00Z");
    const gameId = await ctx.db.insert("nflGames", {
      stableKey: "nfl-game:2026:w4:det@gb",
      seasonId,
      seasonLabel: "2026",
      week: 4,
      homeTeamId,
      awayTeamId,
      scheduledKickoffMs,
      lifecycle: "scheduled",
      homeScore: null,
      awayScore: null,
    });
    await attachNflGameAlias(ctx, {
      nflGameId: gameId,
      alias: { provider: PROVIDER, externalId: "1001" },
      observedAtMs: scheduledKickoffMs,
    });
    await recordNflGameSchedule(ctx, {
      nflGameId: gameId,
      seasonId,
      week: 4,
      homeTeamId,
      awayTeamId,
      scheduledKickoffMs,
      observedAtMs: scheduledKickoffMs,
    });
    return {
      seasonId,
      homeTeamId,
      awayTeamId,
      gameId,
      scheduledKickoffMs,
    };
  });
}

describe("generic sports identity storage", () => {
  it("keeps one NFL Game across provider alias and kickoff replacements", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedGame(t);
    const movedKickoffMs = Date.parse("2026-09-27T20:25:00Z");

    await t.run(async (ctx) => {
      const alias = { provider: PROVIDER, externalId: "1002" } as const;
      const reconciliation = await reconcileStoredNflGame(ctx, {
        alias,
        seasonId: seeded.seasonId,
        week: 4,
        homeTeamId: seeded.homeTeamId,
        awayTeamId: seeded.awayTeamId,
        homeTeamStableKey: CANONICAL_NFL_TEAMS.GB.stableKey,
        awayTeamStableKey: CANONICAL_NFL_TEAMS.DET.stableKey,
        scheduledKickoffMs: movedKickoffMs,
      });
      expect(reconciliation).toEqual({
        kind: "resolved",
        nflGameId: seeded.gameId,
      });
      await persistReconciledNflGame(ctx, {
        reconciliation,
        alias,
        observedAtMs: movedKickoffMs,
        fields: {
          stableKey: "nfl-game:2026:w4:det@gb",
          seasonId: seeded.seasonId,
          seasonLabel: "2026",
          week: 4,
          homeTeamId: seeded.homeTeamId,
          awayTeamId: seeded.awayTeamId,
          scheduledKickoffMs: movedKickoffMs,
          lifecycle: "scheduled",
          homeScore: null,
          awayScore: null,
        },
      });
    });

    const original = await t.run((ctx) =>
      inspectNflGameIdentityByAlias(ctx, {
        provider: PROVIDER,
        externalId: "1001",
      }),
    );
    const replacement = await t.run((ctx) =>
      inspectNflGameIdentityByAlias(ctx, {
        provider: PROVIDER,
        externalId: "1002",
      }),
    );
    expect(original.nflGameId).toBe(seeded.gameId);
    expect(replacement.nflGameId).toBe(seeded.gameId);
    expect(replacement).toMatchObject({
      scheduledKickoffMs: movedKickoffMs,
      aliases: [
        { externalId: "1001", isCurrent: false },
        { externalId: "1002", isCurrent: true },
      ],
      scheduleHistoryMs: [seeded.scheduledKickoffMs, movedKickoffMs],
    });
  });

  it("resolves team identity from canonical keys and provider aliases", async () => {
    const t = convexTest(schema, modules);
    const { homeTeamId } = await seedGame(t);
    await t.run(async (ctx) => {
      await attachNflTeamAlias(ctx, {
        nflTeamId: homeTeamId,
        alias: { provider: PROVIDER, externalId: "9" },
        observedAtMs: 1,
      });
      await expect(
        reconcileStoredNflTeam(ctx, {
          alias: { provider: PROVIDER, externalId: "9" },
          stableKey: CANONICAL_NFL_TEAMS.GB.stableKey,
        }),
      ).resolves.toEqual({ kind: "resolved", nflTeamId: homeTeamId });
    });
    const identity = await t.run((ctx) =>
      inspectNflTeamIdentityByAlias(ctx, {
        provider: PROVIDER,
        externalId: "9",
      }),
    );
    expect(identity).toMatchObject({
      nflTeamId: homeTeamId,
      stableKey: CANONICAL_NFL_TEAMS.GB.stableKey,
    });
  });

  it("rejects duplicate alias rows for one owner", async () => {
    const t = convexTest(schema, modules);
    const { gameId } = await seedGame(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("nflGameAliases", {
        nflGameId: gameId,
        provider: PROVIDER,
        externalId: "1001",
        isCurrent: true,
        firstObservedAtMs: 2,
        lastObservedAtMs: 2,
      });
      await expect(
        attachNflGameAlias(ctx, {
          nflGameId: gameId,
          alias: { provider: PROVIDER, externalId: "1001" },
          observedAtMs: 3,
        }),
      ).rejects.toBeInstanceOf(SportsIdentityConflict);
    });
  });
});
