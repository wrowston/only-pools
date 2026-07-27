import type { WithoutSystemFields } from "convex/server";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import {
  classifyAliasOwnership,
  normalizeProviderAlias,
  type AliasOwnership,
  type ProviderAlias,
} from "./aliases";
import {
  reconcileNflGameIdentity,
  type NflGameIdentityCandidate,
  type ObservedNflGameIdentity,
} from "./reconciliation";
import type { NflTeamStableKey } from "./catalog";
import { isNflTeamStableKey } from "./identity";

export const LEGACY_SPORTS_DB_PROVIDER = "the-sports-db";

type ReadCtx = Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">;

export class SportsIdentityConflict extends Error {
  readonly name = "SportsIdentityConflict";

  constructor(
    readonly code:
      | "duplicate_alias"
      | "ambiguous_alias"
      | "alias_owner_mismatch"
      | "alias_identity_mismatch"
      | "ambiguous_canonical_identity",
    message: string,
  ) {
    super(message);
  }
}

export async function resolveNflTeamAlias(
  ctx: ReadCtx,
  alias: ProviderAlias,
): Promise<AliasOwnership<Id<"nflTeams">>> {
  const normalized = normalizeProviderAlias(alias);
  const matchingAliases = () =>
    ctx.db
      .query("nflTeamAliases")
      .withIndex(
        "by_provider_and_externalId_and_nflTeamId",
        (q) =>
          q
            .eq("provider", normalized.provider)
            .eq("externalId", normalized.externalId),
      );
  const [first, last] = await Promise.all([
    matchingAliases().order("asc").first(),
    matchingAliases().order("desc").first(),
  ]);
  if (!first || !last) return { kind: "unclaimed" };
  if (first.nflTeamId !== last.nflTeamId) {
    return {
      kind: "ambiguous",
      ownerIds: [first.nflTeamId, last.nflTeamId],
    };
  }
  const rows = await matchingAliases().take(2);
  return classifyAliasOwnership(
    rows.map((row) => ({ ownerId: row.nflTeamId })),
  );
}

export async function resolveNflGameAlias(
  ctx: ReadCtx,
  alias: ProviderAlias,
): Promise<AliasOwnership<Id<"nflGames">>> {
  const normalized = normalizeProviderAlias(alias);
  const matchingAliases = () =>
    ctx.db
      .query("nflGameAliases")
      .withIndex(
        "by_provider_and_externalId_and_nflGameId",
        (q) =>
          q
            .eq("provider", normalized.provider)
            .eq("externalId", normalized.externalId),
      );
  const [first, last] = await Promise.all([
    matchingAliases().order("asc").first(),
    matchingAliases().order("desc").first(),
  ]);
  if (!first || !last) return { kind: "unclaimed" };
  if (first.nflGameId !== last.nflGameId) {
    return {
      kind: "ambiguous",
      ownerIds: [first.nflGameId, last.nflGameId],
    };
  }
  const rows = await matchingAliases().take(2);
  return classifyAliasOwnership(
    rows.map((row) => ({ ownerId: row.nflGameId })),
  );
}

export async function reconcileStoredNflTeam(
  ctx: ReadCtx,
  input: {
    alias: ProviderAlias;
    stableKey: NflTeamStableKey;
    /** Temporary bridge for rows created before generic alias storage. */
    legacySportsDbTeamId?: string;
  },
): Promise<
  | Readonly<{ kind: "resolved"; nflTeamId: Id<"nflTeams"> }>
  | Readonly<{ kind: "unresolved" }>
> {
  const ownership = await resolveNflTeamAlias(ctx, input.alias);
  if (ownership.kind === "duplicate") {
    throw new SportsIdentityConflict(
      "duplicate_alias",
      `Duplicate NFL Team alias ownership for ${input.alias.externalId}`,
    );
  }
  if (ownership.kind === "ambiguous") {
    throw new SportsIdentityConflict(
      "ambiguous_alias",
      `Ambiguous NFL Team alias ownership for ${input.alias.externalId}`,
    );
  }

  const canonicalMatches = await ctx.db
    .query("nflTeams")
    .withIndex("by_stableKey", (q) => q.eq("stableKey", input.stableKey))
    .take(2);
  if (canonicalMatches.length > 1) {
    throw new SportsIdentityConflict(
      "ambiguous_canonical_identity",
      `Duplicate canonical NFL Team identity: ${input.stableKey}`,
    );
  }

  const legacyMatches = input.legacySportsDbTeamId
    ? await ctx.db
        .query("nflTeams")
        .withIndex("by_sportsDbTeamId", (q) =>
          q.eq("sportsDbTeamId", input.legacySportsDbTeamId!),
        )
        .take(2)
    : [];
  if (legacyMatches.length > 1) {
    throw new SportsIdentityConflict(
      "ambiguous_alias",
      `Ambiguous legacy NFL Team alias: ${input.legacySportsDbTeamId}`,
    );
  }

  const candidateIds = new Set<Id<"nflTeams">>();
  if (ownership.kind === "owned") candidateIds.add(ownership.ownerId);
  if (canonicalMatches[0]) candidateIds.add(canonicalMatches[0]._id);
  if (legacyMatches[0]) candidateIds.add(legacyMatches[0]._id);
  if (candidateIds.size > 1) {
    throw new SportsIdentityConflict(
      "alias_owner_mismatch",
      `NFL Team alias conflicts with canonical identity ${input.stableKey}`,
    );
  }

  const nflTeamId = [...candidateIds][0];
  return nflTeamId
    ? { kind: "resolved", nflTeamId }
    : { kind: "unresolved" };
}

