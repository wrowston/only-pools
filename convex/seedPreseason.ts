/**
 * Development-only API-Sports preseason pool seeder.
 *
 * The preseason season is explicitly phase-tagged: participant Create Pool
 * and routine schedule sync ignore it, while league-live result ingestion
 * can still update its exact API-Sports game aliases.
 *
 *   bunx convex run seedPreseason:seedApiSportsPreseasonPool \
 *     '{"ownerParticipantId":"j57…"}'
 */

import * as Effect from "effect/Effect";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  env,
  internalAction,
  internalMutation,
} from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { createApiSportsClient } from "./effect/apiSports/client";
import { runEffect } from "./effect/run";
import { resolveDeploymentKind } from "./lib/syncGate";
import { normalizeApiSportsGame } from "./providers/apiSports/normalize";
import { CANONICAL_NFL_TEAM_LIST } from "./providers/sportsData/catalog";
import { canonicalNflTeam } from "./providers/sportsData/identity";
import {
  attachNflTeamAlias,
  persistReconciledNflGame,
  reconcileStoredNflGame,
  reconcileStoredNflTeam,
  resolveNflGameAlias,
} from "./providers/sportsData/identityStore";
import type {
  SportsDataGameObservation,
  SportsDataProviderAlias,
} from "./providers/sportsData/types";

const PRESEASON_YEAR = 2026;
const PRESEASON_SEASON_LABEL = "2026 Preseason · API-Sports Test";
const DEFAULT_POOL_NAME = "2026 NFL Preseason Survivor Test";
const PRESEASON_WEEKS = [1, 2, 3] as const;
export const PRESEASON_FINAL_WEEK = 3;
const MAX_PRESEASON_GAMES = 64;

const preseasonGameValidator = v.object({
  stableKey: v.string(),
  week: v.number(),
  homeTeamAbbreviation: v.string(),
  awayTeamAbbreviation: v.string(),
  homeTeamProviderExternalId: v.string(),
  awayTeamProviderExternalId: v.string(),
  scheduledKickoffMs: v.number(),
  providerGameExternalId: v.string(),
  observedAtMs: v.number(),
});

export type PreseasonSeedGame = {
  stableKey: string;
  week: number;
  homeTeamAbbreviation: string;
  awayTeamAbbreviation: string;
  homeTeamProviderExternalId: string;
  awayTeamProviderExternalId: string;
  scheduledKickoffMs: number;
  providerGameExternalId: string;
  observedAtMs: number;
};

type PersistResult = {
  seasonId: Id<"poolSeasons">;
  poolId: Id<"pools">;
  membershipId: Id<"poolMemberships">;
  entryId: Id<"poolEntries">;
  gameCount: number;
  weeks: number[];
  earliestKickoffMs: number;
  latestKickoffMs: number;
  created: {
    season: boolean;
    pool: boolean;
    membership: boolean;
    entry: boolean;
  };
};

type SeedResult = PersistResult & {
  seasonLabel: string;
  poolName: string;
  provider: "api-sports";
  providerRowCount: number;
  normalizedPreseasonRowCount: number;
  skippedPreseasonRowCount: number;
};

function assertDevelopmentDeployment(): void {
  const kind = resolveDeploymentKind(
    process.env as Record<string, string | undefined>,
  );
  if (kind !== "development" && kind !== "dev") {
    throw new Error(
      "seedApiSportsPreseasonPool is development-only and refused this deployment",
    );
  }
}

function apiSportsAlias(
  aliases: readonly SportsDataProviderAlias[],
): SportsDataProviderAlias | null {
  const matches = aliases.filter(
    (alias) => alias.provider === "api-sports",
  );
  return matches.length === 1 ? matches[0]! : null;
}

function isPreseasonStage(stage: string): boolean {
  const normalized = stage.trim().toLowerCase();
  return normalized === "pre season" || normalized === "preseason";
}

function isSeedWeek(week: number): week is 1 | 2 | 3 {
  return PRESEASON_WEEKS.some((candidate) => candidate === week);
}

function rawSeedWeek(rawWeek: string): 1 | 2 | 3 | null {
  const matches = [...rawWeek.matchAll(/\d+/g)];
  const value = matches.at(-1)?.[0];
  if (!value) return null;
  const week = Number(value);
  return isSeedWeek(week) ? week : null;
}

