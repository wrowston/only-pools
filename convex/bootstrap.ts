import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  mutation,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { AuthError } from "./lib/auth";
import { evaluateBootstrapAvailability } from "./lib/bootstrapAvailability";
import { isProductionOperator } from "./lib/operator";
import {
  defaultSyncGateEnabled,
  resolveDeploymentKind,
} from "./lib/syncGate";
import {
  normalizeSeasonEvents,
  normalizeTeams,
  type NormalizedNflGame,
  type NormalizedNflTeam,
  type SportsDbEvent,
  type SportsDbTeam,
} from "./providers/thesportsdb/adapter";
import {
  fetchNflTeams,
  fetchSeasonEvents,
  sportsDbApiKey,
} from "./providers/thesportsdb/client";

const normalizedTeamValidator = v.object({
  stableKey: v.string(),
  name: v.string(),
  abbreviation: v.string(),
  aliases: v.object({ sportsDbTeamId: v.string() }),
});

const normalizedGameValidator = v.object({
  stableKey: v.string(),
  seasonLabel: v.string(),
  week: v.number(),
  homeTeamStableKey: v.string(),
  awayTeamStableKey: v.string(),
  scheduledKickoffMs: v.number(),
  lifecycle: v.union(
    v.literal("scheduled"),
    v.literal("in_progress"),
    v.literal("interrupted"),
    v.literal("postponed"),
    v.literal("canceled"),
    v.literal("terminal"),
    v.literal("unknown"),
  ),
  homeScore: v.union(v.number(), v.null()),
  awayScore: v.union(v.number(), v.null()),
  aliases: v.object({ sportsDbEventId: v.string() }),
});

function yearFromSeasonLabel(seasonLabel: string): number {
  const year = Number.parseInt(seasonLabel, 10);
  if (!Number.isFinite(year)) {
    throw new Error(`Invalid season label: ${seasonLabel}`);
  }
  return year;
}

export const assertProductionOperator = internalMutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) {
      throw new AuthError("Unauthenticated");
    }
    const allowed = isProductionOperator(
      {
        tokenIdentifier: identity.tokenIdentifier,
        clerkUserId: identity.subject,
      },
      process.env as Record<string, string | undefined>,
    );
    if (!allowed) {
      throw new AuthError("Production Operator required");
    }
    return {
      tokenIdentifier: identity.tokenIdentifier,
      clerkUserId: identity.subject,
    };
  },
});

/**
 * Apply normalized teams/games from Season Bootstrap (or tests).
 * Marks the Pool Season Available only when a usable Start Week exists.
 */
