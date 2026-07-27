/**
 * API-Sports schedule synchronization.
 *
 * Provider I/O runs only at the action edge. Each normalized NFL Game is
 * applied in its own mutation so one identity or contract failure cannot roll
 * back valid siblings from the same season response.
 */

import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  env,
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import type {
  ActionCtx,
  MutationCtx,
  QueryCtx,
} from "./_generated/server";
import { runEffect } from "./effect/run";
import { AuthError, requireParticipant } from "./lib/auth";
import { isProductionOperator } from "./lib/operator";
import { isGameKickoffLocked } from "./lib/pickLock";
import { recordScoringDependencyEvent } from "./lib/scoringHolds";
import { lifecycleValidator } from "./lib/syncObservations";
import { ApiSportsProvider } from "./providers/apiSports";
import type { ApiSportsGame } from "./providers/apiSports";
import {
  CANONICAL_NFL_TEAM_ABBREVIATIONS,
  CANONICAL_NFL_TEAMS,
  type CanonicalNflTeamAbbreviation,
} from "./providers/sportsData/catalog";
import { selectSportsDataProvider } from "./providers/sportsData/config";
import {
  attachNflGameAlias,
  reconcileStoredNflGame,
  recordNflGameSchedule,
  SportsIdentityConflict,
} from "./providers/sportsData/identityStore";
import {
  reduceScheduleObservation,
  scheduleRefreshCadence,
} from "./providers/sportsData/scheduleSync";

const providerAliasValidator = v.object({
  provider: v.literal("api-sports"),
  id: v.string(),
});

const providerStatusValidator = v.object({
  rawShort: v.string(),
  rawLong: v.string(),
  recognized: v.boolean(),
});

const PARTICIPANT_SAFE_SCHEDULE_INCIDENT_SUMMARY =
  "Schedule information needs review; the last trusted NFL Game state was preserved.";

const teamAbbreviationValidator = v.union(
  ...CANONICAL_NFL_TEAM_ABBREVIATIONS.map((abbreviation) =>
    v.literal(abbreviation),
  ),
);

const scheduleGameValidator = v.object({
  seasonYear: v.number(),
  week: v.number(),
  homeTeamAbbreviation: teamAbbreviationValidator,
  awayTeamAbbreviation: teamAbbreviationValidator,
  scheduledKickoffMs: v.number(),
  lifecycle: lifecycleValidator,
  observedAtMs: v.number(),
  providerAlias: providerAliasValidator,
  providerStatus: providerStatusValidator,
});

type ScheduleGameInput = {
  seasonYear: number;
  week: number;
  homeTeamAbbreviation: CanonicalNflTeamAbbreviation;
  awayTeamAbbreviation: CanonicalNflTeamAbbreviation;
  scheduledKickoffMs: number;
  lifecycle: Doc<"nflGames">["lifecycle"];
  observedAtMs: number;
  providerAlias: { provider: "api-sports"; id: string };
  providerStatus: {
    rawShort: string;
    rawLong: string;
    recognized: boolean;
  };
};

type ScheduleApplyResult =
  | {
      status: "unresolved";
      gameId: null;
      incidentId: Id<"operatorIncidents"> | null;
    }
  | {
      status: "applied";
      gameId: Id<"nflGames">;
      incidentId: Id<"operatorIncidents"> | null;
      lifecyclePreserved: boolean;
      kickoffLockReachedAtMs: number | null;
    };

type IncidentOpenResult =
  | { opened: false; incidentId: null }
  | {
      opened: false;
      incidentId: Id<"operatorIncidents">;
      deduped: true;
    }
  | {
      opened: true;
      incidentId: Id<"operatorIncidents">;
      deduped: false;
    };

async function findCanonicalTeam(
  ctx: QueryCtx | MutationCtx,
  abbreviation: CanonicalNflTeamAbbreviation,
): Promise<Doc<"nflTeams"> | null> {
  const canonical = CANONICAL_NFL_TEAMS[abbreviation];
  const rows = await ctx.db
    .query("nflTeams")
    .withIndex("by_stableKey", (q) =>
      q.eq("stableKey", canonical.stableKey),
    )
    .take(2);
  return rows.length === 1 ? rows[0]! : null;
}

async function openScheduleIncident(
  ctx: MutationCtx,
  input: {
    scopeKey: string;
    summary: string;
    nowMs: number;
  },
): Promise<IncidentOpenResult> {
  return await ctx.runMutation(
    internal.incidents.evaluateAndOpenIncident,
    {
      trigger: { kind: "provider_exception" },
      surface: "schedule",
      scopeKey: input.scopeKey,
      summary: input.summary,
      nowMs: input.nowMs,
    },
  );
}