function asSeedGame(
  game: SportsDataGameObservation,
): PreseasonSeedGame | null {
  if (
    game.seasonYear !== PRESEASON_YEAR ||
    game.seasonPhase !== "preseason" ||
    !isSeedWeek(game.week)
  ) {
    return null;
  }
  const gameAlias = apiSportsAlias(game.providerAliases);
  const homeAlias = game.homeTeamProviderAlias;
  const awayAlias = game.awayTeamProviderAlias;
  if (
    game.lifecycle !== "scheduled" ||
    gameAlias === null ||
    homeAlias?.provider !== "api-sports" ||
    awayAlias?.provider !== "api-sports" ||
    game.homeTeamAbbreviation === game.awayTeamAbbreviation
  ) {
    return null;
  }
  return {
    stableKey: game.stableKey,
    week: game.week,
    homeTeamAbbreviation: game.homeTeamAbbreviation,
    awayTeamAbbreviation: game.awayTeamAbbreviation,
    homeTeamProviderExternalId: homeAlias.id,
    awayTeamProviderExternalId: awayAlias.id,
    scheduledKickoffMs: game.scheduledKickoffMs,
    providerGameExternalId: gameAlias.id,
    observedAtMs: game.observedAtMs,
  };
}

export function selectPreseasonSeedGames(
  observations: readonly SportsDataGameObservation[],
  nowMs: number,
): PreseasonSeedGame[] {
  const inScope = observations.filter(
    (game) =>
      game.seasonYear === PRESEASON_YEAR &&
      game.seasonPhase === "preseason" &&
      isSeedWeek(game.week),
  );
  const candidates = inScope
    .map(asSeedGame)
    .filter((game): game is PreseasonSeedGame => game !== null);
  if (candidates.length !== inScope.length) {
    throw new Error(
      "Every in-scope preseason game must be scheduled with exact API-Sports aliases",
    );
  }
  return validatePreseasonSeedGames(candidates, nowMs);
}

export function validatePreseasonSeedGames(
  games: readonly PreseasonSeedGame[],
  nowMs: number,
): PreseasonSeedGame[] {
  if (games.length === 0 || games.length > MAX_PRESEASON_GAMES) {
    throw new Error(
      `Expected 1–${MAX_PRESEASON_GAMES} normalized preseason games`,
    );
  }

  const weeks = new Set<number>();
  const gameAliases = new Set<string>();
  const teamAliases = new Map<string, string>();
  const teamWeekKeys = new Set<string>();

  for (const game of games) {
    if (!isSeedWeek(game.week)) {
      throw new Error(`Preseason week ${game.week} is outside weeks 1–3`);
    }
    if (
      !Number.isSafeInteger(game.scheduledKickoffMs) ||
      game.scheduledKickoffMs <= nowMs
    ) {
      throw new Error("All seeded preseason games must have future kickoffs");
    }
    if (
      game.providerGameExternalId.trim() === "" ||
      game.homeTeamProviderExternalId.trim() === "" ||
      game.awayTeamProviderExternalId.trim() === ""
    ) {
      throw new Error("Every preseason game must retain exact provider aliases");
    }
    if (gameAliases.has(game.providerGameExternalId)) {
      throw new Error("Duplicate API-Sports preseason game alias");
    }
    gameAliases.add(game.providerGameExternalId);

    for (const [abbreviation, alias] of [
      [game.homeTeamAbbreviation, game.homeTeamProviderExternalId],
      [game.awayTeamAbbreviation, game.awayTeamProviderExternalId],
    ] as const) {
      if (canonicalNflTeam(abbreviation) === null) {
        throw new Error(`Unknown canonical NFL Team ${abbreviation}`);
      }
      const priorAlias = teamAliases.get(abbreviation);
      if (priorAlias !== undefined && priorAlias !== alias) {
        throw new Error(
          `Conflicting API-Sports aliases for NFL Team ${abbreviation}`,
        );
      }
      teamAliases.set(abbreviation, alias);

      const teamWeekKey = `${game.week}:${abbreviation}`;
      if (teamWeekKeys.has(teamWeekKey)) {
        throw new Error(
          `NFL Team ${abbreviation} appears twice in preseason week ${game.week}`,
        );
      }
      teamWeekKeys.add(teamWeekKey);
    }
    weeks.add(game.week);
  }

  if (PRESEASON_WEEKS.some((week) => !weeks.has(week))) {
    throw new Error("The preseason seed requires valid games in weeks 1, 2, and 3");
  }

  return [...games].sort(
    (left, right) =>
      left.week - right.week ||
      left.scheduledKickoffMs - right.scheduledKickoffMs ||
      left.providerGameExternalId.localeCompare(
        right.providerGameExternalId,
      ),
  );
}