export const applyNormalizedBootstrap = internalMutation({
  args: {
    seasonLabel: v.string(),
    teams: v.array(normalizedTeamValidator),
    games: v.array(normalizedGameValidator),
    actorTokenIdentifier: v.string(),
    actorClerkUserId: v.string(),
    nowMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const nowMs = args.nowMs ?? Date.now();
    const year = yearFromSeasonLabel(args.seasonLabel);

    let season = await ctx.db
      .query("poolSeasons")
      .withIndex("by_label", (q) => q.eq("label", args.seasonLabel))
      .unique();

    if (season === null) {
      const seasonId = await ctx.db.insert("poolSeasons", {
        label: args.seasonLabel,
        year,
        status: "bootstrapping",
      });
      season = await ctx.db.get(seasonId);
      if (season === null) {
        throw new Error("Failed to create Pool Season");
      }
    } else {
      await ctx.db.patch(season._id, {
        year,
        status: "bootstrapping",
        usableStartWeek: undefined,
      });
      season = await ctx.db.get(season._id);
      if (season === null) {
        throw new Error("Pool Season missing after patch");
      }
    }

    const teamDocIds = new Map<string, Id<"nflTeams">>();

    for (const team of args.teams as NormalizedNflTeam[]) {
      const existing = await ctx.db
        .query("nflTeams")
        .withIndex("by_stableKey", (q) => q.eq("stableKey", team.stableKey))
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, {
          name: team.name,
          abbreviation: team.abbreviation,
          sportsDbTeamId: team.aliases.sportsDbTeamId,
        });
        teamDocIds.set(team.stableKey, existing._id);
      } else {
        const id = await ctx.db.insert("nflTeams", {
          stableKey: team.stableKey,
          name: team.name,
          abbreviation: team.abbreviation,
          sportsDbTeamId: team.aliases.sportsDbTeamId,
        });
        teamDocIds.set(team.stableKey, id);
      }
    }

    for (const game of args.games as NormalizedNflGame[]) {
      const homeTeamId = teamDocIds.get(game.homeTeamStableKey);
      const awayTeamId = teamDocIds.get(game.awayTeamStableKey);
      if (!homeTeamId || !awayTeamId) {
        throw new Error(
          `Missing NFL Team for game ${game.aliases.sportsDbEventId}`,
        );
      }

      const existing = await ctx.db
        .query("nflGames")
        .withIndex("by_stableKey", (q) => q.eq("stableKey", game.stableKey))
        .unique();

      const fields = {
        seasonId: season._id,
        seasonLabel: args.seasonLabel,
        week: game.week,
        homeTeamId,
        awayTeamId,
        scheduledKickoffMs: game.scheduledKickoffMs,
        lifecycle: game.lifecycle,
        homeScore: game.homeScore,
        awayScore: game.awayScore,
        sportsDbEventId: game.aliases.sportsDbEventId,
      };

      if (existing) {
        await ctx.db.patch(existing._id, fields);
      } else {
        await ctx.db.insert("nflGames", {
          stableKey: game.stableKey,
          ...fields,
        });
      }
    }

    const availability = evaluateBootstrapAvailability(
      (args.games as NormalizedNflGame[]).map((g) => ({
        week: g.week,
        scheduledKickoffMs: g.scheduledKickoffMs,
        lifecycle: g.lifecycle,
      })),
      nowMs,
    );

    await ctx.db.patch(season._id, {
      status: availability.status,
      usableStartWeek: availability.usableStartWeek ?? undefined,
      bootstrappedAtMs: nowMs,
    });

    const deploymentKind = resolveDeploymentKind(
      process.env as Record<string, string | undefined>,
    );
    const gateEnabled = defaultSyncGateEnabled(deploymentKind);
    const existingGate = await ctx.db
      .query("syncGate")
      .withIndex("by_key", (q) => q.eq("key", "deployment"))
      .unique();
    if (existingGate) {
      await ctx.db.patch(existingGate._id, {
        enabled: gateEnabled,
        updatedAtMs: nowMs,
        updatedByTokenIdentifier: args.actorTokenIdentifier,
      });
    } else {
      await ctx.db.insert("syncGate", {
        key: "deployment",
        enabled: gateEnabled,
        updatedAtMs: nowMs,
        updatedByTokenIdentifier: args.actorTokenIdentifier,
      });
    }

    await ctx.db.insert("operatorAuditEvents", {
      action: "season_bootstrap",
      actorTokenIdentifier: args.actorTokenIdentifier,
      actorClerkUserId: args.actorClerkUserId,
      atMs: nowMs,
      detailsJson: JSON.stringify({
        seasonLabel: args.seasonLabel,
        status: availability.status,
        usableStartWeek: availability.usableStartWeek,
        teamCount: args.teams.length,
        gameCount: args.games.length,
        syncGateEnabled: gateEnabled,
        deploymentKind,
      }),
    });

    return {
      seasonId: season._id,
      status: availability.status,
      usableStartWeek: availability.usableStartWeek,
      syncGateEnabled: gateEnabled,
      teamCount: args.teams.length,
      gameCount: args.games.length,
    };
  },
});

type OperatorActor = {
  tokenIdentifier: string;
  clerkUserId: string;
};

type BootstrapApplyResult = {
  seasonId: Id<"poolSeasons">;
  status: "bootstrapping" | "available";
  usableStartWeek: number | null;
  syncGateEnabled: boolean;
  teamCount: number;
  gameCount: number;
};

