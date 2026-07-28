import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { terminalEvidenceMatches } from "../providers/sportsData/correctionReconciliation";

export type PinnedEvidenceDisposition =
  | "pinned_matching"
  | "pinned_conflicting";

export type PinnedEvidenceSource =
  | "api_sports_live"
  | "api_sports_targeted";

export const PINNED_RESULT_EVIDENCE_CADENCE_MS =
  6 * 60 * 60 * 1_000;

type PinnedTerminalResult = Readonly<{
  homeScore: number;
  awayScore: number;
  status: "FT" | "AOT" | "CANC";
  verifiedAtMs: number;
}>;

export async function hasPinnedResultEvidence(
  ctx: MutationCtx,
  overrideId: Id<"nflGameResultOverrides">,
): Promise<boolean> {
  return (await latestPinnedResultEvidence(ctx, overrideId)) !== null;
}

export async function latestPinnedResultEvidence(
  ctx: Pick<MutationCtx | QueryCtx, "db">,
  overrideId: Id<"nflGameResultOverrides">,
): Promise<Doc<"nflGameResultOverrideEvidence"> | null> {
  const [matching, conflicting] = await Promise.all(
    (["pinned_matching", "pinned_conflicting"] as const).map(
      (disposition) =>
        ctx.db
          .query("nflGameResultOverrideEvidence")
          .withIndex(
            "by_overrideId_and_disposition_and_observedAtMs",
            (q) =>
              q
                .eq("overrideId", overrideId)
                .eq("disposition", disposition),
          )
          .order("desc")
          .first(),
    ),
  );
  if (!matching) return conflicting;
  if (!conflicting) return matching;
  if (matching.observedAtMs !== conflicting.observedAtMs) {
    return matching.observedAtMs > conflicting.observedAtMs
      ? matching
      : conflicting;
  }
  if (matching._creationTime !== conflicting._creationTime) {
    return matching._creationTime > conflicting._creationTime
      ? matching
      : conflicting;
  }
  return String(matching._id) > String(conflicting._id)
    ? matching
    : conflicting;
}

/**
 * Retains meaningful terminal transitions for exactly one pin episode.
 * Repeated equivalent polls are no-ops; older evidence cannot become latest.
 */
export async function recordPinnedProviderEvidence(
  ctx: MutationCtx,
  input: {
    game: Doc<"nflGames">;
    result: PinnedTerminalResult;
    source: PinnedEvidenceSource;
  },
): Promise<PinnedEvidenceDisposition | "stale"> {
  const overrideId = input.game.pinnedResultOverrideId;
  if (overrideId === undefined) {
    throw new Error("Pinned provider evidence requires an active override");
  }
  const latest = await latestPinnedResultEvidence(ctx, overrideId);
  if (latest && input.result.verifiedAtMs < latest.observedAtMs) {
    return "stale";
  }
  if (
    latest &&
    latest.homeScore === input.result.homeScore &&
    latest.awayScore === input.result.awayScore &&
    latest.status === input.result.status &&
    (latest.disposition === "pinned_matching" ||
      latest.disposition === "pinned_conflicting")
  ) {
    return latest.disposition;
  }
  const disposition =
    input.game.verifiedResult &&
    terminalEvidenceMatches(input.game.verifiedResult, input.result)
      ? "pinned_matching"
      : "pinned_conflicting";
  await ctx.db.insert("nflGameResultReconciliationObservations", {
    nflGameId: input.game._id,
    pinnedOverrideId: overrideId,
    observedAtMs: input.result.verifiedAtMs,
    homeScore: input.result.homeScore,
    awayScore: input.result.awayScore,
    status: input.result.status,
    matchesVerified: disposition === "pinned_matching",
    disposition,
  });
  await ctx.db.insert("nflGameResultOverrideEvidence", {
    overrideId,
    observedAtMs: input.result.verifiedAtMs,
    homeScore: input.result.homeScore,
    awayScore: input.result.awayScore,
    status: input.result.status,
    disposition,
    source: input.source,
  });
  return disposition;
}
