/**
 * One-shot: replace live sports dataset from a valid staged Season Bootstrap
 * without the full clean-activation wipe (participants / auth stay intact).
 *
 *   bunx convex run --prod applyStagedSchedule:applyStagedSeasonSchedule \
 *     '{"stageId":"…","seasonYear":2026}'
 */

import { v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import { internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

async function deleteAllInTable(
  ctx: MutationCtx,
  table:
    | "nflGameAliases"
    | "nflTeamAliases"
    | "nflGameScheduleHistory"
    | "nflGames"
    | "nflTeams"
    | "poolSeasons",
  deleted: { sports: number },
) {
  let guard = 0;
  while (guard < 40) {
    const rows = await ctx.db.query(table).take(200);
    if (rows.length === 0) break;
    for (const row of rows) {
      await ctx.db.delete(row._id);
      deleted.sports += 1;
    }
    guard += 1;
  }
}

async function deletePoolRows(
  ctx: MutationCtx,
  poolId: Id<"pools">,
  deleted: { poolRelated: number },
) {
  const memberships = await ctx.db
    .query("poolMemberships")
    .withIndex("by_poolId", (q) => q.eq("poolId", poolId))
    .take(200);
  for (const row of memberships) {
    await ctx.db.delete(row._id);
    deleted.poolRelated += 1;
  }

  const entries = await ctx.db
    .query("poolEntries")
    .withIndex("by_poolId", (q) => q.eq("poolId", poolId))
    .take(200);
  for (const row of entries) {
    await ctx.db.delete(row._id);
    deleted.poolRelated += 1;
  }

  const invites = await ctx.db
    .query("poolInvites")
    .withIndex("by_poolId_and_status", (q) => q.eq("poolId", poolId))
    .take(200);
  for (const row of invites) {
    await ctx.db.delete(row._id);
    deleted.poolRelated += 1;
  }

  // Small prod demo footprint — scan bounded pages and filter by poolId.
  for (const table of [
    "survivorPicks",
    "survivorPickOutcomes",
    "survivorTeamReservations",
    "confidencePickSets",
    "seasonStandings",
    "weeklyStandings",
    "poolAuditEvents",
    "scoringRevisions",
  ] as const) {
    let guard = 0;
    while (guard < 20) {
      const rows = await ctx.db.query(table).take(200);
      const mine = rows.filter(
        (row) => "poolId" in row && row.poolId === poolId,
      );
      if (mine.length === 0) break;
      for (const row of mine) {
        await ctx.db.delete(row._id);
        deleted.poolRelated += 1;
      }
      // If the page had no matching rows, stop; otherwise continue.
      if (mine.length === rows.length && rows.length === 200) {
        guard += 1;
        continue;
      }
      break;
    }
  }
}

export const applyStagedSeasonSchedule = internalMutation({
  args: {
    stageId: v.id("seasonBootstrapStages"),
    seasonYear: v.number(),
  },
  handler: async (ctx, args) => {
    const stage = await ctx.db.get(args.stageId);
    if (
      stage === null ||
      stage.seasonYear !== args.seasonYear ||
      stage.sourceProvider !== "api-sports" ||
      stage.validationStatus !== "valid" ||
      !stage.activationEligible
    ) {
      throw new Error(
        "Stage is not a valid activation-eligible API-Sports snapshot",
      );
    }

    const [stagedTeams, stagedGames, stagedAliases] = await Promise.all([
      ctx.db
        .query("seasonBootstrapStagedTeams")
        .withIndex("by_stageId_and_ordinal", (q) =>
          q.eq("stageId", args.stageId),
        )
        .take(64),
      ctx.db
        .query("seasonBootstrapStagedGames")
        .withIndex("by_stageId_and_ordinal", (q) =>
          q.eq("stageId", args.stageId),
        )
        .take(512),
      ctx.db
        .query("seasonBootstrapStagedAliases")
        .withIndex("by_stageId_and_ordinal", (q) =>
          q.eq("stageId", args.stageId),
        )
        .take(1024),
    ]);

    if (
      stagedTeams.length !== stage.teamCount ||
      stagedGames.length !== stage.gameCount
    ) {
      throw new Error("Staged row counts do not match the stage report");
    }

    const deleted = {
      poolRelated: 0,
      sports: 0,
    };

    const pools = await ctx.db.query("pools").take(200);
    for (const pool of pools) {
      await deletePoolRows(ctx, pool._id, deleted);
      await ctx.db.delete(pool._id);
      deleted.poolRelated += 1;
    }

    for (const table of [
      "nflGameAliases",
      "nflTeamAliases",
      "nflGameScheduleHistory",
      "nflGames",
      "nflTeams",
      "poolSeasons",
    ] as const) {
      await deleteAllInTable(ctx, table, deleted);
    }

    const nowMs = Date.now();
    const seasonId = await ctx.db.insert("poolSeasons", {
      label: String(args.seasonYear),
      year: args.seasonYear,
      status: "bootstrapping",
    });

    const teamIds = new Map<string, Id<"nflTeams">>();
    for (const team of stagedTeams) {
      const teamId = await ctx.db.insert("nflTeams", {
        stableKey: team.stableKey,
        name: team.name,
        abbreviation: team.abbreviation,
        logoUrl: team.logoUrl,
      });
      teamIds.set(team.stableKey, teamId);
    }
    for (const alias of stagedAliases) {
      if (alias.entityType !== "team") continue;
      const nflTeamId = teamIds.get(alias.entityStableKey);
      if (!nflTeamId) {
        throw new Error(`Missing team for alias ${alias.entityStableKey}`);
      }
      await ctx.db.insert("nflTeamAliases", {
        nflTeamId,
        provider: alias.provider,
        externalId: alias.externalId,
        isCurrent: true,
        firstObservedAtMs: stage.stagedAtMs,
        lastObservedAtMs: stage.stagedAtMs,
      });
    }

    const gameIds = new Map<string, Id<"nflGames">>();
    const earliestByWeek = new Map<number, number>();
    for (const game of stagedGames) {
      const homeTeam = stagedTeams.find(
        (team) => team.abbreviation === game.homeTeamAbbreviation,
      );
      const awayTeam = stagedTeams.find(
        (team) => team.abbreviation === game.awayTeamAbbreviation,
      );
      const homeTeamId = homeTeam
        ? teamIds.get(homeTeam.stableKey)
        : undefined;
      const awayTeamId = awayTeam
        ? teamIds.get(awayTeam.stableKey)
        : undefined;
      if (!homeTeamId || !awayTeamId) {
        throw new Error(`Missing teams for game ${game.stableKey}`);
      }
      const gameId = await ctx.db.insert("nflGames", {
        stableKey: game.stableKey,
        seasonId,
        seasonLabel: String(args.seasonYear),
        week: game.week,
        homeTeamId,
        awayTeamId,
        scheduledKickoffMs: game.scheduledKickoffMs,
        lifecycle: game.lifecycle,
        homeScore: game.homeScore,
        awayScore: game.awayScore,
      });
      gameIds.set(game.stableKey, gameId);
      const prev = earliestByWeek.get(game.week);
      if (prev === undefined || game.scheduledKickoffMs < prev) {
        earliestByWeek.set(game.week, game.scheduledKickoffMs);
      }
      await ctx.db.insert("nflGameScheduleHistory", {
        nflGameId: gameId,
        seasonId,
        week: game.week,
        homeTeamId,
        awayTeamId,
        scheduledKickoffMs: game.scheduledKickoffMs,
        firstObservedAtMs: game.observedAtMs,
        lastObservedAtMs: game.observedAtMs,
      });
    }
    for (const alias of stagedAliases) {
      if (alias.entityType !== "game") continue;
      const nflGameId = gameIds.get(alias.entityStableKey);
      if (!nflGameId) {
        throw new Error(`Missing game for alias ${alias.entityStableKey}`);
      }
      const stagedGame = stagedGames.find(
        (game) => game.stableKey === alias.entityStableKey,
      );
      if (!stagedGame) {
        throw new Error(`Missing staged game ${alias.entityStableKey}`);
      }
      await ctx.db.insert("nflGameAliases", {
        nflGameId,
        provider: alias.provider,
        externalId: alias.externalId,
        isCurrent: true,
        firstObservedAtMs: stagedGame.observedAtMs,
        lastObservedAtMs: stagedGame.observedAtMs,
      });
    }

    const futureWeeks = [...earliestByWeek.entries()]
      .filter(([, earliest]) => earliest > nowMs)
      .map(([week]) => week)
      .sort((a, b) => a - b);
    const usableStartWeek = futureWeeks[0] ?? 1;

    await ctx.db.patch(seasonId, {
      status: "available",
      usableStartWeek,
      bootstrappedAtMs: nowMs,
    });

    return {
      seasonId,
      seasonYear: args.seasonYear,
      stageId: args.stageId,
      teamCount: stagedTeams.length,
      gameCount: stagedGames.length,
      usableStartWeek,
      futureStartWeeks: futureWeeks.slice(0, 8),
      deleted,
      aliasProviderSample: stagedAliases[0]?.provider ?? null,
    };
  },
});