async function recordUnknownStatusEvidence(
  ctx: MutationCtx,
  input: {
    observation: ScheduleGameInput;
    nflGameId?: Id<"nflGames">;
  },
): Promise<void> {
  const { observation } = input;
  const alias = observation.providerAlias;
  const existing = await ctx.db
    .query("sportsDataStatusEvidence")
    .withIndex(
      "by_provider_and_externalId_and_rawShort_and_rawLong",
      (q) =>
        q
          .eq("provider", alias.provider)
          .eq("externalId", alias.id)
          .eq("rawShort", observation.providerStatus.rawShort)
          .eq("rawLong", observation.providerStatus.rawLong),
    )
    .unique();
  if (existing) {
    await ctx.db.patch(existing._id, {
      nflGameId: input.nflGameId ?? existing.nflGameId,
      recognized: false,
      lastObservedAtMs: observation.observedAtMs,
      observationCount: existing.observationCount + 1,
    });
    return;
  }
  await ctx.db.insert("sportsDataStatusEvidence", {
    provider: alias.provider,
    externalId: alias.id,
    nflGameId: input.nflGameId,
    rawShort: observation.providerStatus.rawShort,
    rawLong: observation.providerStatus.rawLong,
    recognized: false,
    firstObservedAtMs: observation.observedAtMs,
    lastObservedAtMs: observation.observedAtMs,
    observationCount: 1,
  });
}

/**
 * Apply one provider-neutral schedule observation transactionally.
 * Unresolved identity is a successful, state-preserving outcome.
 */
