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
import { createLogger, errorMessage } from "./lib/log";
import {
  fetchNflTeams,
  fetchSeasonEvents,
  sportsDbApiKey,
} from "./providers/thesportsdb/client";
import {
  canonicalNflTeam,
  nflGameStableKey,
} from "./providers/sportsData/identity";
import type { NflTeamStableKey } from "./providers/sportsData/catalog";
import {
  attachNflTeamAlias,
  LEGACY_SPORTS_DB_PROVIDER,
  persistReconciledNflGame,
  reconcileStoredNflGame,
  reconcileStoredNflTeam,
  SportsIdentityConflict,
} from "./providers/sportsData/identityStore";

const log = createLogger("bootstrap");

const normalizedTeamValidator = v.object({
  stableKey: v.string(),
  name: v.string(),
  abbreviation: v.string(),
  logoUrl: v.optional(v.string()),
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
      log.warn("operator_denied", {
        reason: "not_production_operator",
        clerkUserId: identity.subject,
      });
      throw new AuthError("Production Operator required");
    }
    log.info("operator_asserted", { clerkUserId: identity.subject });
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

    const teamIdentities = new Map<
      string,
      {
        id: Id<"nflTeams">;
        stableKey: NflTeamStableKey;
      }
    >();

    for (const team of args.teams as NormalizedNflTeam[]) {
      const canonicalTeam = canonicalNflTeam(team.abbreviation);
      if (!canonicalTeam) {
        throw new SportsIdentityConflict(
          "alias_identity_mismatch",
          `Unknown canonical NFL Team abbreviation: ${team.abbreviation}`,
        );
      }
      const alias = {
        provider: LEGACY_SPORTS_DB_PROVIDER,
        externalId: team.aliases.sportsDbTeamId,
      } as const;
      const reconciliation = await reconcileStoredNflTeam(ctx, {
        alias,
        stableKey: canonicalTeam.stableKey,
        legacySportsDbTeamId: team.aliases.sportsDbTeamId,
      });

      let teamId: Id<"nflTeams">;
      if (reconciliation.kind === "resolved") {
        teamId = reconciliation.nflTeamId;
        await ctx.db.patch(teamId, {
          stableKey: canonicalTeam.stableKey,
          name: team.name,
          abbreviation: canonicalTeam.abbreviation,
          logoUrl: team.logoUrl,
          sportsDbTeamId: team.aliases.sportsDbTeamId,
        });
      } else {
        teamId = await ctx.db.insert("nflTeams", {
          stableKey: canonicalTeam.stableKey,
          name: team.name,
          abbreviation: canonicalTeam.abbreviation,
          logoUrl: team.logoUrl,
          sportsDbTeamId: team.aliases.sportsDbTeamId,
        });
      }
      await attachNflTeamAlias(ctx, {
        nflTeamId: teamId,
        alias,
        observedAtMs: nowMs,
      });
      teamIdentities.set(team.stableKey, {
        id: teamId,
        stableKey: canonicalTeam.stableKey,
      });
    }

    for (const game of args.games as NormalizedNflGame[]) {
      const homeTeam = teamIdentities.get(game.homeTeamStableKey);
      const awayTeam = teamIdentities.get(game.awayTeamStableKey);
      if (!homeTeam || !awayTeam) {
        throw new Error(
          `Missing NFL Team for game ${game.aliases.sportsDbEventId}`,
        );
      }

      const homeCanonical = canonicalNflTeam(
        (args.teams as NormalizedNflTeam[]).find(
          (team) => team.stableKey === game.homeTeamStableKey,
        )?.abbreviation ?? "",
      );
      const awayCanonical = canonicalNflTeam(
        (args.teams as NormalizedNflTeam[]).find(
          (team) => team.stableKey === game.awayTeamStableKey,
        )?.abbreviation ?? "",
      );
      if (!homeCanonical || !awayCanonical) {
        throw new SportsIdentityConflict(
          "alias_identity_mismatch",
          `Missing canonical NFL Team identity for game ${game.aliases.sportsDbEventId}`,
        );
      }
      const stableKey = nflGameStableKey({
        seasonYear: year,
        week: game.week,
        homeTeamAbbreviation: homeCanonical.abbreviation,
        awayTeamAbbreviation: awayCanonical.abbreviation,
      });
      const alias = {
        provider: LEGACY_SPORTS_DB_PROVIDER,
        externalId: game.aliases.sportsDbEventId,
      } as const;
      const reconciliation = await reconcileStoredNflGame(ctx, {
        alias,
        seasonId: season._id,
        week: game.week,
        homeTeamId: homeTeam.id,
        awayTeamId: awayTeam.id,
        homeTeamStableKey: homeTeam.stableKey,
        awayTeamStableKey: awayTeam.stableKey,
        scheduledKickoffMs: game.scheduledKickoffMs,
      });

      const fields = {
        stableKey,
        seasonId: season._id,
        seasonLabel: args.seasonLabel,
        week: game.week,
        homeTeamId: homeTeam.id,
        awayTeamId: awayTeam.id,
        scheduledKickoffMs: game.scheduledKickoffMs,
        lifecycle: game.lifecycle,
        homeScore: game.homeScore,
        awayScore: game.awayScore,
        sportsDbEventId: game.aliases.sportsDbEventId,
      };

      await persistReconciledNflGame(ctx, {
        reconciliation,
        fields,
        alias,
        observedAtMs: nowMs,
      });
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

    log.info("bootstrap_applied", {
      seasonId: season._id,
      seasonLabel: args.seasonLabel,
      status: availability.status,
      usableStartWeek: availability.usableStartWeek ?? null,
      teamCount: args.teams.length,
      gameCount: args.games.length,
      syncGateEnabled: gateEnabled,
      deploymentKind,
      actorClerkUserId: args.actorClerkUserId,
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
  const startedAtMs = Date.now();
  log.info("bootstrap_fetch_started", {
    seasonLabel,
    actorClerkUserId: actor.clerkUserId,
  });
  try {
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

    log.info("bootstrap_fetch_finished", {
      seasonLabel,
      teamCount: teams.length,
      gameCount: games.length,
      durationMs: Date.now() - startedAtMs,
    });

    return await ctx.runMutation(internal.bootstrap.applyNormalizedBootstrap, {
      seasonLabel,
      teams,
      games,
      actorTokenIdentifier: actor.tokenIdentifier,
      actorClerkUserId: actor.clerkUserId,
    });
  } catch (error) {
    log.error("bootstrap_fetch_failed", {
      seasonLabel,
      actorClerkUserId: actor.clerkUserId,
      error: errorMessage(error),
      durationMs: Date.now() - startedAtMs,
    });
    throw error;
  }
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
 *   bunx convex run bootstrap:runSeasonBootstrapCli '{"seasonLabel":"2025"}'
 *
 * For browse-ready Dev data without SportsDB, prefer:
 *   bunx convex run seedDemo:seedDemoWorld '{"ownerClerkUserId":"user_…"}'
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
