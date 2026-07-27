import { v } from "convex/values";
import type { Auth } from "convex/server";
import {
  action,
  env,
  internalAction,
  internalMutation,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { runEffect } from "./effect/run";
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
import { ApiSportsProvider } from "./providers/apiSports";
import { selectSportsDataProvider } from "./providers/sportsData/config";
import {
  exceedsSeasonBootstrapStageLimits,
  fetchSeasonBootstrapSnapshot,
  SEASON_BOOTSTRAP_STAGE_LIMITS,
  seasonBootstrapSnapshotCounts,
  type SeasonBootstrapSnapshotCounts,
} from "./providers/sportsData/seasonBootstrap";
import {
  isSeasonBootstrapYear,
  SEASON_BOOTSTRAP_INVARIANTS,
  validateSeasonBootstrap,
  type SeasonBootstrapValidationReport,
} from "./providers/sportsData/seasonBootstrapValidation";
import type {
  SportsDataGame,
  SportsDataProviderName,
  SportsDataTeam,
} from "./providers/sportsData/types";

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

const sportsDataProviderNameValidator = v.union(
  v.literal("api-sports"),
  v.literal("in-memory"),
);

const sportsDataAliasValidator = v.object({
  provider: sportsDataProviderNameValidator,
  id: v.string(),
});

const stagedTeamValidator = v.object({
  stableKey: v.string(),
  abbreviation: v.string(),
  name: v.string(),
  logoUrl: v.string(),
  providerAliases: v.array(sportsDataAliasValidator),
});

const stagedGameValidator = v.object({
  stableKey: v.string(),
  seasonYear: v.number(),
  week: v.number(),
  homeTeamAbbreviation: v.string(),
  awayTeamAbbreviation: v.string(),
  homeTeamProviderAlias: v.optional(sportsDataAliasValidator),
  awayTeamProviderAlias: v.optional(sportsDataAliasValidator),
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
  observedAtMs: v.number(),
  providerAliases: v.array(sportsDataAliasValidator),
});

const seasonBootstrapSnapshotCountsValidator = v.object({
  teams: v.number(),
  games: v.number(),
  teamAliases: v.number(),
  gameAliases: v.number(),
});

function yearFromSeasonLabel(seasonLabel: string): number {
  const year = Number.parseInt(seasonLabel, 10);
  if (!Number.isFinite(year)) {
    throw new Error(`Invalid season label: ${seasonLabel}`);
  }
  return year;
}

type OperatorActor = {
  tokenIdentifier: string;
  clerkUserId: string;
};

async function requireProductionOperator(
  auth: Auth,
): Promise<OperatorActor> {
  const identity = await auth.getUserIdentity();
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
}

export const assertProductionOperator = internalMutation({
  args: {},
  handler: async (ctx) => {
    return await requireProductionOperator(ctx.auth);
  },
});

type SeasonBootstrapStageResult = Readonly<{
  stageId: Id<"seasonBootstrapStages">;
  report: SeasonBootstrapValidationReport;
}>;

function oversizedSeasonBootstrapReport(
  counts: SeasonBootstrapSnapshotCounts,
): SeasonBootstrapValidationReport {
  return {
    invariantsVersion: SEASON_BOOTSTRAP_INVARIANTS.version,
    valid: false,
    activationEligible: false,
    failuresTruncated: false,
    counts: {
      teams: counts.teams,
      expectedTeams: SEASON_BOOTSTRAP_INVARIANTS.teamCount,
      games: counts.games,
      expectedGames:
        SEASON_BOOTSTRAP_INVARIANTS.regularSeasonGameCount,
      weeks: 0,
      expectedWeeks: SEASON_BOOTSTRAP_INVARIANTS.weeks.length,
      teamAliases: counts.teamAliases,
      gameAliases: counts.gameAliases,
      failures: 1,
    },
    failures: [
      {
        code: "provider_snapshot_too_large",
        scope: "season",
        message: `Provider snapshot exceeds staging limits: received ${counts.teams} teams, ${counts.games} games, and ${counts.teamAliases + counts.gameAliases} aliases; limits are ${SEASON_BOOTSTRAP_STAGE_LIMITS.teams}, ${SEASON_BOOTSTRAP_STAGE_LIMITS.games}, and ${SEASON_BOOTSTRAP_STAGE_LIMITS.aliases}`,
      },
    ],
  };
}

function boundSeasonBootstrapFailures(
  report: SeasonBootstrapValidationReport,
): SeasonBootstrapValidationReport {
  const limit = SEASON_BOOTSTRAP_STAGE_LIMITS.validationFailureRows;
  if (report.failures.length <= limit) return report;

  const retained = report.failures.slice(0, limit - 1);
  const omitted = report.failures.length - retained.length;
  return {
    ...report,
    failuresTruncated: true,
    failures: [
      ...retained,
      {
        code: "validation_report_truncated",
        scope: "season",
        message: `${omitted} additional validation failures were omitted by the ${limit}-row staging report limit`,
      },
    ],
  };
}

/**
 * Persist an immutable staged snapshot and its validation report.
 *
 * This mutation deliberately does not write Pool Seasons, NFL Teams, NFL
 * Games, Pools, picks, standings, or the Sync Gate. Activation is a separate
 * Production Operator operation owned by ticket #36.
 */
export const persistSeasonBootstrapStage = internalMutation({
  args: {
    seasonYear: v.number(),
    sourceProvider: v.literal("api-sports"),
    teams: v.array(stagedTeamValidator),
    games: v.array(stagedGameValidator),
    actorTokenIdentifier: v.string(),
    actorClerkUserId: v.string(),
    providerFailure: v.optional(
      v.object({
        code: v.union(
          v.literal("provider_configuration_failure"),
          v.literal("provider_fetch_failure"),
        ),
        message: v.string(),
      }),
    ),
    oversizedCounts: v.optional(
      seasonBootstrapSnapshotCountsValidator,
    ),
    nowMs: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<SeasonBootstrapStageResult> => {
    const nowMs = args.nowMs ?? Date.now();
    const teams = args.teams as readonly SportsDataTeam[];
    const games = args.games as readonly SportsDataGame[];
    const sourceProvider: SportsDataProviderName = args.sourceProvider;
    const inputCounts = seasonBootstrapSnapshotCounts(teams, games);
    const oversizedCounts =
      args.oversizedCounts ??
      (exceedsSeasonBootstrapStageLimits(inputCounts)
        ? inputCounts
        : null);
    const teamsToPersist = oversizedCounts ? [] : teams;
    const gamesToPersist = oversizedCounts ? [] : games;
    const validationReport = oversizedCounts
      ? oversizedSeasonBootstrapReport(oversizedCounts)
      : validateSeasonBootstrap({
          seasonYear: args.seasonYear,
          sourceProvider,
          teams,
          games,
        });
    const providerFailure = args.providerFailure
      ? {
          ...args.providerFailure,
          message: args.providerFailure.message.trim(),
        }
      : undefined;
    const report = boundSeasonBootstrapFailures(
      providerFailure
        ? {
            ...validationReport,
            valid: false,
            activationEligible: false,
            counts: {
              ...validationReport.counts,
              failures: validationReport.counts.failures + 1,
            },
            failures: [
              {
                code: providerFailure.code,
                scope: "season",
                entityKey: args.sourceProvider,
                message: providerFailure.message,
              },
              ...validationReport.failures,
            ],
          }
        : validationReport,
    );

    const stageId = await ctx.db.insert("seasonBootstrapStages", {
      seasonYear: args.seasonYear,
      sourceProvider: args.sourceProvider,
      invariantsVersion: report.invariantsVersion,
      validationStatus: report.valid ? "valid" : "invalid",
      activationEligible: report.activationEligible,
      teamCount: report.counts.teams,
      gameCount: report.counts.games,
      weekCount: report.counts.weeks,
      teamAliasCount: report.counts.teamAliases,
      gameAliasCount: report.counts.gameAliases,
      failureCount: report.counts.failures,
      storedFailureCount: report.failures.length,
      failuresTruncated: report.failuresTruncated,
      actorTokenIdentifier: args.actorTokenIdentifier,
      actorClerkUserId: args.actorClerkUserId,
      stagedAtMs: nowMs,
    });

    let aliasOrdinal = 0;
    for (const [ordinal, team] of teamsToPersist.entries()) {
      await ctx.db.insert("seasonBootstrapStagedTeams", {
        stageId,
        ordinal,
        stableKey: team.stableKey,
        abbreviation: team.abbreviation,
        name: team.name,
        logoUrl: team.logoUrl,
      });
      for (const alias of team.providerAliases) {
        await ctx.db.insert("seasonBootstrapStagedAliases", {
          stageId,
          ordinal: aliasOrdinal++,
          entityType: "team",
          entityStableKey: team.stableKey,
          provider: alias.provider,
          externalId: alias.id,
        });
      }
    }

    for (const [ordinal, game] of gamesToPersist.entries()) {
      await ctx.db.insert("seasonBootstrapStagedGames", {
        stageId,
        ordinal,
        stableKey: game.stableKey,
        seasonYear: game.seasonYear,
        week: game.week,
        homeTeamAbbreviation: game.homeTeamAbbreviation,
        awayTeamAbbreviation: game.awayTeamAbbreviation,
        homeTeamProviderAliasId:
          game.homeTeamProviderAlias?.id,
        awayTeamProviderAliasId:
          game.awayTeamProviderAlias?.id,
        scheduledKickoffMs: game.scheduledKickoffMs,
        lifecycle: game.lifecycle,
        homeScore: game.homeScore,
        awayScore: game.awayScore,
        observedAtMs: game.observedAtMs,
      });
      for (const alias of game.providerAliases) {
        await ctx.db.insert("seasonBootstrapStagedAliases", {
          stageId,
          ordinal: aliasOrdinal++,
          entityType: "game",
          entityStableKey: game.stableKey,
          provider: alias.provider,
          externalId: alias.id,
        });
      }
    }

    for (const [ordinal, failure] of report.failures.entries()) {
      await ctx.db.insert("seasonBootstrapValidationFailures", {
        stageId,
        ordinal,
        code: failure.code,
        scope: failure.scope,
        entityKey: failure.entityKey,
        message: failure.message,
      });
    }

    await ctx.db.insert("operatorAuditEvents", {
      action: "season_bootstrap_staged",
      actorTokenIdentifier: args.actorTokenIdentifier,
      actorClerkUserId: args.actorClerkUserId,
      atMs: nowMs,
      detailsJson: JSON.stringify({
        stageId,
        seasonYear: args.seasonYear,
        sourceProvider: args.sourceProvider,
        invariantsVersion: report.invariantsVersion,
        validationStatus: report.valid ? "valid" : "invalid",
        activationEligible: report.activationEligible,
        counts: report.counts,
      }),
    });

    log.info("bootstrap_staged", {
      stageId,
      seasonYear: args.seasonYear,
      sourceProvider: args.sourceProvider,
      validationStatus: report.valid ? "valid" : "invalid",
      teamCount: report.counts.teams,
      gameCount: report.counts.games,
      failureCount: report.counts.failures,
      actorClerkUserId: args.actorClerkUserId,
    });

    return { stageId, report };
  },
});

/**
 * Fetch and stage an API-Sports Season Bootstrap through the provider-neutral
 * sports-data interface. Fetch Effects execute only at this action edge.
 */
export const stageSeasonBootstrap = action({
  args: {
    seasonYear: v.number(),
  },
  handler: async (ctx, args): Promise<SeasonBootstrapStageResult> => {
    const actor: OperatorActor = await ctx.runMutation(
      internal.bootstrap.assertProductionOperator,
      {},
    );
    const persistSnapshot = async (
      teams: readonly SportsDataTeam[],
      games: readonly SportsDataGame[],
      providerFailure?: Readonly<{
        code:
          | "provider_configuration_failure"
          | "provider_fetch_failure";
        message: string;
      }>,
    ): Promise<SeasonBootstrapStageResult> => {
      const snapshotCounts = seasonBootstrapSnapshotCounts(
        teams,
        games,
      );
      const oversizedCounts = exceedsSeasonBootstrapStageLimits(
        snapshotCounts,
      )
        ? snapshotCounts
        : undefined;
      const result: SeasonBootstrapStageResult = await ctx.runMutation(
        internal.bootstrap.persistSeasonBootstrapStage,
        {
          seasonYear: args.seasonYear,
          sourceProvider: "api-sports",
          teams: oversizedCounts
            ? []
            : teams.map((team) => ({
                stableKey: team.stableKey,
                abbreviation: team.abbreviation,
                name: team.name,
                logoUrl: team.logoUrl,
                providerAliases: [...team.providerAliases],
              })),
          games: oversizedCounts
            ? []
            : games.map((game) => ({
                stableKey: game.stableKey,
                seasonYear: game.seasonYear,
                week: game.week,
                homeTeamAbbreviation:
                  game.homeTeamAbbreviation,
                awayTeamAbbreviation:
                  game.awayTeamAbbreviation,
                homeTeamProviderAlias:
                  game.homeTeamProviderAlias,
                awayTeamProviderAlias:
                  game.awayTeamProviderAlias,
                scheduledKickoffMs: game.scheduledKickoffMs,
                lifecycle: game.lifecycle,
                homeScore: game.homeScore,
                awayScore: game.awayScore,
                observedAtMs: game.observedAtMs,
                providerAliases: [...game.providerAliases],
              })),
          actorTokenIdentifier: actor.tokenIdentifier,
          actorClerkUserId: actor.clerkUserId,
          providerFailure,
          oversizedCounts,
        },
      );
      return result;
    };

    if (!isSeasonBootstrapYear(args.seasonYear)) {
      return await persistSnapshot([], []);
    }

    let provider;
    try {
      provider = selectSportsDataProvider({
        config: {
          provider: env.SPORTS_DATA_PROVIDER,
          apiSportsKey: env.API_SPORTS_KEY,
        },
        providers: {
          "api-sports": ({ apiKey }) =>
            new ApiSportsProvider({
              apiKey,
              teamSeasonYear: args.seasonYear,
              bootstrapTeamCandidates: true,
            }),
        },
      });
    } catch (error) {
      return await persistSnapshot([], [], {
        code: "provider_configuration_failure",
        message: errorMessage(error),
      });
    }
    let snapshot: {
      teams: readonly SportsDataTeam[];
      games: readonly SportsDataGame[];
    };
    try {
      snapshot = await runEffect(
        fetchSeasonBootstrapSnapshot(provider, args.seasonYear),
      );
    } catch (error) {
      return await persistSnapshot([], [], {
        code: "provider_fetch_failure",
        message: errorMessage(error),
      });
    }
    return await persistSnapshot(snapshot.teams, snapshot.games);
  },
});

/** Retrieve the durable staged report through the Production Operator seam. */
export const getSeasonBootstrapStageReport = query({
  args: {
    stageId: v.id("seasonBootstrapStages"),
  },
  handler: async (ctx, args) => {
    await requireProductionOperator(ctx.auth);
    const stage = await ctx.db.get(args.stageId);
    if (stage === null) return null;

    const failures = await ctx.db
      .query("seasonBootstrapValidationFailures")
      .withIndex("by_stageId_and_ordinal", (q) =>
        q.eq("stageId", args.stageId),
      )
      .take(SEASON_BOOTSTRAP_STAGE_LIMITS.validationFailureRows);

    return {
      stageId: stage._id,
      seasonYear: stage.seasonYear,
      sourceProvider: stage.sourceProvider,
      invariantsVersion: stage.invariantsVersion,
      validationStatus: stage.validationStatus,
      activationEligible: stage.activationEligible,
      failuresTruncated: stage.failuresTruncated,
      counts: {
        teams: stage.teamCount,
        games: stage.gameCount,
        weeks: stage.weekCount,
        teamAliases: stage.teamAliasCount,
        gameAliases: stage.gameAliasCount,
        failures: stage.failureCount,
        storedFailures: stage.storedFailureCount,
      },
      stagedAtMs: stage.stagedAtMs,
      actorClerkUserId: stage.actorClerkUserId,
      failures: failures.map((failure) => ({
        code: failure.code,
        scope: failure.scope,
        entityKey: failure.entityKey,
        message: failure.message,
      })),
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