function assertAliasCanAttach<OwnerId extends string>(
  ownership: AliasOwnership<OwnerId>,
  expectedOwnerId: OwnerId,
): void {
  if (ownership.kind === "duplicate") {
    throw new SportsIdentityConflict(
      "duplicate_alias",
      `Duplicate alias ownership for ${ownership.ownerId}`,
    );
  }
  if (ownership.kind === "ambiguous") {
    throw new SportsIdentityConflict(
      "ambiguous_alias",
      `Ambiguous alias ownership across ${ownership.ownerIds.join(", ")}`,
    );
  }
  if (
    ownership.kind === "owned" &&
    ownership.ownerId !== expectedOwnerId
  ) {
    throw new SportsIdentityConflict(
      "alias_owner_mismatch",
      `Alias already belongs to ${ownership.ownerId}`,
    );
  }
}

export async function attachNflTeamAlias(
  ctx: MutationCtx,
  input: {
    nflTeamId: Id<"nflTeams">;
    alias: ProviderAlias;
    observedAtMs: number;
  },
): Promise<void> {
  const alias = normalizeProviderAlias(input.alias);
  const ownership = await resolveNflTeamAlias(ctx, alias);
  assertAliasCanAttach(ownership, input.nflTeamId);

  const currentRows = await ctx.db
    .query("nflTeamAliases")
    .withIndex("by_nflTeamId_and_provider_and_isCurrent", (q) =>
      q
        .eq("nflTeamId", input.nflTeamId)
        .eq("provider", alias.provider)
        .eq("isCurrent", true),
    )
    .take(2);
  if (currentRows.length > 1) {
    throw new SportsIdentityConflict(
      "duplicate_alias",
      `Multiple current NFL Team aliases for ${input.nflTeamId}`,
    );
  }
  for (const row of currentRows) {
    if (row.externalId !== alias.externalId) {
      await ctx.db.patch(row._id, { isCurrent: false });
    }
  }

  if (ownership.kind === "owned") {
    const [row] = await ctx.db
      .query("nflTeamAliases")
      .withIndex(
        "by_provider_and_externalId_and_nflTeamId",
        (q) =>
          q
            .eq("provider", alias.provider)
            .eq("externalId", alias.externalId)
            .eq("nflTeamId", input.nflTeamId),
      )
      .take(1);
    if (row) {
      await ctx.db.patch(row._id, {
        isCurrent: true,
        lastObservedAtMs: input.observedAtMs,
      });
    }
    return;
  }

  await ctx.db.insert("nflTeamAliases", {
    nflTeamId: input.nflTeamId,
    provider: alias.provider,
    externalId: alias.externalId,
    isCurrent: true,
    firstObservedAtMs: input.observedAtMs,
    lastObservedAtMs: input.observedAtMs,
  });
}

export async function attachNflGameAlias(
  ctx: MutationCtx,
  input: {
    nflGameId: Id<"nflGames">;
    alias: ProviderAlias;
    observedAtMs: number;
  },
): Promise<void> {
  const alias = normalizeProviderAlias(input.alias);
  const ownership = await resolveNflGameAlias(ctx, alias);
  assertAliasCanAttach(ownership, input.nflGameId);

  const currentRows = await ctx.db
    .query("nflGameAliases")
    .withIndex("by_nflGameId_and_provider_and_isCurrent", (q) =>
      q
        .eq("nflGameId", input.nflGameId)
        .eq("provider", alias.provider)
        .eq("isCurrent", true),
    )
    .take(2);
  if (currentRows.length > 1) {
    throw new SportsIdentityConflict(
      "duplicate_alias",
      `Multiple current NFL Game aliases for ${input.nflGameId}`,
    );
  }
  for (const row of currentRows) {
    if (row.externalId !== alias.externalId) {
      await ctx.db.patch(row._id, { isCurrent: false });
    }
  }

  if (ownership.kind === "owned") {
    const [row] = await ctx.db
      .query("nflGameAliases")
      .withIndex(
        "by_provider_and_externalId_and_nflGameId",
        (q) =>
          q
            .eq("provider", alias.provider)
            .eq("externalId", alias.externalId)
            .eq("nflGameId", input.nflGameId),
      )
      .take(1);
    if (row) {
      await ctx.db.patch(row._id, {
        isCurrent: true,
        lastObservedAtMs: input.observedAtMs,
      });
    }
    return;
  }

  await ctx.db.insert("nflGameAliases", {
    nflGameId: input.nflGameId,
    provider: alias.provider,
    externalId: alias.externalId,
    isCurrent: true,
    firstObservedAtMs: input.observedAtMs,
    lastObservedAtMs: input.observedAtMs,
  });
}

