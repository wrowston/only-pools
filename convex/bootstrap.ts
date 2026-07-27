import { v } from "convex/values";
import {
  action,
  env,
  internalAction,
  internalMutation,
  mutation,
  query,
} from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type {
  Doc,
  Id,
  TableNames,
} from "./_generated/dataModel";
import { runEffect } from "./effect/run";
import { evaluateBootstrapAvailability } from "./lib/bootstrapAvailability";
import {
  requireProductionOperatorIdentity,
  requireProductionOperatorWithStepUp,
} from "./lib/operatorAuth";
import {
  buildActivationPlan,
  cleanActivationConfirmationText,
  CLEAN_ACTIVATION_DELETE_ORDER,
  CLEAN_ACTIVATION_LIMITS,
  CLEAN_ACTIVATION_POLICY,
  CLEAN_ACTIVATION_PRESERVED_CATEGORIES,
  legacySportsDbGameSentinel,
  legacySportsDbTeamSentinel,
  resolveCleanActivationDeployment,
  type CleanActivationPlan,
  type CleanActivationRebuiltCounts,
} from "./lib/cleanActivationPolicy";
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

function productionOperatorEnvironment(): Record<
  string,
  string | undefined
> {
  return {
    PRODUCTION_OPERATOR_CLERK_USER_ID:
      env.PRODUCTION_OPERATOR_CLERK_USER_ID,
    PRODUCTION_OPERATOR_TOKEN_IDENTIFIER:
      env.PRODUCTION_OPERATOR_TOKEN_IDENTIFIER,
  };
}

function cleanActivationEnvironment(): Record<
  string,
  string | undefined
> {
  return {
    ...productionOperatorEnvironment(),
    DEPLOYMENT_KIND: env.DEPLOYMENT_KIND,
    CLEAN_ACTIVATION_DEPLOYMENT_ID:
      env.CLEAN_ACTIVATION_DEPLOYMENT_ID,
  };
}

