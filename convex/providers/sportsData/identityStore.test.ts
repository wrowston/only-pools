/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "../../_generated/api";
import schema from "../../schema";
import {
  attachNflGameAlias,
  inspectNflGameIdentityByAlias,
  inspectNflTeamIdentityByAlias,
  LEGACY_SPORTS_DB_PROVIDER,
} from "./identityStore";

const modules = import.meta.glob("../../**/*.ts");
const actor = {
  actorTokenIdentifier: "operator|identity-test",
  actorClerkUserId: "operator_identity_test",
};

function legacyBootstrapInput(
  sportsDbEventId: string,
  scheduledKickoffMs: number,
) {
  return {
    seasonLabel: "2026",
    teams: [
      {
        stableKey: "nfl-team:134939",
        name: "Detroit Lions",
        abbreviation: "DET",
        logoUrl: "https://example.test/det.png",
        aliases: { sportsDbTeamId: "134939" },
      },
      {
        stableKey: "nfl-team:134927",
        name: "Green Bay Packers",
        abbreviation: "GB",
        logoUrl: "https://example.test/gb.png",
        aliases: { sportsDbTeamId: "134927" },
      },
    ],
    games: [
      {
        stableKey: `nfl-game:2026:${sportsDbEventId}`,
        seasonLabel: "2026",
        week: 4,
        homeTeamStableKey: "nfl-team:134927",
        awayTeamStableKey: "nfl-team:134939",
        scheduledKickoffMs,
        lifecycle: "scheduled" as const,
        homeScore: null,
        awayScore: null,
        aliases: { sportsDbEventId },
      },
    ],
    ...actor,
  };
}

