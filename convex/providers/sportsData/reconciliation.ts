import type { AliasOwnership } from "./aliases";
import type { NflTeamStableKey } from "./catalog";

export type ObservedNflGameIdentity = Readonly<{
  seasonKey: string;
  week: number;
  awayTeamStableKey: NflTeamStableKey;
  homeTeamStableKey: NflTeamStableKey;
  scheduledKickoffMs: number;
}>;

export type NflGameIdentityCandidate<GameId extends string> =
  ObservedNflGameIdentity &
    Readonly<{
      gameId: GameId;
      scheduleHistoryMs: readonly number[];
    }>;

export type NflGameIdentityResolution<GameId extends string> =
  | Readonly<{
      kind: "resolved";
      gameId: GameId;
      reason: "provider_alias" | "canonical_identity" | "schedule_history";
    }>
  | Readonly<{ kind: "unresolved"; reason: "unknown_identity" }>
  | Readonly<{
      kind: "conflict";
      reason:
        | "duplicate_alias"
        | "ambiguous_alias"
        | "alias_identity_mismatch"
        | "ambiguous_canonical_identity";
      gameIds: readonly GameId[];
    }>;

function hasCanonicalIdentity(
  candidate: NflGameIdentityCandidate<string>,
  observed: ObservedNflGameIdentity,
): boolean {
  return (
    candidate.seasonKey === observed.seasonKey &&
    candidate.week === observed.week &&
    candidate.awayTeamStableKey === observed.awayTeamStableKey &&
    candidate.homeTeamStableKey === observed.homeTeamStableKey
  );
}

/**
 * Provider aliases and current kickoff never create competitive identity.
 * Exact canonical identity resolves the common case; schedule history is only
 * a corruption-safe tiebreak when duplicate canonical candidates already
 * exist.
 */
export function reconcileNflGameIdentity<GameId extends string>(input: {
  aliasOwnership: AliasOwnership<GameId>;
  observedGame: ObservedNflGameIdentity;
  candidates: readonly NflGameIdentityCandidate<GameId>[];
}): NflGameIdentityResolution<GameId> {
  if (input.aliasOwnership.kind === "duplicate") {
    return {
      kind: "conflict",
      reason: "duplicate_alias",
      gameIds: [input.aliasOwnership.ownerId],
    };
  }
  if (input.aliasOwnership.kind === "ambiguous") {
    return {
      kind: "conflict",
      reason: "ambiguous_alias",
      gameIds: input.aliasOwnership.ownerIds,
    };
  }

  const exactCandidates = input.candidates.filter((candidate) =>
    hasCanonicalIdentity(candidate, input.observedGame),
  );

  if (input.aliasOwnership.kind === "owned") {
    const aliasedOwnerId = input.aliasOwnership.ownerId;
    const aliasedCandidate = exactCandidates.find(
      (candidate) => candidate.gameId === aliasedOwnerId,
    );
    if (aliasedCandidate) {
      return {
        kind: "resolved",
        gameId: aliasedCandidate.gameId,
        reason: "provider_alias",
      };
    }
    return {
      kind: "conflict",
      reason: "alias_identity_mismatch",
      gameIds: [aliasedOwnerId],
    };
  }

  if (exactCandidates.length === 0) {
    return { kind: "unresolved", reason: "unknown_identity" };
  }
  if (exactCandidates.length === 1) {
    return {
      kind: "resolved",
      gameId: exactCandidates[0]!.gameId,
      reason: "canonical_identity",
    };
  }

  const historyMatches = exactCandidates.filter((candidate) =>
    candidate.scheduleHistoryMs.includes(
      input.observedGame.scheduledKickoffMs,
    ),
  );
  if (historyMatches.length === 1) {
    return {
      kind: "resolved",
      gameId: historyMatches[0]!.gameId,
      reason: "schedule_history",
    };
  }

  return {
    kind: "conflict",
    reason: "ambiguous_canonical_identity",
    gameIds: exactCandidates.map((candidate) => candidate.gameId),
  };
}
