/**
 * Pick state presentation — won/lost never color-only (shell contract).
 */

export type PickOutcome = "won" | "lost" | null;

export type VerifiedScore = {
  homeScore: number;
  awayScore: number;
  status: "FT" | "AOT" | "CANC";
};

/**
 * Derive official winner team id from Verified Result scores.
 * Ties and cancellations yield null (no won/lost label).
 */
export function officialWinnerTeamId(args: {
  isOfficial: boolean;
  verifiedResult: VerifiedScore | null | undefined;
  homeTeamId: string | null | undefined;
  awayTeamId: string | null | undefined;
}): string | null {
  if (!args.isOfficial || !args.verifiedResult) return null;
  if (args.verifiedResult.status === "CANC") return null;
  const { homeScore, awayScore } = args.verifiedResult;
  if (homeScore === awayScore) return null;
  if (homeScore > awayScore) return args.homeTeamId ?? null;
  return args.awayTeamId ?? null;
}

export function resolvePickOutcome(args: {
  pickedTeamId: string | null | undefined;
  winnerTeamId: string | null | undefined;
}): PickOutcome {
  if (!args.pickedTeamId || !args.winnerTeamId) return null;
  return args.pickedTeamId === args.winnerTeamId ? "won" : "lost";
}

/** Accessible text/icon label — color alone must not carry meaning. */
export function pickOutcomeLabel(outcome: Exclude<PickOutcome, null>): string {
  return outcome === "won" ? "Pick won" : "Pick lost";
}

export function pickOutcomeMark(outcome: Exclude<PickOutcome, null>): string {
  return outcome === "won" ? "✓" : "✕";
}

export function teamPickAccessibleName(args: {
  teamAbbreviation: string;
  selected: boolean;
  locked: boolean;
  outcome: PickOutcome;
}): string {
  const parts = [args.teamAbbreviation];
  if (args.selected) parts.push("selected");
  if (args.locked) parts.push("locked");
  if (args.outcome === "won") parts.push("Pick won");
  if (args.outcome === "lost") parts.push("Pick lost");
  return parts.join(", ");
}