describe("generic sports identity storage", () => {
  it("keeps one competitive NFL Game across provider-id and kickoff replacements", async () => {
    const t = convexTest(schema, modules);
    const originalKickoffMs = Date.parse("2026-09-27T17:00:00Z");
    const movedKickoffMs = Date.parse("2026-09-27T20:25:00Z");

    await t.mutation(
      internal.bootstrap.applyNormalizedBootstrap,
      legacyBootstrapInput("sportsdb-old", originalKickoffMs),
    );
    await t.mutation(
      internal.bootstrap.applyNormalizedBootstrap,
      legacyBootstrapInput("sportsdb-replacement", movedKickoffMs),
    );
    const historicalAliasGameId = await t.query(
      internal.syncLive.findGameBySportsDbEventId,
      { sportsDbEventId: "sportsdb-old" },
    );
    const oldIdentity = await t.run(async (ctx) =>
      await inspectNflGameIdentityByAlias(ctx, {
        provider: LEGACY_SPORTS_DB_PROVIDER,
        externalId: "sportsdb-old",
      }),
    );
    const replacementIdentity = await t.run(async (ctx) =>
      await inspectNflGameIdentityByAlias(ctx, {
        provider: LEGACY_SPORTS_DB_PROVIDER,
        externalId: "sportsdb-replacement",
      }),
    );
    const lionsIdentity = await t.run(async (ctx) =>
      await inspectNflTeamIdentityByAlias(ctx, {
        provider: LEGACY_SPORTS_DB_PROVIDER,
        externalId: "134939",
      }),
    );
    const packersIdentity = await t.run(async (ctx) =>
      await inspectNflTeamIdentityByAlias(ctx, {
        provider: LEGACY_SPORTS_DB_PROVIDER,
        externalId: "134927",
      }),
    );

    expect(lionsIdentity.stableKey).toBe("nfl-team:franchise-11");
    expect(packersIdentity.stableKey).toBe("nfl-team:franchise-12");
    expect(oldIdentity).toMatchObject({
      stableKey: "nfl-game:2026:w4:franchise-11@franchise-12",
      scheduledKickoffMs: movedKickoffMs,
    });
    expect(historicalAliasGameId).toBe(oldIdentity.nflGameId);
    expect(replacementIdentity.nflGameId).toBe(oldIdentity.nflGameId);
    expect(oldIdentity.aliases).toEqual([
      {
        provider: "the-sports-db",
        externalId: "sportsdb-old",
        isCurrent: false,
      },
      {
        provider: "the-sports-db",
        externalId: "sportsdb-replacement",
        isCurrent: true,
      },
    ]);
    expect(oldIdentity.scheduleHistoryMs).toEqual([
      originalKickoffMs,
      movedKickoffMs,
    ]);
  });

  it("detects duplicate and four-row ambiguous alias ownership in Convex storage", async () => {
    const t = convexTest(schema, modules);
    const kickoffMs = Date.parse("2026-09-27T17:00:00Z");
    await t.mutation(
      internal.bootstrap.applyNormalizedBootstrap,
      legacyBootstrapInput("sportsdb-original", kickoffMs),
    );

    await t.run(async (ctx) => {
      const [game] = await ctx.db.query("nflGames").take(1);
      if (!game) throw new Error("Expected seeded NFL Game");
      const secondGameId = await ctx.db.insert("nflGames", {
        stableKey: `${game.stableKey}:duplicate`,
        seasonId: game.seasonId,
        seasonLabel: game.seasonLabel,
        week: game.week,
        homeTeamId: game.homeTeamId,
        awayTeamId: game.awayTeamId,
        scheduledKickoffMs: game.scheduledKickoffMs,
        lifecycle: game.lifecycle,
        homeScore: game.homeScore,
        awayScore: game.awayScore,
        sportsDbEventId: "legacy-duplicate",
      });
      const atMs = Date.parse("2026-08-01T00:00:00Z");

      await ctx.db.insert("nflGameAliases", {
        nflGameId: game._id,
        provider: LEGACY_SPORTS_DB_PROVIDER,
        externalId: "duplicate",
        isCurrent: false,
        firstObservedAtMs: atMs,
        lastObservedAtMs: atMs,
      });
      await ctx.db.insert("nflGameAliases", {
        nflGameId: game._id,
        provider: LEGACY_SPORTS_DB_PROVIDER,
        externalId: "duplicate",
        isCurrent: false,
        firstObservedAtMs: atMs,
        lastObservedAtMs: atMs,
      });
      await ctx.db.insert("nflGameAliases", {
        nflGameId: game._id,
        provider: LEGACY_SPORTS_DB_PROVIDER,
        externalId: "ambiguous",
        isCurrent: false,
        firstObservedAtMs: atMs,
        lastObservedAtMs: atMs,
      });
      await ctx.db.insert("nflGameAliases", {
        nflGameId: game._id,
        provider: LEGACY_SPORTS_DB_PROVIDER,
        externalId: "ambiguous",
        isCurrent: false,
        firstObservedAtMs: atMs + 1,
        lastObservedAtMs: atMs + 1,
      });
      await ctx.db.insert("nflGameAliases", {
        nflGameId: game._id,
        provider: LEGACY_SPORTS_DB_PROVIDER,
        externalId: "ambiguous",
        isCurrent: false,
        firstObservedAtMs: atMs + 2,
        lastObservedAtMs: atMs + 2,
      });
      await ctx.db.insert("nflGameAliases", {
        nflGameId: secondGameId,
        provider: LEGACY_SPORTS_DB_PROVIDER,
        externalId: "ambiguous",
        isCurrent: false,
        firstObservedAtMs: atMs,
        lastObservedAtMs: atMs,
      });

    });
    const ownership = {
      duplicate: await t.run(async (ctx) =>
        await inspectNflGameIdentityByAlias(ctx, {
          provider: LEGACY_SPORTS_DB_PROVIDER,
          externalId: "duplicate",
        }),
      ),
      ambiguous: await t.run(async (ctx) =>
        await inspectNflGameIdentityByAlias(ctx, {
          provider: LEGACY_SPORTS_DB_PROVIDER,
          externalId: "ambiguous",
        }),
      ),
    };

    expect(ownership.duplicate.ownership).toMatchObject({
      kind: "duplicate",
      rowCount: 2,
    });
    expect(ownership.ambiguous.ownership).toMatchObject({
      kind: "ambiguous",
    });
    if (ownership.ambiguous.ownership.kind === "ambiguous") {
      expect(
        new Set(ownership.ambiguous.ownership.ownerIds).size,
      ).toBe(2);
    }
  });

  it("retires and restores a historical alias for its owner while rejecting reuse by another game", async () => {
    const t = convexTest(schema, modules);
    const originalKickoffMs = Date.parse("2026-09-27T17:00:00Z");
    const movedKickoffMs = Date.parse("2026-09-27T20:25:00Z");

    await t.mutation(
      internal.bootstrap.applyNormalizedBootstrap,
      legacyBootstrapInput("sportsdb-old", originalKickoffMs),
    );
    await t.mutation(
      internal.bootstrap.applyNormalizedBootstrap,
      legacyBootstrapInput("sportsdb-replacement", movedKickoffMs),
    );
    await t.mutation(
      internal.bootstrap.applyNormalizedBootstrap,
      legacyBootstrapInput("sportsdb-old", movedKickoffMs),
    );

    const restored = await t.run(async (ctx) =>
      await inspectNflGameIdentityByAlias(ctx, {
        provider: LEGACY_SPORTS_DB_PROVIDER,
        externalId: "sportsdb-old",
      }),
    );
    expect(restored.aliases).toEqual([
      {
        provider: LEGACY_SPORTS_DB_PROVIDER,
        externalId: "sportsdb-old",
        isCurrent: true,
      },
      {
        provider: LEGACY_SPORTS_DB_PROVIDER,
        externalId: "sportsdb-replacement",
        isCurrent: false,
      },
    ]);

    await expect(
      t.run(async (ctx) => {
        if (restored.ownership.kind !== "owned") {
          throw new Error("Expected restored alias owner");
        }
        const game = await ctx.db.get(restored.ownership.ownerId);
        if (!game) throw new Error("Expected restored NFL Game");
        const secondGameId = await ctx.db.insert("nflGames", {
          stableKey: `${game.stableKey}:other-owner`,
          seasonId: game.seasonId,
          seasonLabel: game.seasonLabel,
          week: game.week,
          homeTeamId: game.homeTeamId,
          awayTeamId: game.awayTeamId,
          scheduledKickoffMs: game.scheduledKickoffMs,
          lifecycle: game.lifecycle,
          homeScore: game.homeScore,
          awayScore: game.awayScore,
          sportsDbEventId: "other-owner",
        });
        await attachNflGameAlias(ctx, {
          nflGameId: secondGameId,
          alias: {
            provider: LEGACY_SPORTS_DB_PROVIDER,
            externalId: "sportsdb-old",
          },
          observedAtMs: movedKickoffMs + 1,
        });
      }),
    ).rejects.toMatchObject({
      name: "SportsIdentityConflict",
      code: "alias_owner_mismatch",
    });
  });

  it("applies identical Season Bootstrap input idempotently", async () => {
    const t = convexTest(schema, modules);
    const kickoffMs = Date.parse("2026-09-27T17:00:00Z");
    const input = legacyBootstrapInput("sportsdb-idempotent", kickoffMs);

    await t.mutation(internal.bootstrap.applyNormalizedBootstrap, input);
    const firstIdentity = await t.run(async (ctx) =>
      await inspectNflGameIdentityByAlias(ctx, {
        provider: LEGACY_SPORTS_DB_PROVIDER,
        externalId: "sportsdb-idempotent",
      }),
    );
    await t.mutation(internal.bootstrap.applyNormalizedBootstrap, input);
    const secondIdentity = await t.run(async (ctx) =>
      await inspectNflGameIdentityByAlias(ctx, {
        provider: LEGACY_SPORTS_DB_PROVIDER,
        externalId: "sportsdb-idempotent",
      }),
    );
    const counts = await t.run(async (ctx) => ({
      teams: (await ctx.db.query("nflTeams").take(10)).length,
      games: (await ctx.db.query("nflGames").take(10)).length,
      teamAliases: (await ctx.db.query("nflTeamAliases").take(10))
        .length,
      gameAliases: (await ctx.db.query("nflGameAliases").take(10))
        .length,
      scheduleHistory: (
        await ctx.db.query("nflGameScheduleHistory").take(10)
      ).length,
    }));

    expect(secondIdentity.nflGameId).toBe(firstIdentity.nflGameId);
    expect(secondIdentity.aliases).toHaveLength(1);
    expect(secondIdentity.scheduleHistoryMs).toEqual([kickoffMs]);
    expect(counts).toEqual({
      teams: 2,
      games: 1,
      teamAliases: 2,
      gameAliases: 1,
      scheduleHistory: 1,
    });
  });
});