export async function recordNflGameSchedule(
  ctx: MutationCtx,
  input: {
    nflGameId: Id<"nflGames">;
    seasonId: Id<"poolSeasons">;
    week: number;
    homeTeamId: Id<"nflTeams">;
    awayTeamId: Id<"nflTeams">;
    scheduledKickoffMs: number;
    observedAtMs: number;
  },
): Promise<void> {
  const rows = await ctx.db
    .query("nflGameScheduleHistory")
    .withIndex("by_nflGameId_and_scheduledKickoffMs", (q) =>
      q
        .eq("nflGameId", input.nflGameId)
        .eq("scheduledKickoffMs", input.scheduledKickoffMs),
    )
    .take(2);
  if (rows.length > 1) {
    throw new SportsIdentityConflict(
      "ambiguous_canonical_identity",
      `Duplicate schedule history for NFL Game ${input.nflGameId}`,
    );
  }
  if (rows[0]) {
    await ctx.db.patch(rows[0]._id, {
      lastObservedAtMs: input.observedAtMs,
    });
    return;
  }
  await ctx.db.insert("nflGameScheduleHistory", {
    nflGameId: input.nflGameId,
    seasonId: input.seasonId,
    week: input.week,
    homeTeamId: input.homeTeamId,
    awayTeamId: input.awayTeamId,
    scheduledKickoffMs: input.scheduledKickoffMs,
    firstObservedAtMs: input.observedAtMs,
    lastObservedAtMs: input.observedAtMs,
  });
}

export async function persistReconciledNflGame(
  ctx: MutationCtx,
  input: {
    reconciliation:
      | Readonly<{ kind: "resolved"; nflGameId: Id<"nflGames"> }>
      | Readonly<{ kind: "unresolved" }>;
    fields: WithoutSystemFields<Doc<"nflGames">>;
    alias: ProviderAlias;
    observedAtMs: number;
  },
): Promise<Id<"nflGames">> {
  const nflGameId =
    input.reconciliation.kind === "resolved"
      ? input.reconciliation.nflGameId
      : await ctx.db.insert("nflGames", input.fields);
  if (input.reconciliation.kind === "resolved") {
    await ctx.db.patch(nflGameId, input.fields);
  }
  await attachNflGameAlias(ctx, {
    nflGameId,
    alias: input.alias,
    observedAtMs: input.observedAtMs,
  });
  await recordNflGameSchedule(ctx, {
    nflGameId,
    seasonId: input.fields.seasonId,
    week: input.fields.week,
    homeTeamId: input.fields.homeTeamId,
    awayTeamId: input.fields.awayTeamId,
    scheduledKickoffMs: input.fields.scheduledKickoffMs,
    observedAtMs: input.observedAtMs,
  });
  return nflGameId;
}

async function candidateForGame(
  ctx: ReadCtx,
  input: {
    gameId: Id<"nflGames">;
    observed: ObservedNflGameIdentity;
  },
): Promise<NflGameIdentityCandidate<Id<"nflGames">> | null> {
  const game = await ctx.db.get(input.gameId);
  if (!game) return null;
  const [homeTeam, awayTeam] = await Promise.all([
    ctx.db.get(game.homeTeamId),
    ctx.db.get(game.awayTeamId),
  ]);
  if (!homeTeam || !awayTeam) return null;
  if (
    !isNflTeamStableKey(homeTeam.stableKey) ||
    !isNflTeamStableKey(awayTeam.stableKey)
  ) {
    return null;
  }
  const history = await ctx.db
    .query("nflGameScheduleHistory")
    .withIndex("by_nflGameId_and_scheduledKickoffMs", (q) =>
      q
        .eq("nflGameId", game._id)
        .eq("scheduledKickoffMs", input.observed.scheduledKickoffMs),
    )
    .take(1);
  return {
    gameId: game._id,
    seasonKey: game.seasonId,
    week: game.week,
    homeTeamStableKey: homeTeam.stableKey,
    awayTeamStableKey: awayTeam.stableKey,
    scheduledKickoffMs: game.scheduledKickoffMs,
    scheduleHistoryMs:
      history.length === 0 ? [] : [input.observed.scheduledKickoffMs],
  };
}