async function fetchAndApplyBootstrap(
  ctx: {
    runMutation: (
      ref: typeof internal.bootstrap.applyNormalizedBootstrap,
      args: {
        seasonLabel: string;
        teams: NormalizedNflTeam[];
        games: NormalizedNflGame[];
        actorTokenIdentifier: string;
        actorClerkUserId: string;
      },
    ) => Promise<BootstrapApplyResult>;
  },
  seasonLabel: string,
  actor: OperatorActor,
): Promise<BootstrapApplyResult> {
  const apiKey = sportsDbApiKey();
  const [rawTeams, rawEvents] = await Promise.all([
    fetchNflTeams(apiKey),
    fetchSeasonEvents(seasonLabel, apiKey),
  ]);

  const teams = normalizeTeams(rawTeams as SportsDbTeam[]);
  const games = normalizeSeasonEvents(
    rawEvents as SportsDbEvent[],
    seasonLabel,
  );

  return await ctx.runMutation(internal.bootstrap.applyNormalizedBootstrap, {
    seasonLabel,
    teams,
    games,
    actorTokenIdentifier: actor.tokenIdentifier,
    actorClerkUserId: actor.clerkUserId,
  });
}

/**
 * Season Bootstrap — Production Operator only (authenticated).
 * Fetches TheSportsDB from Convex actions; clients never call the provider.
 */
export const runSeasonBootstrap = action({
  args: {
    seasonLabel: v.string(),
  },
  handler: async (ctx, args): Promise<BootstrapApplyResult> => {
    const actor: OperatorActor = await ctx.runMutation(
      internal.bootstrap.assertProductionOperator,
      {},
    );
    return await fetchAndApplyBootstrap(ctx, args.seasonLabel, actor);
  },
});

/**
 * CLI / dashboard Season Bootstrap for Dev.
 * Authorized by Convex deploy access + required operator env (no Clerk session).
 * Prefer the authenticated public action in Production.
 *
 *   bunx convex run internal.bootstrap:runSeasonBootstrapCli '{"seasonLabel":"2025"}'
 */
export const runSeasonBootstrapCli = internalAction({
  args: {
    seasonLabel: v.string(),
  },
  handler: async (ctx, args): Promise<BootstrapApplyResult> => {
    const clerkUserId =
      process.env.PRODUCTION_OPERATOR_CLERK_USER_ID?.trim() ||
      process.env.PRODUCTION_OPERATOR_TOKEN_IDENTIFIER?.trim();
    if (!clerkUserId) {
      throw new Error(
        "Set PRODUCTION_OPERATOR_CLERK_USER_ID (or TOKEN_IDENTIFIER) before CLI bootstrap",
      );
    }
    const actor: OperatorActor = {
      tokenIdentifier: `cli|${clerkUserId}`,
      clerkUserId,
    };
    return await fetchAndApplyBootstrap(ctx, args.seasonLabel, actor);
  },
});

/**
 * Fixture-driven Season Bootstrap after operator check (no live provider calls).
 * Used by integration tests and local dry-runs with normalized payloads.
 */
export const runSeasonBootstrapNormalized = mutation({
  args: {
    seasonLabel: v.string(),
    teams: v.array(normalizedTeamValidator),
    games: v.array(normalizedGameValidator),
    nowMs: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<BootstrapApplyResult> => {
    const actor: OperatorActor = await ctx.runMutation(
      internal.bootstrap.assertProductionOperator,
      {},
    );
    const result: BootstrapApplyResult = await ctx.runMutation(
      internal.bootstrap.applyNormalizedBootstrap,
      {
        seasonLabel: args.seasonLabel,
        teams: args.teams,
        games: args.games,
        actorTokenIdentifier: actor.tokenIdentifier,
        actorClerkUserId: actor.clerkUserId,
        nowMs: args.nowMs,
      },
    );
    return result;
  },
});