export const applyScheduleGameObservation = internalMutation({
  args: {
    seasonId: v.id("poolSeasons"),
    observation: scheduleGameValidator,
  },
  handler: async (ctx, args): Promise<ScheduleApplyResult> => {
    const observation = args.observation as ScheduleGameInput;
    const incidentBase =
      `season:${args.seasonId}:provider:${observation.providerAlias.id}`;
    const season = await ctx.db.get(args.seasonId);
    const [homeTeam, awayTeam] = await Promise.all([
      findCanonicalTeam(ctx, observation.homeTeamAbbreviation),
      findCanonicalTeam(ctx, observation.awayTeamAbbreviation),
    ]);

    if (
      !season ||
      season.year !== observation.seasonYear ||
      !homeTeam ||
      !awayTeam
    ) {
      if (!observation.providerStatus.recognized) {
        await recordUnknownStatusEvidence(ctx, { observation });
      }
      const incident = await openScheduleIncident(ctx, {
        scopeKey: `${incidentBase}:identity`,
        summary: PARTICIPANT_SAFE_SCHEDULE_INCIDENT_SUMMARY,
        nowMs: observation.observedAtMs,
      });
      return {
        status: "unresolved" as const,
        gameId: null,
        incidentId: incident.incidentId,
      };
    }

    let reconciliation:
      | Readonly<{ kind: "resolved"; nflGameId: Id<"nflGames"> }>
      | Readonly<{ kind: "unresolved" }>;
    try {
      reconciliation = await reconcileStoredNflGame(ctx, {
        alias: {
          provider: observation.providerAlias.provider,
          externalId: observation.providerAlias.id,
        },
        seasonId: args.seasonId,
        week: observation.week,
        homeTeamId: homeTeam._id,
        awayTeamId: awayTeam._id,
        homeTeamStableKey:
          CANONICAL_NFL_TEAMS[observation.homeTeamAbbreviation].stableKey,
        awayTeamStableKey:
          CANONICAL_NFL_TEAMS[observation.awayTeamAbbreviation].stableKey,
        scheduledKickoffMs: observation.scheduledKickoffMs,
      });
    } catch (cause) {
      if (!(cause instanceof SportsIdentityConflict)) throw cause;
      if (!observation.providerStatus.recognized) {
        await recordUnknownStatusEvidence(ctx, { observation });
      }
      const incident = await openScheduleIncident(ctx, {
        scopeKey: `${incidentBase}:identity`,
        summary: PARTICIPANT_SAFE_SCHEDULE_INCIDENT_SUMMARY,
        nowMs: observation.observedAtMs,
      });
      return {
        status: "unresolved" as const,
        gameId: null,
        incidentId: incident.incidentId,
      };
    }

    if (reconciliation.kind === "unresolved") {
      if (!observation.providerStatus.recognized) {
        await recordUnknownStatusEvidence(ctx, { observation });
      }
      const incident = await openScheduleIncident(ctx, {
        scopeKey: `${incidentBase}:identity`,
        summary: PARTICIPANT_SAFE_SCHEDULE_INCIDENT_SUMMARY,
        nowMs: observation.observedAtMs,
      });
      return {
        status: "unresolved" as const,
        gameId: null,
        incidentId: incident.incidentId,
      };
    }

    const game = await ctx.db.get(reconciliation.nflGameId);
    if (!game) {
      throw new Error("Reconciled NFL Game no longer exists");
    }
    const reduced = reduceScheduleObservation({
      prior: {
        scheduledKickoffMs: game.scheduledKickoffMs,
        lifecycle: game.lifecycle,
        kickoffLockReachedAtMs:
          game.kickoffLockReachedAtMs ?? null,
      },
      observation: {
        scheduledKickoffMs: observation.scheduledKickoffMs,
        lifecycle: observation.lifecycle,
        lifecycleRecognized: observation.providerStatus.recognized,
        observedAtMs: observation.observedAtMs,
      },
    });

    await ctx.db.patch(game._id, {
      scheduledKickoffMs: reduced.scheduledKickoffMs,
      lifecycle: reduced.lifecycle,
      kickoffLockReachedAtMs:
        reduced.kickoffLockReachedAtMs ?? undefined,
      lastObservedAtMs: observation.observedAtMs,
      revision: (game.revision ?? 0) + 1,
    });
    if (
      reduced.scheduledKickoffMs !== game.scheduledKickoffMs ||
      reduced.lifecycle !== game.lifecycle ||
      reduced.kickoffLockReachedAtMs !==
        (game.kickoffLockReachedAtMs ?? null)
    ) {
      await recordScoringDependencyEvent(
        ctx,
        game.seasonId,
        game.week,
      );
    }
    await attachNflGameAlias(ctx, {
      nflGameId: game._id,
      alias: {
        provider: observation.providerAlias.provider,
        externalId: observation.providerAlias.id,
      },
      observedAtMs: observation.observedAtMs,
    });
    await recordNflGameSchedule(ctx, {
      nflGameId: game._id,
      seasonId: game.seasonId,
      week: game.week,
      homeTeamId: game.homeTeamId,
      awayTeamId: game.awayTeamId,
      scheduledKickoffMs: reduced.scheduledKickoffMs,
      observedAtMs: observation.observedAtMs,
    });

    let incidentId: Id<"operatorIncidents"> | null = null;
    if (reduced.unknownLifecyclePreserved) {
      await recordUnknownStatusEvidence(ctx, {
        observation,
        nflGameId: game._id,
      });
      const incident = await openScheduleIncident(ctx, {
        scopeKey:
          `${incidentBase}:status:${observation.providerStatus.rawShort}`,
        summary: PARTICIPANT_SAFE_SCHEDULE_INCIDENT_SUMMARY,
        nowMs: observation.observedAtMs,
      });
      incidentId = incident.incidentId;
    }

    return {
      status: "applied" as const,
      gameId: game._id,
      incidentId,
      lifecyclePreserved: reduced.unknownLifecyclePreserved,
      kickoffLockReachedAtMs: reduced.kickoffLockReachedAtMs,
    };
  },
});

type BatchObservation = {
  seasonId: Id<"poolSeasons">;
  observation: ScheduleGameInput;
};

async function applyBatch(
  ctx: ActionCtx,
  observations: readonly BatchObservation[],
) {
  const summary = {
    observed: observations.length,
    applied: 0,
    unresolved: 0,
    failed: 0,
  };
  for (const item of observations) {
    try {
      const result: ScheduleApplyResult = await ctx.runMutation(
        internal.syncSchedule.applyScheduleGameObservation,
        item,
      );
      if (result.status === "applied") summary.applied += 1;
      else summary.unresolved += 1;
    } catch {
      summary.failed += 1;
      try {
        await ctx.runMutation(
          internal.incidents.evaluateAndOpenIncident,
          {
            trigger: { kind: "provider_exception" },
            surface: "schedule",
            scopeKey:
              `season:${item.seasonId}:provider:${item.observation.providerAlias.id}:apply`,
            summary: PARTICIPANT_SAFE_SCHEDULE_INCIDENT_SUMMARY,
            nowMs: item.observation.observedAtMs,
          },
        );
      } catch {
        // Preserve per-game isolation even if incident delivery itself fails.
      }
    }
  }
  return summary;
}