export function assertCompletePreseasonSlate(
  games: readonly PreseasonSeedGame[],
): PreseasonSeedGame[] {
  if (games.length !== 48) {
    throw new Error(
      `Expected the complete three-week preseason slate (48 games), received ${games.length}`,
    );
  }
  const canonicalTeams = new Set(
    CANONICAL_NFL_TEAM_LIST.map((team) => team.abbreviation),
  );
  for (const week of PRESEASON_WEEKS) {
    const weekGames = games.filter((game) => game.week === week);
    const weekTeams = new Set(
      weekGames.flatMap((game) => [
        game.homeTeamAbbreviation,
        game.awayTeamAbbreviation,
      ]),
    );
    if (
      weekGames.length !== 16 ||
      weekTeams.size !== canonicalTeams.size ||
      [...canonicalTeams].some((team) => !weekTeams.has(team))
    ) {
      throw new Error(
        `Preseason week ${week} must contain 16 games covering all 32 NFL Teams`,
      );
    }
  }
  return [...games];
}

async function upsertTeam(
  ctx: MutationCtx,
  input: {
    abbreviation: string;
    providerExternalId: string;
    observedAtMs: number;
  },
): Promise<Doc<"nflTeams">> {
  const canonical = canonicalNflTeam(input.abbreviation);
  if (canonical === null) {
    throw new Error(`Unknown canonical NFL Team ${input.abbreviation}`);
  }
  const alias = {
    provider: "api-sports",
    externalId: input.providerExternalId,
  } as const;
  const reconciliation = await reconcileStoredNflTeam(ctx, {
    alias,
    stableKey: canonical.stableKey,
  });
  const teamId =
    reconciliation.kind === "resolved"
      ? reconciliation.nflTeamId
      : await ctx.db.insert("nflTeams", canonical);
  await attachNflTeamAlias(ctx, {
    nflTeamId: teamId,
    alias,
    observedAtMs: input.observedAtMs,
  });
  const team = await ctx.db.get(teamId);
  if (team === null) throw new Error("Failed to persist canonical NFL Team");
  return team;
}

