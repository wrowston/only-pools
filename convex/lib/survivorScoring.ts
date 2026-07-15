/**
 * Pure Survivor scoring helpers — pick outcomes, fingerprints, terminal winners.
 * Official outcomes use Verified Results only (never provisional).
 */

export const SURVIVOR_FINAL_WEEK = 18;

export type SurvivorPickOutcomeKind =
  | "win"
  | "loss"
  | "tie"
  | "missing_pick"
  | "pending"
  | "invalidated";

export type EliminationReason = "loss" | "tie" | "missing_pick";

export type SurvivorEligibility = "alive" | "eliminated" | "winner";

export type VerifiedGameInput = {
  gameId: string;
  homeTeamId: string;
  awayTeamId: string;
  resultAuthority: string;
  homeScore: number | null;
  awayScore: number | null;
  verifiedStatus?: string | null;
};

export type SurvivorPickInput = {
  pickId?: string;
  participantId: string;
  week: number;
  nflTeamId?: string;
  gameId?: string;
  provenance: "authored" | "omission";
  provisional: boolean;
  invalidated?: boolean;
};

/**
 * Resolve one Survivor Pick against a Verified Result.
 * Missing required pick (omission or absent after week lock) eliminates.
 * Unverified games stay pending — never official.
 */
export function resolveSurvivorPickOutcome(args: {
  pick: SurvivorPickInput | null;
  game: VerifiedGameInput | null;
  /** True when every slate game has reached Pick Lock (omissions materialize). */
  weekFullyLocked: boolean;
}): SurvivorPickOutcomeKind {
  const { pick, game, weekFullyLocked } = args;

  if (pick?.invalidated) {
    return "invalidated";
  }

  if (!pick || pick.provenance === "omission" || pick.nflTeamId === undefined) {
    if (weekFullyLocked) {
      return "missing_pick";
    }
    return "pending";
  }

  if (!game || game.resultAuthority !== "verified") {
    return "pending";
  }

  if (game.verifiedStatus === "CANC") {
    // No-Contest Advance is ticketed separately; treat as pending here so we
    // never invent an official win/loss from cancellation in this module.
    return "pending";
  }

  if (game.homeScore === null || game.awayScore === null) {
    return "pending";
  }

  if (game.homeScore === game.awayScore) {
    return "tie";
  }

  const winnerTeamId =
    game.homeScore > game.awayScore ? game.homeTeamId : game.awayTeamId;
  return pick.nflTeamId === winnerTeamId ? "win" : "loss";
}

export function eliminationReasonFromOutcome(
  outcome: SurvivorPickOutcomeKind,
): EliminationReason | null {
  if (outcome === "loss" || outcome === "tie" || outcome === "missing_pick") {
    return outcome;
  }
  return null;
}

export type ParticipantWeekResult = {
  participantId: string;
  outcome: SurvivorPickOutcomeKind;
  enteredAlive: boolean;
};

export type TerminalDecision =
  | { kind: "none" }
  | { kind: "sole_winner"; winnerParticipantId: string }
  | { kind: "joint_winners"; winnerParticipantIds: string[] };

/**
 * Terminal Survivor outcomes after a settled Pool Week.
 * - Sole Alive → Winner + Completed
 * - All who entered Alive eliminated → joint winners (that cohort)
 * - Multiple Alive after final included week → joint winners
 */
export function decideSurvivorTerminalOutcome(args: {
  week: number;
  finalWeek: number;
  weekSettled: boolean;
  /** Eligibility after applying this week's outcomes (before winner designation). */
  afterWeek: Array<{
    participantId: string;
    eligibility: "alive" | "eliminated";
  }>;
  /** Participants who entered this week Alive. */
  enteredAliveIds: string[];
}): TerminalDecision {
  if (!args.weekSettled) {
    return { kind: "none" };
  }

  const stillAlive = args.afterWeek
    .filter((p) => p.eligibility === "alive")
    .map((p) => p.participantId);

  if (stillAlive.length === 1) {
    return { kind: "sole_winner", winnerParticipantId: stillAlive[0]! };
  }

  if (stillAlive.length === 0 && args.enteredAliveIds.length > 0) {
    return {
      kind: "joint_winners",
      winnerParticipantIds: [...args.enteredAliveIds].sort(),
    };
  }

  if (stillAlive.length > 1 && args.week >= args.finalWeek) {
    return {
      kind: "joint_winners",
      winnerParticipantIds: [...stillAlive].sort(),
    };
  }

  return { kind: "none" };
}

/** Stable fingerprint of authoritative Survivor scoring inputs for a Pool Week. */
export function survivorScoringFingerprint(
  parts: ReadonlyArray<string | number | boolean | null | undefined>,
): string {
  return parts.map((p) => (p === undefined ? "" : String(p))).join("|");
}

export function buildSurvivorWeekFingerprint(args: {
  poolId: string;
  week: number;
  priorEligibility: Array<{ participantId: string; eligibility: string }>;
  picks: Array<{
    participantId: string;
    nflTeamId?: string;
    gameId?: string;
    provenance: string;
    invalidated?: boolean;
  }>;
  verifiedGames: Array<{
    gameId: string;
    homeScore: number;
    awayScore: number;
    status: string;
  }>;
  weekFullyLocked: boolean;
}): string {
  const prior = [...args.priorEligibility]
    .sort((a, b) => a.participantId.localeCompare(b.participantId))
    .map((p) => `${p.participantId}:${p.eligibility}`)
    .join(",");
  const picks = [...args.picks]
    .sort((a, b) => a.participantId.localeCompare(b.participantId))
    .map(
      (p) =>
        `${p.participantId}:${p.provenance}:${p.nflTeamId ?? ""}:${p.gameId ?? ""}:${p.invalidated === true ? "1" : "0"}`,
    )
    .join(",");
  const games = [...args.verifiedGames]
    .sort((a, b) => a.gameId.localeCompare(b.gameId))
    .map((g) => `${g.gameId}:${g.homeScore}-${g.awayScore}:${g.status}`)
    .join(",");
  return survivorScoringFingerprint([
    args.poolId,
    args.week,
    prior,
    picks,
    games,
    args.weekFullyLocked ? "locked" : "open",
  ]);
}