/** Injectable action seam used by integration tests and normalized callers. */
export const applyScheduleObservationBatch = internalAction({
  args: {
    observations: v.array(
      v.object({
        seasonId: v.id("poolSeasons"),
        observation: scheduleGameValidator,
      }),
    ),
  },
  handler: async (ctx, args) => {
    if (args.observations.length > 300) {
      throw new Error("Schedule batch exceeds the regular-season bound");
    }
    return await applyBatch(
      ctx,
      args.observations as BatchObservation[],
    );
  },
});

function apiSportsScheduleInput(
  seasonId: Id<"poolSeasons">,
  game: ApiSportsGame,
): BatchObservation | null {
  const providerAlias = game.providerAliases.find(
    (alias) => alias.provider === "api-sports",
  );
  if (!providerAlias) return null;
  return {
    seasonId,
    observation: {
      seasonYear: game.seasonYear,
      week: game.week,
      homeTeamAbbreviation: game.homeTeamAbbreviation,
      awayTeamAbbreviation: game.awayTeamAbbreviation,
      scheduledKickoffMs: game.scheduledKickoffMs,
      lifecycle: game.lifecycle,
      observedAtMs: game.observedAtMs,
      providerAlias: {
        provider: "api-sports",
        id: providerAlias.id,
      },
      providerStatus: {
        rawShort: game.providerStatus.rawShort,
        rawLong: game.providerStatus.rawLong,
        recognized: game.providerStatus.recognized,
      },
    },
  };
}

export const getScheduleSeason = internalQuery({
  args: { seasonId: v.id("poolSeasons") },
  handler: async (ctx, args) => {
    const season = await ctx.db.get(args.seasonId);
    if (!season) return null;
    return { seasonId: season._id, year: season.year };
  },
});

export const rescheduleScheduleWork = internalMutation({
  args: {
    workItemId: v.id("syncWorkItems"),
    dueAtMs: v.number(),
    failed: v.boolean(),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.workItemId);
    if (!item) return false;
    await ctx.db.patch(item._id, {
      status: "due",
      dueAtMs: args.dueAtMs,
      claimedAtMs: undefined,
      leaseExpiresAtMs: undefined,
      attemptCount: args.failed
        ? item.attemptCount + 1
        : item.attemptCount,
    });
    return true;
  },
});

/**
 * Production action edge: instantiate only the selected provider, execute its
 * lazy Effect, then isolate every returned NFL Game in its own mutation.
 */
export const runClaimedScheduleFetch = internalAction({
  args: {
    workItemId: v.id("syncWorkItems"),
    seasonId: v.id("poolSeasons"),
  },
  handler: async (ctx, args) => {
    const season = await ctx.runQuery(
      internal.syncSchedule.getScheduleSeason,
      { seasonId: args.seasonId },
    );
    if (!season) {
      await ctx.runMutation(
        internal.syncSchedule.rescheduleScheduleWork,
        {
          workItemId: args.workItemId,
          dueAtMs: Date.now() + 24 * 60 * 60 * 1000,
          failed: true,
        },
      );
      return { ok: false as const, reason: "season_missing" };
    }

    try {
      const provider = selectSportsDataProvider({
        config: {
          provider: env.SPORTS_DATA_PROVIDER,
          apiSportsKey: env.API_SPORTS_KEY,
        },
        providers: {
          "api-sports": ({ apiKey }) =>
            new ApiSportsProvider({ apiKey }),
        },
      });
      const games = await runEffect(provider.listSeasonGames(season.year));
      const observations = games
        .map((game) =>
          apiSportsScheduleInput(args.seasonId, game as ApiSportsGame),
        )
        .filter(
          (item): item is BatchObservation => item !== null,
        );
      const summary = await applyBatch(ctx, observations);
      const nowMs = Date.now();
      const cadence = scheduleRefreshCadence({
        nowMs,
        scheduledKickoffMs: games.map(
          (game) => game.scheduledKickoffMs,
        ),
      });
      await ctx.runMutation(
        internal.syncLive.recordSyncSurfaceHealth,
        {
          surface: "schedule",
          scopeKey: `schedule:${args.seasonId}`,
          success: true,
          nowMs,
          expectedNextRefreshAtMs: nowMs + cadence.cadenceMs,
        },
      );
      await ctx.runMutation(
        internal.syncSchedule.rescheduleScheduleWork,
        {
          workItemId: args.workItemId,
          dueAtMs: nowMs + cadence.cadenceMs,
          failed: false,
        },
      );
      return {
        ok: true as const,
        ...summary,
        cadenceReason: cadence.reason,
      };
    } catch {
      const nowMs = Date.now();
      await ctx.runMutation(
        internal.syncLive.recordSyncSurfaceHealth,
        {
          surface: "schedule",
          scopeKey: `schedule:${args.seasonId}`,
          success: false,
          nowMs,
          providerException: true,
          exceptionMessage: "schedule_fetch_failed",
        },
      );
      await ctx.runMutation(
        internal.syncSchedule.rescheduleScheduleWork,
        {
          workItemId: args.workItemId,
          dueAtMs: nowMs + 5 * 60 * 1000,
          failed: true,
        },
      );
      return { ok: false as const, reason: "schedule_fetch_failed" };
    }
  },
});