export const persistApiSportsPreseasonPool = internalMutation({
  args: {
    ownerParticipantId: v.id("participants"),
    poolName: v.string(),
    games: v.array(preseasonGameValidator),
    nowMs: v.number(),
  },
  handler: async (ctx, args): Promise<PersistResult> => {
    assertDevelopmentDeployment();
    const games = validatePreseasonSeedGames(args.games, args.nowMs);
    const poolName = args.poolName.trim();
    if (poolName === "") {
      throw new Error("Pool name is required");
    }

    const owner = await ctx.db.get(args.ownerParticipantId);
    if (owner === null) {
      throw new Error("The selected owner Participant does not exist");
    }
    if (owner.suspended) {
      throw new Error("The selected owner Participant is suspended");
    }

    let createdSeason = false;
    let season = await ctx.db
      .query("poolSeasons")
      .withIndex("by_label", (q) => q.eq("label", PRESEASON_SEASON_LABEL))
      .unique();
    if (season === null) {
      const seasonId = await ctx.db.insert("poolSeasons", {
        label: PRESEASON_SEASON_LABEL,
        year: PRESEASON_YEAR,
        status: "available",
        competitionPhase: "preseason",
        usableStartWeek: 1,
        bootstrappedAtMs: args.nowMs,
      });
      season = await ctx.db.get(seasonId);
      createdSeason = true;
    } else if (
      season.status !== "available" ||
      season.competitionPhase !== "preseason"
    ) {
      await ctx.db.patch(season._id, {
        status: "available",
        competitionPhase: "preseason",
        usableStartWeek: 1,
        bootstrappedAtMs: args.nowMs,
      });
      season = await ctx.db.get(season._id);
    }
    if (
      season === null ||
      season.year !== PRESEASON_YEAR ||
      season.status !== "available" ||
      season.competitionPhase !== "preseason"
    ) {
      throw new Error(
        "The isolated preseason season has incompatible identity; refusing to seed",
      );
    }

    const teams = new Map<string, Doc<"nflTeams">>();
    for (const game of games) {
      for (const [abbreviation, providerExternalId] of [
        [game.homeTeamAbbreviation, game.homeTeamProviderExternalId],
        [game.awayTeamAbbreviation, game.awayTeamProviderExternalId],
      ] as const) {
        if (!teams.has(abbreviation)) {
          teams.set(
            abbreviation,
            await upsertTeam(ctx, {
              abbreviation,
              providerExternalId,
              observedAtMs: game.observedAtMs,
            }),
          );
        }
      }
    }

    for (const game of games) {
      const homeTeam = teams.get(game.homeTeamAbbreviation);
      const awayTeam = teams.get(game.awayTeamAbbreviation);
      if (homeTeam === undefined || awayTeam === undefined) {
        throw new Error("Preseason game references an unresolved NFL Team");
      }
      const alias = {
        provider: "api-sports",
        externalId: game.providerGameExternalId,
      } as const;
      const ownership = await resolveNflGameAlias(ctx, alias);
      if (ownership.kind === "owned") {
        const existing = await ctx.db.get(ownership.ownerId);
        if (existing === null || existing.seasonId !== season._id) {
          throw new Error(
            "An API-Sports preseason game alias belongs to another season",
          );
        }
      }
      const reconciliation = await reconcileStoredNflGame(ctx, {
        alias,
        seasonId: season._id,
        week: game.week,
        homeTeamId: homeTeam._id,
        awayTeamId: awayTeam._id,
        homeTeamStableKey: canonicalNflTeam(
          game.homeTeamAbbreviation,
        )!.stableKey,
        awayTeamStableKey: canonicalNflTeam(
          game.awayTeamAbbreviation,
        )!.stableKey,
        scheduledKickoffMs: game.scheduledKickoffMs,
      });
      await persistReconciledNflGame(ctx, {
        reconciliation,
        fields: {
          stableKey: `preseason:${game.stableKey}`,
          seasonId: season._id,
          seasonLabel: PRESEASON_SEASON_LABEL,
          week: game.week,
          homeTeamId: homeTeam._id,
          awayTeamId: awayTeam._id,
          scheduledKickoffMs: game.scheduledKickoffMs,
          lifecycle: "scheduled",
          homeScore: null,
          awayScore: null,
          resultAuthority: "none",
        },
        alias,
        observedAtMs: game.observedAtMs,
      });
    }

    const ownerPools = await ctx.db
      .query("pools")
      .withIndex("by_ownerParticipantId", (q) =>
        q.eq("ownerParticipantId", owner._id),
      )
      .take(20);
    const matchingPools = ownerPools.filter(
      (pool) =>
        pool.seasonId === season._id &&
        pool.name === poolName,
    );
    if (matchingPools.length > 1) {
      throw new Error("Duplicate preseason test pools exist for this owner");
    }

    let createdPool = false;
    let pool = matchingPools[0] ?? null;
    if (pool === null) {
      const poolId = await ctx.db.insert("pools", {
        name: poolName,
        type: "survivor",
        seasonId: season._id,
        startWeek: 1,
        finalWeek: PRESEASON_FINAL_WEEK,
        pickLockMode: "gameKickoff",
        status: "active",
        rulesFrozen: false,
        ownerParticipantId: owner._id,
        createdAtMs: args.nowMs,
      });
      const created = await ctx.db.get(poolId);
      if (created === null) {
        throw new Error("Failed to persist preseason test pool");
      }
      pool = created;
      createdPool = true;
    } else if (pool.finalWeek !== PRESEASON_FINAL_WEEK) {
      await ctx.db.patch(pool._id, {
        finalWeek: PRESEASON_FINAL_WEEK,
      });
      const updated = await ctx.db.get(pool._id);
      if (updated === null) {
        throw new Error("Failed to update preseason test pool");
      }
      pool = updated;
    }
    if (
      pool === null ||
      pool.type !== "survivor" ||
      pool.seasonId !== season._id ||
      pool.startWeek !== 1 ||
      pool.finalWeek !== PRESEASON_FINAL_WEEK ||
      pool.ownerParticipantId !== owner._id
    ) {
      throw new Error("Existing preseason test pool has incompatible rules");
    }

    let createdMembership = false;
    let membership = await ctx.db
      .query("poolMemberships")
      .withIndex("by_poolId_and_participantId", (q) =>
        q.eq("poolId", pool!._id).eq("participantId", owner._id),
      )
      .unique();
    if (membership === null) {
      const membershipId = await ctx.db.insert("poolMemberships", {
        poolId: pool._id,
        participantId: owner._id,
        role: "owner",
        status: "active",
      });
      membership = await ctx.db.get(membershipId);
      createdMembership = true;
    } else if (
      membership.role !== "owner" ||
      membership.status !== "active"
    ) {
      await ctx.db.patch(membership._id, {
        role: "owner",
        status: "active",
        statusReason: undefined,
        statusChangedAtMs: args.nowMs,
      });
      membership = await ctx.db.get(membership._id);
    }
    if (membership === null) {
      throw new Error("Failed to persist preseason pool ownership");
    }

    const ownerEntries = await ctx.db
      .query("poolEntries")
      .withIndex("by_poolId_and_participantId", (q) =>
        q.eq("poolId", pool!._id).eq("participantId", owner._id),
      )
      .take(11);
    const primaryEntries = ownerEntries.filter(
      (entry) => entry.entryNumber === 1,
    );
    if (primaryEntries.length > 1) {
      throw new Error("Duplicate primary owner entries exist in preseason pool");
    }
    let createdEntry = false;
    let entry = primaryEntries[0] ?? null;
    if (entry === null) {
      const entryId = await ctx.db.insert("poolEntries", {
        poolId: pool._id,
        participantId: owner._id,
        membershipId: membership._id,
        entryNumber: 1,
        status: "active",
        createdAtMs: args.nowMs,
      });
      const created = await ctx.db.get(entryId);
      if (created === null) {
        throw new Error("Failed to persist preseason owner entry");
      }
      entry = created;
      createdEntry = true;
    } else if (
      entry.membershipId !== membership._id ||
      entry.status !== "active"
    ) {
      await ctx.db.patch(entry._id, {
        membershipId: membership._id,
        status: "active",
        endedAtMs: undefined,
      });
      const updated = await ctx.db.get(entry._id);
      if (updated === null) {
        throw new Error("Failed to update preseason owner entry");
      }
      entry = updated;
    }
    if (entry === null) {
      throw new Error("Failed to persist preseason owner entry");
    }

    return {
      seasonId: season._id,
      poolId: pool._id,
      membershipId: membership._id,
      entryId: entry._id,
      gameCount: games.length,
      weeks: [...PRESEASON_WEEKS],
      earliestKickoffMs: games[0]!.scheduledKickoffMs,
      latestKickoffMs: games.at(-1)!.scheduledKickoffMs,
      created: {
        season: createdSeason,
        pool: createdPool,
        membership: createdMembership,
        entry: createdEntry,
      },
    };
  },
});