export const assertProductionOperator = internalMutation({
  args: {},
  handler: async (ctx) => {
    const actor = await requireProductionOperatorIdentity(
      ctx,
      productionOperatorEnvironment(),
    );
    log.info("operator_asserted", { clerkUserId: actor.clerkUserId });
    return actor;
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
    await requireProductionOperatorIdentity(
      ctx,
      productionOperatorEnvironment(),
    );
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

class CleanActivationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CleanActivationError";
  }
}

type CleanActivationSnapshot = Readonly<{
  stage: Doc<"seasonBootstrapStages">;
  stagedTeams: readonly Doc<"seasonBootstrapStagedTeams">[];
  stagedGames: readonly Doc<"seasonBootstrapStagedGames">[];
  stagedAliases: readonly Doc<"seasonBootstrapStagedAliases">[];
  teams: readonly SportsDataTeam[];
  games: readonly SportsDataGame[];
  availability: Readonly<{
    status: "available";
    usableStartWeek: number;
  }>;
}>;

function hasContiguousOrdinals(
  rows: readonly Readonly<{ ordinal: number }>[],
): boolean {
  return [...rows]
    .sort((left, right) => left.ordinal - right.ordinal)
    .every((row, index) => row.ordinal === index);
}

async function loadCurrentlyValidActivationSnapshot(
  ctx: MutationCtx,
  input: {
    stageId: Id<"seasonBootstrapStages">;
    seasonYear: number;
    nowMs: number;
  },
): Promise<CleanActivationSnapshot> {
  const fail = (reason: string): never => {
    throw new CleanActivationError(
      `Activation requires the currently valid staged snapshot: ${reason}`,
    );
  };
  const latest = await ctx.db
    .query("seasonBootstrapStages")
    .withIndex("by_seasonYear_and_stagedAtMs", (q) =>
      q.eq("seasonYear", input.seasonYear),
    )
    .order("desc")
    .first();
  if (latest === null || latest._id !== input.stageId) {
    return fail("the selected stage is not the latest stage for the Pool Season");
  }
  if (
    latest.seasonYear !== input.seasonYear ||
    latest.sourceProvider !== "api-sports" ||
    latest.validationStatus !== "valid" ||
    !latest.activationEligible ||
    latest.invariantsVersion !== SEASON_BOOTSTRAP_INVARIANTS.version ||
    latest.failureCount !== 0 ||
    latest.storedFailureCount !== 0 ||
    latest.failuresTruncated
  ) {
    return fail("the stage report is no longer activation eligible");
  }
  if (
    latest.teamCount !== SEASON_BOOTSTRAP_INVARIANTS.teamCount ||
    latest.gameCount !==
      SEASON_BOOTSTRAP_INVARIANTS.regularSeasonGameCount ||
    latest.weekCount !== SEASON_BOOTSTRAP_INVARIANTS.weeks.length
  ) {
    return fail("the persisted stage counts do not match current invariants");
  }

  const [stagedTeams, stagedGames, stagedAliases, failures] =
    await Promise.all([
      ctx.db
        .query("seasonBootstrapStagedTeams")
        .withIndex("by_stageId_and_ordinal", (q) =>
          q.eq("stageId", input.stageId),
        )
        .take(SEASON_BOOTSTRAP_INVARIANTS.teamCount + 1),
      ctx.db
        .query("seasonBootstrapStagedGames")
        .withIndex("by_stageId_and_ordinal", (q) =>
          q.eq("stageId", input.stageId),
        )
        .take(SEASON_BOOTSTRAP_INVARIANTS.regularSeasonGameCount + 1),
      ctx.db
        .query("seasonBootstrapStagedAliases")
        .withIndex("by_stageId_and_ordinal", (q) =>
          q.eq("stageId", input.stageId),
        )
        .take(SEASON_BOOTSTRAP_STAGE_LIMITS.aliases + 1),
      ctx.db
        .query("seasonBootstrapValidationFailures")
        .withIndex("by_stageId_and_ordinal", (q) =>
          q.eq("stageId", input.stageId),
        )
        .take(1),
    ]);
  if (
    stagedTeams.length !== latest.teamCount ||
    stagedGames.length !== latest.gameCount ||
    stagedAliases.length !==
      latest.teamAliasCount + latest.gameAliasCount ||
    failures.length !== 0 ||
    !hasContiguousOrdinals(stagedTeams) ||
    !hasContiguousOrdinals(stagedGames) ||
    !hasContiguousOrdinals(stagedAliases)
  ) {
    return fail("the immutable staged child rows do not match the valid report");
  }

  const teamKeys = new Set(stagedTeams.map((team) => team.stableKey));
  const gameKeys = new Set(stagedGames.map((game) => game.stableKey));
  const aliasesByEntity = new Map<
    string,
    { provider: "api-sports"; id: string }[]
  >();
  for (const alias of stagedAliases) {
    if (alias.provider !== "api-sports") {
      return fail("a staged alias names an unapproved provider");
    }
    const ownerExists =
      alias.entityType === "team"
        ? teamKeys.has(alias.entityStableKey)
        : gameKeys.has(alias.entityStableKey);
    if (!ownerExists) {
      return fail("a staged alias has no staged entity owner");
    }
    const key = `${alias.entityType}:${alias.entityStableKey}`;
    const aliases = aliasesByEntity.get(key) ?? [];
    aliases.push({ provider: "api-sports", id: alias.externalId });
    aliasesByEntity.set(key, aliases);
  }

  const teams: SportsDataTeam[] = stagedTeams.map((team) => {
    const canonical = canonicalNflTeam(team.abbreviation);
    if (canonical === null || canonical.stableKey !== team.stableKey) {
      return fail("a staged NFL Team conflicts with the checked-in catalog");
    }
    return {
      ...canonical,
      providerAliases:
        aliasesByEntity.get(`team:${team.stableKey}`) ?? [],
    };
  });
  const games: SportsDataGame[] = stagedGames.map((game) => {
    const homeTeam = canonicalNflTeam(game.homeTeamAbbreviation);
    const awayTeam = canonicalNflTeam(game.awayTeamAbbreviation);
    if (homeTeam === null || awayTeam === null) {
      return fail("a staged NFL Game references an unknown canonical NFL Team");
    }
    const stableKey = nflGameStableKey({
      seasonYear: game.seasonYear,
      week: game.week,
      homeTeamAbbreviation: homeTeam.abbreviation,
      awayTeamAbbreviation: awayTeam.abbreviation,
    });
    if (stableKey !== game.stableKey) {
      return fail("a staged NFL Game conflicts with canonical game identity");
    }
    return {
      stableKey,
      seasonYear: game.seasonYear,
      week: game.week,
      homeTeamAbbreviation: homeTeam.abbreviation,
      awayTeamAbbreviation: awayTeam.abbreviation,
      homeTeamProviderAlias: game.homeTeamProviderAliasId
        ? {
            provider: "api-sports",
            id: game.homeTeamProviderAliasId,
          }
        : undefined,
      awayTeamProviderAlias: game.awayTeamProviderAliasId
        ? {
            provider: "api-sports",
            id: game.awayTeamProviderAliasId,
          }
        : undefined,
      scheduledKickoffMs: game.scheduledKickoffMs,
      lifecycle: game.lifecycle,
      homeScore: game.homeScore,
      awayScore: game.awayScore,
      observedAtMs: game.observedAtMs,
      providerAliases:
        aliasesByEntity.get(`game:${game.stableKey}`) ?? [],
    };
  });
  const report = validateSeasonBootstrap({
    seasonYear: input.seasonYear,
    sourceProvider: "api-sports",
    teams,
    games,
  });
  if (
    !report.valid ||
    !report.activationEligible ||
    report.failures.length !== 0 ||
    report.counts.teams !== latest.teamCount ||
    report.counts.games !== latest.gameCount ||
    report.counts.weeks !== latest.weekCount ||
    report.counts.teamAliases !== latest.teamAliasCount ||
    report.counts.gameAliases !== latest.gameAliasCount
  ) {
    return fail("the staged child rows no longer pass current validation");
  }

  const availability = evaluateBootstrapAvailability(games, input.nowMs);
  if (
    availability.status !== "available" ||
    availability.usableStartWeek === null
  ) {
    return fail("the stage has no usable future Start Week");
  }

  return {
    stage: latest,
    stagedTeams,
    stagedGames,
    stagedAliases,
    teams,
    games,
    availability: {
      status: "available",
      usableStartWeek: availability.usableStartWeek,
    },
  };
}

type CollectedCleanActivationRows = Readonly<{
  idsByTable: Partial<Record<TableNames, readonly Id<TableNames>[]>>;
  plan: CleanActivationPlan;
}>;

async function collectCleanActivationRows(
  ctx: MutationCtx,
  rebuiltCounts: CleanActivationRebuiltCounts,
): Promise<CollectedCleanActivationRows> {
  const currentCounts = Object.fromEntries(
    (Object.keys(CLEAN_ACTIVATION_POLICY) as TableNames[]).map(
      (tableName) => [tableName, 0],
    ),
  ) as Record<TableNames, number>;
  const idsByTable: Partial<
    Record<TableNames, readonly Id<TableNames>[]>
  > = {};
  let totalRows = 0;
  let totalBytes = 0;

  for (const tableName of CLEAN_ACTIVATION_DELETE_ORDER) {
    const remaining =
      CLEAN_ACTIVATION_LIMITS.maxDeletedRows - totalRows;
    const rows = await ctx.db.query(tableName).take(remaining + 1);
    if (rows.length > remaining) {
      throw new CleanActivationError(
        `Clean activation exceeds the transaction-safe deletion limit while reading ${tableName}`,
      );
    }
    currentCounts[tableName] = rows.length;
    idsByTable[tableName] = rows.map(
      (row) => row._id as Id<TableNames>,
    );
    totalRows += rows.length;
    for (const row of rows) {
      totalBytes += new TextEncoder().encode(JSON.stringify(row)).byteLength;
      if (totalBytes > CLEAN_ACTIVATION_LIMITS.maxDeletedBytes) {
        throw new CleanActivationError(
          `Clean activation exceeds the transaction-safe deletion byte limit while reading ${tableName}`,
        );
      }
    }
  }

  return {
    idsByTable,
    plan: buildActivationPlan({ currentCounts, rebuiltCounts }),
  };
}

function rebuiltCountsForSnapshot(
  snapshot: CleanActivationSnapshot,
): CleanActivationRebuiltCounts {
  const teamAliases = snapshot.stagedAliases.filter(
    (alias) => alias.entityType === "team",
  ).length;
  const gameAliases = snapshot.stagedAliases.length - teamAliases;
  return {
    poolSeasons: 1,
    nflTeams: snapshot.stagedTeams.length,
    nflGames: snapshot.stagedGames.length,
    nflTeamAliases: teamAliases,
    nflGameAliases: gameAliases,
    nflGameScheduleHistory: snapshot.stagedGames.length,
  };
}

async function assertStageNotActivatedInDeployment(
  ctx: MutationCtx,
  input: {
    stageId: Id<"seasonBootstrapStages">;
    deploymentKind: "development" | "production";
    deploymentId: string;
  },
): Promise<void> {
  const prior = await ctx.db
    .query("seasonBootstrapActivationRequests")
    .withIndex(
      "by_stageId_and_deploymentKind_and_deploymentId_and_status",
      (q) =>
        q
          .eq("stageId", input.stageId)
          .eq("deploymentKind", input.deploymentKind)
          .eq("deploymentId", input.deploymentId)
          .eq("status", "activated"),
    )
    .first();
  if (prior !== null) {
    throw new CleanActivationError(
      "This staged snapshot was already activated in the current deployment; stage a new snapshot before another clean activation",
    );
  }
}

type CleanActivationRequestResult = Readonly<{
  requestId: Id<"seasonBootstrapActivationRequests">;
  confirmationText: string;
  expiresAtMs: number;
  deployment: Readonly<{
    kind: "development" | "production";
    id: string;
  }>;
  seasonYear: number;
  stageId: Id<"seasonBootstrapStages">;
  deletedCounts: CleanActivationPlan["deletedCounts"];
  rebuiltCounts: CleanActivationRebuiltCounts;
  preservedCategories: typeof CLEAN_ACTIVATION_PRESERVED_CATEGORIES;
}>;

/**
 * Explicit destructive-operation request. It is authenticated, step-up
 * protected, deployment-bound, and never called by deployment or cron code.
 */
export const requestCleanSeasonActivation = mutation({
  args: {
    stageId: v.id("seasonBootstrapStages"),
    seasonYear: v.number(),
  },
  handler: async (ctx, args): Promise<CleanActivationRequestResult> => {
    const nowMs = Date.now();
    const activationEnv = cleanActivationEnvironment();
    const actor = await requireProductionOperatorWithStepUp(
      ctx,
      nowMs,
      activationEnv,
    );
    const deployment = resolveCleanActivationDeployment(activationEnv);
    const snapshot = await loadCurrentlyValidActivationSnapshot(ctx, {
      ...args,
      nowMs,
    });
    await assertStageNotActivatedInDeployment(ctx, {
      stageId: args.stageId,
      deploymentKind: deployment.kind,
      deploymentId: deployment.id,
    });
    const { plan } = await collectCleanActivationRows(
      ctx,
      rebuiltCountsForSnapshot(snapshot),
    );
    const confirmationText = cleanActivationConfirmationText({
      deployment,
      seasonYear: args.seasonYear,
      stageId: args.stageId,
    });
    const expiresAtMs =
      nowMs + CLEAN_ACTIVATION_LIMITS.confirmationTtlMs;
    const requestId = await ctx.db.insert(
      "seasonBootstrapActivationRequests",
      {
        stageId: args.stageId,
        seasonYear: args.seasonYear,
        deploymentKind: deployment.kind,
        deploymentId: deployment.id,
        confirmationText,
        status: "pending",
        actorTokenIdentifier: actor.tokenIdentifier,
        actorClerkUserId: actor.clerkUserId,
        requestedAtMs: nowMs,
        expiresAtMs,
        deletedCountsJson: JSON.stringify(plan.deletedCounts),
        rebuiltCountsJson: JSON.stringify(plan.rebuiltCounts),
        preservedCategories: [...plan.preservedCategories],
      },
    );
    await ctx.db.insert("operatorAuditEvents", {
      action: "season_bootstrap_activation_requested",
      actorTokenIdentifier: actor.tokenIdentifier,
      actorClerkUserId: actor.clerkUserId,
      atMs: nowMs,
      detailsJson: JSON.stringify({
        requestId,
        stageId: args.stageId,
        seasonYear: args.seasonYear,
        deployment,
        deletedCounts: plan.deletedCounts,
        rebuiltCounts: plan.rebuiltCounts,
        preservedCategories: plan.preservedCategories,
        expiresAtMs,
      }),
    });
    return {
      requestId,
      confirmationText,
      expiresAtMs,
      deployment,
      seasonYear: args.seasonYear,
      stageId: args.stageId,
      deletedCounts: plan.deletedCounts,
      rebuiltCounts: plan.rebuiltCounts,
      preservedCategories: plan.preservedCategories,
    };
  },
});

type CleanActivationResult = Readonly<{
  requestId: Id<"seasonBootstrapActivationRequests">;
  seasonId: Id<"poolSeasons">;
  seasonYear: number;
  stageId: Id<"seasonBootstrapStages">;
  status: "available";
  usableStartWeek: number;
  deletedCounts: CleanActivationPlan["deletedCounts"];
  rebuiltCounts: CleanActivationRebuiltCounts;
  preservedCategories: typeof CLEAN_ACTIVATION_PRESERVED_CATEGORIES;
}>;

export const activateCleanSeasonBootstrap = mutation({
  args: {
    requestId: v.id("seasonBootstrapActivationRequests"),
    confirmationText: v.string(),
  },
  handler: async (ctx, args): Promise<CleanActivationResult> => {
    const nowMs = Date.now();
    const activationEnv = cleanActivationEnvironment();
    const actor = await requireProductionOperatorWithStepUp(
      ctx,
      nowMs,
      activationEnv,
    );
    const deployment = resolveCleanActivationDeployment(activationEnv);
    const request = await ctx.db.get(args.requestId);
    if (request === null || request.status !== "pending") {
      throw new CleanActivationError(
        "A pending clean activation request is required",
      );
    }
    if (
      request.actorTokenIdentifier !== actor.tokenIdentifier ||
      request.actorClerkUserId !== actor.clerkUserId
    ) {
      throw new CleanActivationError(
        "The confirming Production Operator must match the requester",
      );
    }
    if (
      request.deploymentKind !== deployment.kind ||
      request.deploymentId !== deployment.id
    ) {
      throw new CleanActivationError(
        "Clean activation confirmation belongs to a different deployment",
      );
    }
    if (request.expiresAtMs < nowMs) {
      throw new CleanActivationError(
        "Clean activation confirmation has expired",
      );
    }
    const expectedConfirmation = cleanActivationConfirmationText({
      deployment,
      seasonYear: request.seasonYear,
      stageId: request.stageId,
    });
    if (
      args.confirmationText !== expectedConfirmation ||
      request.confirmationText !== expectedConfirmation
    ) {
      throw new CleanActivationError(
        "Clean activation confirmation text does not match",
      );
    }
    await assertStageNotActivatedInDeployment(ctx, {
      stageId: request.stageId,
      deploymentKind: deployment.kind,
      deploymentId: deployment.id,
    });

    const snapshot = await loadCurrentlyValidActivationSnapshot(ctx, {
      stageId: request.stageId,
      seasonYear: request.seasonYear,
      nowMs,
    });
    const { idsByTable, plan } = await collectCleanActivationRows(
      ctx,
      rebuiltCountsForSnapshot(snapshot),
    );
    if (
      request.deletedCountsJson !== JSON.stringify(plan.deletedCounts) ||
      request.rebuiltCountsJson !== JSON.stringify(plan.rebuiltCounts)
    ) {
      throw new CleanActivationError(
        "Clean activation deletion or rebuild scope changed; request a new confirmation",
      );
    }

    for (const tableName of CLEAN_ACTIVATION_DELETE_ORDER) {
      for (const id of idsByTable[tableName] ?? []) {
        await ctx.db.delete(id);
      }
    }

    const seasonId = await ctx.db.insert("poolSeasons", {
      label: String(request.seasonYear),
      year: request.seasonYear,
      status: "bootstrapping",
    });
    const teamIds = new Map<string, Id<"nflTeams">>();
    for (const team of snapshot.teams) {
      const teamId = await ctx.db.insert("nflTeams", {
        stableKey: team.stableKey,
        name: team.name,
        abbreviation: team.abbreviation,
        logoUrl: team.logoUrl,
        // Temporary expand/contract field. Generic aliases below are authority.
        sportsDbTeamId: legacySportsDbTeamSentinel(team.stableKey),
      });
      teamIds.set(team.stableKey, teamId);
    }
    for (const alias of snapshot.stagedAliases) {
      if (alias.entityType !== "team") continue;
      const nflTeamId = teamIds.get(alias.entityStableKey);
      if (!nflTeamId) {
        throw new CleanActivationError(
          `Validated staged NFL Team missing during rebuild: ${alias.entityStableKey}`,
        );
      }
      await ctx.db.insert("nflTeamAliases", {
        nflTeamId,
        provider: alias.provider,
        externalId: alias.externalId,
        isCurrent: true,
        firstObservedAtMs: snapshot.stage.stagedAtMs,
        lastObservedAtMs: snapshot.stage.stagedAtMs,
      });
    }

    const gameIds = new Map<string, Id<"nflGames">>();
    for (const game of snapshot.stagedGames) {
      const homeTeam = snapshot.teams.find(
        (team) => team.abbreviation === game.homeTeamAbbreviation,
      );
      const awayTeam = snapshot.teams.find(
        (team) => team.abbreviation === game.awayTeamAbbreviation,
      );
      const homeTeamId = homeTeam
        ? teamIds.get(homeTeam.stableKey)
        : undefined;
      const awayTeamId = awayTeam
        ? teamIds.get(awayTeam.stableKey)
        : undefined;
      if (!homeTeamId || !awayTeamId) {
        throw new CleanActivationError(
          `Validated staged NFL Game missing team during rebuild: ${game.stableKey}`,
        );
      }
      const gameId = await ctx.db.insert("nflGames", {
        stableKey: game.stableKey,
        seasonId,
        seasonLabel: String(request.seasonYear),
        week: game.week,
        homeTeamId,
        awayTeamId,
        scheduledKickoffMs: game.scheduledKickoffMs,
        lifecycle: game.lifecycle,
        homeScore: game.homeScore,
        awayScore: game.awayScore,
        // Temporary expand/contract field. Generic aliases below are authority.
        sportsDbEventId: legacySportsDbGameSentinel(game.stableKey),
      });
      gameIds.set(game.stableKey, gameId);
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
    for (const alias of snapshot.stagedAliases) {
      if (alias.entityType !== "game") continue;
      const nflGameId = gameIds.get(alias.entityStableKey);
      if (!nflGameId) {
        throw new CleanActivationError(
          `Validated staged NFL Game missing during rebuild: ${alias.entityStableKey}`,
        );
      }
      const stagedGame = snapshot.stagedGames.find(
        (game) => game.stableKey === alias.entityStableKey,
      );
      if (!stagedGame) {
        throw new CleanActivationError(
          `Validated staged NFL Game observation missing during rebuild: ${alias.entityStableKey}`,
        );
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

    // This is deliberately the last dataset write. Convex commits the entire
    // mutation atomically, so no observer can see a partially Available season.
    await ctx.db.patch(seasonId, {
      status: "available",
      usableStartWeek: snapshot.availability.usableStartWeek,
      bootstrappedAtMs: nowMs,
    });
    await ctx.db.patch(request._id, {
      status: "activated",
      activatedAtMs: nowMs,
      deletedCountsJson: JSON.stringify(plan.deletedCounts),
      rebuiltCountsJson: JSON.stringify(plan.rebuiltCounts),
      preservedCategories: [...plan.preservedCategories],
    });
    await ctx.db.insert("operatorAuditEvents", {
      action: "season_bootstrap_clean_activated",
      actorTokenIdentifier: actor.tokenIdentifier,
      actorClerkUserId: actor.clerkUserId,
      atMs: nowMs,
      detailsJson: JSON.stringify({
        requestId: request._id,
        stageId: request.stageId,
        seasonId,
        seasonYear: request.seasonYear,
        deployment,
        deletedCounts: plan.deletedCounts,
        rebuiltCounts: plan.rebuiltCounts,
        preservedCategories: plan.preservedCategories,
        usableStartWeek: snapshot.availability.usableStartWeek,
      }),
    });

    return {
      requestId: request._id,
      seasonId,
      seasonYear: request.seasonYear,
      stageId: request.stageId,
      status: "available",
      usableStartWeek: snapshot.availability.usableStartWeek,
      deletedCounts: plan.deletedCounts,
      rebuiltCounts: plan.rebuiltCounts,
      preservedCategories: plan.preservedCategories,
    };
  },
});

function parsedCounts(value: string | undefined): Record<string, number> {
  if (!value) return {};
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== "object" || parsed === null) return {};
  return Object.fromEntries(
    Object.entries(parsed).filter(
      (entry): entry is [string, number] =>
        typeof entry[1] === "number" && Number.isSafeInteger(entry[1]),
    ),
  );
}

/** Production Operator report for pending or completed clean activation. */
export const getCleanSeasonActivationReport = query({
  args: {
    requestId: v.id("seasonBootstrapActivationRequests"),
  },
  handler: async (ctx, args) => {
    await requireProductionOperatorIdentity(
      ctx,
      productionOperatorEnvironment(),
    );
    const request = await ctx.db.get(args.requestId);
    if (request === null) return null;
    const status =
      request.status === "pending" && request.expiresAtMs < Date.now()
        ? "expired"
        : request.status;
    return {
      requestId: request._id,
      stageId: request.stageId,
      seasonYear: request.seasonYear,
      deployment: {
        kind: request.deploymentKind,
        id: request.deploymentId,
      },
      actor: {
        tokenIdentifier: request.actorTokenIdentifier,
        clerkUserId: request.actorClerkUserId,
      },
      status,
      requestedAtMs: request.requestedAtMs,
      expiresAtMs: request.expiresAtMs,
      activatedAtMs: request.activatedAtMs ?? null,
      deletedCounts: parsedCounts(request.deletedCountsJson),
      rebuiltCounts: parsedCounts(request.rebuiltCountsJson),
      preservedCategories: request.preservedCategories,
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