export async function reconcileStoredNflGame(
  ctx: ReadCtx,
  input: {
    alias: ProviderAlias;
    seasonId: Id<"poolSeasons">;
    week: number;
    homeTeamId: Id<"nflTeams">;
    awayTeamId: Id<"nflTeams">;
    homeTeamStableKey: NflTeamStableKey;
    awayTeamStableKey: NflTeamStableKey;
    scheduledKickoffMs: number;
  },
): Promise<
  | Readonly<{ kind: "resolved"; nflGameId: Id<"nflGames"> }>
  | Readonly<{ kind: "unresolved" }>
> {
  const aliasOwnership = await resolveNflGameAlias(ctx, input.alias);
  const observed: ObservedNflGameIdentity = {
    seasonKey: input.seasonId,
    week: input.week,
    homeTeamStableKey: input.homeTeamStableKey,
    awayTeamStableKey: input.awayTeamStableKey,
    scheduledKickoffMs: input.scheduledKickoffMs,
  };
  const exactGames = await ctx.db
    .query("nflGames")
    .withIndex(
      "by_seasonId_and_week_and_homeTeamId_and_awayTeamId",
      (q) =>
        q
          .eq("seasonId", input.seasonId)
          .eq("week", input.week)
          .eq("homeTeamId", input.homeTeamId)
          .eq("awayTeamId", input.awayTeamId),
    )
    .take(3);

  const candidateIds = new Set(exactGames.map((game) => game._id));
  if (aliasOwnership.kind === "owned") {
    candidateIds.add(aliasOwnership.ownerId);
  }
  const candidates = (
    await Promise.all(
      [...candidateIds].map((gameId) =>
        candidateForGame(ctx, { gameId, observed }),
      ),
    )
  ).filter(
    (
      candidate,
    ): candidate is NflGameIdentityCandidate<Id<"nflGames">> =>
      candidate !== null,
  );
  const resolution = reconcileNflGameIdentity({
    aliasOwnership,
    observedGame: observed,
    candidates,
  });

  if (resolution.kind === "resolved") {
    return { kind: "resolved", nflGameId: resolution.gameId };
  }
  if (resolution.kind === "unresolved") {
    return { kind: "unresolved" };
  }
  throw new SportsIdentityConflict(
    resolution.reason,
    `NFL Game alias reconciliation conflict (${resolution.reason}): ${resolution.gameIds.join(", ")}`,
  );
}

export async function inspectNflTeamIdentityByAlias(
  ctx: ReadCtx,
  alias: ProviderAlias,
) {
  const ownership = await resolveNflTeamAlias(ctx, alias);
  if (ownership.kind !== "owned") return { ownership };
  const team = await ctx.db.get(ownership.ownerId);
  return {
    ownership,
    nflTeamId: ownership.ownerId,
    stableKey: team?.stableKey ?? null,
  };
}

export async function inspectNflGameIdentityByAlias(
  ctx: ReadCtx,
  alias: ProviderAlias,
) {
  const ownership = await resolveNflGameAlias(ctx, alias);
  if (ownership.kind !== "owned") return { ownership };
  const game = await ctx.db.get(ownership.ownerId);
  if (!game) {
    return {
      ownership,
      nflGameId: ownership.ownerId,
      stableKey: null,
      aliases: [],
      scheduleHistoryMs: [],
    };
  }
  const aliases = await ctx.db
    .query("nflGameAliases")
    .withIndex("by_nflGameId_and_provider_and_isCurrent", (q) =>
      q.eq("nflGameId", game._id).eq("provider", alias.provider),
    )
    .take(64);
  const scheduleHistory = await ctx.db
    .query("nflGameScheduleHistory")
    .withIndex("by_nflGameId_and_scheduledKickoffMs", (q) =>
      q.eq("nflGameId", game._id),
    )
    .take(64);
  return {
    ownership,
    nflGameId: game._id,
    stableKey: game.stableKey,
    scheduledKickoffMs: game.scheduledKickoffMs,
    aliases: aliases
      .map((entry) => ({
        provider: entry.provider,
        externalId: entry.externalId,
        isCurrent: entry.isCurrent,
      }))
      .sort((left, right) =>
        left.externalId.localeCompare(right.externalId),
      ),
    scheduleHistoryMs: scheduleHistory
      .map((entry) => entry.scheduledKickoffMs)
      .sort((left, right) => left - right),
  };
}