export const seedApiSportsPreseasonPool = internalAction({
  args: {
    ownerParticipantId: v.id("participants"),
    poolName: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<SeedResult> => {
    assertDevelopmentDeployment();
    const apiKey = env.API_SPORTS_KEY?.trim();
    if (!apiKey) {
      throw new Error(
        "API-Sports is not configured for this development deployment",
      );
    }

    const nowMs = Date.now();
    const client = createApiSportsClient({
      apiKey,
      teamSeasonYear: PRESEASON_YEAR,
    });
    const response = await runEffect(
      client.fetchSeasonGames(PRESEASON_YEAR),
    );
    const preseasonRows = response.data.filter((row) =>
      isPreseasonStage(row.game.stage),
    );
    const inScopeRows = preseasonRows.filter(
      (row) => rawSeedWeek(row.game.week) !== null,
    );
    const normalized = await runEffect(
      Effect.all(
        inScopeRows.map((row) =>
          normalizeApiSportsGame(row, response.observedAtMs),
        ),
        { concurrency: "unbounded" },
      ),
    );
    const games = assertCompletePreseasonSlate(
      selectPreseasonSeedGames(normalized, nowMs),
    );
    const poolName = args.poolName?.trim() || DEFAULT_POOL_NAME;
    const persisted: PersistResult = await ctx.runMutation(
      internal.seedPreseason.persistApiSportsPreseasonPool,
      {
        ownerParticipantId: args.ownerParticipantId,
        poolName,
        games,
        nowMs,
      },
    );

    return {
      ...persisted,
      seasonLabel: PRESEASON_SEASON_LABEL,
      poolName,
      provider: "api-sports",
      providerRowCount: response.data.length,
      normalizedPreseasonRowCount: games.length,
      skippedPreseasonRowCount: preseasonRows.length - games.length,
    };
  },
});