async function requirePoolMember(
  ctx: QueryCtx,
  poolId: Id<"pools">,
  participantId: Id<"participants">,
) {
  const membership = await ctx.db
    .query("poolMemberships")
    .withIndex("by_poolId_and_participantId", (q) =>
      q.eq("poolId", poolId).eq("participantId", participantId),
    )
    .unique();
  if (!membership || membership.status !== "active") {
    throw new AuthError("Not a member of this Pool");
  }
}

/** Participant-facing schedule state; provider evidence stays private. */
export const getParticipantPoolSchedule = query({
  args: {
    poolId: v.id("pools"),
    week: v.number(),
  },
  handler: async (ctx, args) => {
    const participant = await requireParticipant(ctx);
    const pool = await ctx.db.get(args.poolId);
    if (!pool) throw new Error("Pool not found");
    await requirePoolMember(ctx, pool._id, participant._id);
    const games = await ctx.db
      .query("nflGames")
      .withIndex("by_seasonId_and_week", (q) =>
        q.eq("seasonId", pool.seasonId).eq("week", args.week),
      )
      .take(64);
    const nowMs = Date.now();
    const schedule = await Promise.all(
      games.map(async (game) => {
        const [homeTeam, awayTeam] = await Promise.all([
          ctx.db.get(game.homeTeamId),
          ctx.db.get(game.awayTeamId),
        ]);
        return {
          gameId: game._id,
          scheduledKickoffMs: game.scheduledKickoffMs,
          lifecycle: game.lifecycle,
          locked: isGameKickoffLocked(game, nowMs),
          homeTeam: homeTeam
            ? {
                name: homeTeam.name,
                abbreviation: homeTeam.abbreviation,
              }
            : null,
          awayTeam: awayTeam
            ? {
                name: awayTeam.name,
                abbreviation: awayTeam.abbreviation,
              }
            : null,
          lastObservedAtMs: game.lastObservedAtMs ?? null,
        };
      }),
    );
    return schedule.sort(
      (left, right) =>
        left.scheduledKickoffMs - right.scheduledKickoffMs,
    );
  },
});

async function requireOperator(ctx: QueryCtx): Promise<void> {
  const identity = await ctx.auth.getUserIdentity();
  if (
    identity === null ||
    !isProductionOperator(
      {
        tokenIdentifier: identity.tokenIdentifier,
        clerkUserId: identity.subject,
      },
      {
        PRODUCTION_OPERATOR_CLERK_USER_ID:
          env.PRODUCTION_OPERATOR_CLERK_USER_ID,
        PRODUCTION_OPERATOR_TOKEN_IDENTIFIER:
          env.PRODUCTION_OPERATOR_TOKEN_IDENTIFIER,
      },
    )
  ) {
    throw new AuthError("Production Operator required");
  }
}

/** Production Operator evidence surface; never exposed to Pool roles. */
export const listOperatorScheduleEvidence = query({
  args: {},
  handler: async (ctx) => {
    await requireOperator(ctx);
    const [evidence, open, acknowledged, inProgress] = await Promise.all([
      ctx.db
        .query("sportsDataStatusEvidence")
        .withIndex("by_lastObservedAtMs")
        .order("desc")
        .take(100),
      ctx.db
        .query("operatorIncidents")
        .withIndex("by_status_and_surface_and_openedAtMs", (q) =>
          q.eq("status", "open").eq("surface", "schedule"),
        )
        .order("desc")
        .take(100),
      ctx.db
        .query("operatorIncidents")
        .withIndex("by_status_and_surface_and_openedAtMs", (q) =>
          q.eq("status", "acknowledged").eq("surface", "schedule"),
        )
        .order("desc")
        .take(100),
      ctx.db
        .query("operatorIncidents")
        .withIndex("by_status_and_surface_and_openedAtMs", (q) =>
          q.eq("status", "in_progress").eq("surface", "schedule"),
        )
        .order("desc")
        .take(100),
    ]);
    return {
      evidence,
      incidents: [...open, ...acknowledged, ...inProgress]
        .sort((left, right) => right.openedAtMs - left.openedAtMs)
        .slice(0, 100),
    };
  },
});
