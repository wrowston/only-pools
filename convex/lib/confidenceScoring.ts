/**
 * Pure Confidence scoring helpers — pick outcomes, points, tiebreaker, ranks,
 * Possible Remaining Points, and Scoring Revision fingerprints.
 * Official outcomes use Verified Results only (never provisional/live).
 */

export const CONFIDENCE_FINAL_WEEK = 18;

export type ConfidencePickOutcomeKind =
  | "correct"
  | "incorrect"
  | "omission_zero"
  | "tied_zero"
  | "canceled_zero"
  | "pending";

export type ConfidencePickOutcome = {
  outcome: ConfidencePickOutcomeKind;
  pointsEarned: number;
};

export type VerifiedGameInput = {
  gameId: string;
  homeTeamId: string;
  awayTeamId: string;
  resultAuthority: string;
  homeScore: number | null;
  awayScore: number | null;
  verifiedStatus?: string | null;
};

export type ConfidencePickInput = {
  gameId: string;
  pickedTeamId?: string;
  confidenceValue: number;
  provenance: "authored" | "automatic" | "omission";
  locked: boolean;
};

/**
 * Resolve one Confidence prediction against a Verified Result.
 * Correct → assigned unique value; incorrect / locked omission / tie / cancel → 0.
 * Values never redistribute. Unverified games stay pending.
 */
export function resolveConfidencePickOutcome(args: {
  pick: ConfidencePickInput;
  game: VerifiedGameInput | null;
}): ConfidencePickOutcome {
  const { pick, game } = args;
  const hasPrediction =
    pick.pickedTeamId !== undefined &&
    pick.provenance !== "omission";

  if (!game || game.resultAuthority !== "verified") {
    return { outcome: "pending", pointsEarned: 0 };
  }

  if (game.verifiedStatus === "CANC") {
    return { outcome: "canceled_zero", pointsEarned: 0 };
  }

  if (game.homeScore === null || game.awayScore === null) {
    return { outcome: "pending", pointsEarned: 0 };
  }

  if (!hasPrediction) {
    // Locked omission (or blank after lock) scores zero; unlocked blank stays
    // pending until Verified so Possible Remaining Points can still include it
    // when unlocked — but once verified with no pick, it's always zero.
    if (pick.locked || pick.provenance === "omission") {
      return { outcome: "omission_zero", pointsEarned: 0 };
    }
    return { outcome: "omission_zero", pointsEarned: 0 };
  }

  if (game.homeScore === game.awayScore) {
    return { outcome: "tied_zero", pointsEarned: 0 };
  }

  const winnerTeamId =
    game.homeScore > game.awayScore ? game.homeTeamId : game.awayTeamId;
  if (pick.pickedTeamId === winnerTeamId) {
    return { outcome: "correct", pointsEarned: pick.confidenceValue };
  }
  return { outcome: "incorrect", pointsEarned: 0 };
}

/**
 * Official Possible Remaining Points — Pick Locks + Verified Results only.
 * Includes unlocked blanks and unresolved valid predictions.
 * Excludes locked omissions and predictions already known incorrect/tied/canceled.
 */
export function computePossibleRemainingPoints(
  rows: Array<{
    pick: ConfidencePickInput;
    game: VerifiedGameInput | null;
  }>,
): number {
  let total = 0;
  for (const row of rows) {
    const resolved = resolveConfidencePickOutcome(row);
    if (resolved.outcome === "correct") continue;
    if (
      resolved.outcome === "incorrect" ||
      resolved.outcome === "tied_zero" ||
      resolved.outcome === "canceled_zero" ||
      resolved.outcome === "omission_zero"
    ) {
      continue;
    }
    // pending
    const hasPrediction =
      row.pick.pickedTeamId !== undefined &&
      row.pick.provenance !== "omission";
    if (!hasPrediction && row.pick.locked) {
      continue;
    }
    total += row.pick.confidenceValue;
  }
  return total;
}

export function computeWeeklyPoints(
  outcomes: Array<{ pointsEarned: number }>,
): number {
  return outcomes.reduce((sum, o) => sum + o.pointsEarned, 0);
}

export function weekFullyResolved(
  games: Array<{ resultAuthority: string }>,
): boolean {
  if (games.length === 0) return false;
  return games.every((g) => g.resultAuthority === "verified");
}

/**
 * Compare Weekly Tiebreaker Predictions for two participants with equal points.
 * Negative → a ranks ahead of b. Null actualTotal means unusable (equal).
 */
export function compareWeeklyTiebreaker(
  a: { prediction: number | null; actualTotal: number | null },
  b: { prediction: number | null; actualTotal: number | null },
): number {
  if (a.actualTotal === null || b.actualTotal === null) {
    return 0;
  }
  const aHas = a.prediction !== null;
  const bHas = b.prediction !== null;
  if (aHas && !bHas) return -1;
  if (!aHas && bHas) return 1;
  if (!aHas && !bHas) return 0;

  const aPred = a.prediction!;
  const bPred = b.prediction!;
  const actual = a.actualTotal;
  const aErr = Math.abs(aPred - actual);
  const bErr = Math.abs(bPred - actual);
  if (aErr !== bErr) return aErr - bErr;
  // Equal distance: prediction below actual ranks ahead of above.
  if (aPred !== bPred) return aPred - bPred;
  return 0;
}

export type WeeklyStandingInput = {
  participantId: string;
  points: number;
  tiebreakerPrediction: number | null;
};

export type RankedWeeklyStanding = WeeklyStandingInput & { rank: number };

/**
 * Rank Weekly Standings: points desc, then usable tiebreaker, competition ranks.
 */
export function rankWeeklyStandings(
  rows: WeeklyStandingInput[],
  tiebreaker: { actualTotal: number | null; usable: boolean },
): RankedWeeklyStanding[] {
  const sorted = [...rows].sort((a, b) => {
    if (a.points !== b.points) return b.points - a.points;
    if (!tiebreaker.usable) return a.participantId.localeCompare(b.participantId);
    return compareWeeklyTiebreaker(
      {
        prediction: a.tiebreakerPrediction,
        actualTotal: tiebreaker.actualTotal,
      },
      {
        prediction: b.tiebreakerPrediction,
        actualTotal: tiebreaker.actualTotal,
      },
    );
  });

  // Build sort groups for competition ranking.
  const groups: Array<{ key: string; sortGroup: number }> = [];
  let group = 0;
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i]!;
    if (i > 0) {
      const prev = sorted[i - 1]!;
      const samePoints = prev.points === cur.points;
      let sameTb = true;
      if (samePoints && tiebreaker.usable) {
        sameTb =
          compareWeeklyTiebreaker(
            {
              prediction: prev.tiebreakerPrediction,
              actualTotal: tiebreaker.actualTotal,
            },
            {
              prediction: cur.tiebreakerPrediction,
              actualTotal: tiebreaker.actualTotal,
            },
          ) === 0;
      } else if (samePoints && !tiebreaker.usable) {
        sameTb = true;
      } else {
        sameTb = false;
      }
      if (!samePoints || !sameTb) group += 1;
    }
    groups.push({ key: cur.participantId, sortGroup: group });
  }

  const ranks = assignCompetitionRanks(groups);
  const rankById = new Map(ranks.map((r) => [r.key, r.rank]));
  return sorted.map((row) => ({
    ...row,
    rank: rankById.get(row.participantId) ?? 0,
  }));
}

/**
 * Season Standing competition ranks from equal point totals (1, 2, 2, 4).
 */
export function assignCompetitionRanks(
  ordered: Array<{ key: string; sortGroup: number }>,
): Array<{ key: string; rank: number }> {
  const result: Array<{ key: string; rank: number }> = [];
  let i = 0;
  while (i < ordered.length) {
    const g = ordered[i]!.sortGroup;
    const start = i;
    while (i < ordered.length && ordered[i]!.sortGroup === g) i += 1;
    const rank = start + 1;
    for (let j = start; j < i; j++) {
      result.push({ key: ordered[j]!.key, rank });
    }
  }
  return result;
}

export function rankSeasonStandings(
  rows: Array<{ participantId: string; seasonPoints: number }>,
): Array<{ participantId: string; seasonPoints: number; rank: number }> {
  const sorted = [...rows].sort((a, b) => {
    if (a.seasonPoints !== b.seasonPoints) {
      return b.seasonPoints - a.seasonPoints;
    }
    return a.participantId.localeCompare(b.participantId);
  });
  let group = 0;
  const groups = sorted.map((row, i) => {
    if (i > 0 && sorted[i - 1]!.seasonPoints !== row.seasonPoints) {
      group += 1;
    }
    return { key: row.participantId, sortGroup: group };
  });
  const ranks = assignCompetitionRanks(groups);
  const rankById = new Map(ranks.map((r) => [r.key, r.rank]));
  return sorted.map((row) => ({
    ...row,
    rank: rankById.get(row.participantId) ?? 0,
  }));
}

/** Combined final score usable for Weekly Tiebreaker Prediction. */
export function tiebreakerActualTotal(game: {
  resultAuthority: string;
  homeScore: number | null;
  awayScore: number | null;
  verifiedStatus?: string | null;
}): number | null {
  if (game.resultAuthority !== "verified") return null;
  if (game.verifiedStatus === "CANC") return null;
  if (game.homeScore === null || game.awayScore === null) return null;
  return game.homeScore + game.awayScore;
}

export function confidenceScoringFingerprint(
  parts: ReadonlyArray<string | number | boolean | null | undefined>,
): string {
  return parts.map((p) => (p === undefined ? "" : String(p))).join("|");
}

export function buildConfidenceWeekFingerprint(args: {
  poolId: string;
  week: number;
  picks: Array<{
    participantId: string;
    gameId: string;
    pickedTeamId?: string;
    confidenceValue: number;
    provenance: string;
    locked: boolean;
  }>;
  pickSets: Array<{
    participantId: string;
    tiebreakerPrediction?: number;
  }>;
  verifiedGames: Array<{
    gameId: string;
    homeScore: number;
    awayScore: number;
    status: string;
  }>;
  gameLocks: Array<{ gameId: string; locked: boolean }>;
}): string {
  const picks = [...args.picks]
    .sort((a, b) => {
      const pc = a.participantId.localeCompare(b.participantId);
      if (pc !== 0) return pc;
      return a.gameId.localeCompare(b.gameId);
    })
    .map(
      (p) =>
        `${p.participantId}:${p.gameId}:${p.provenance}:${p.pickedTeamId ?? ""}:${p.confidenceValue}:${p.locked ? "1" : "0"}`,
    )
    .join(",");
  const sets = [...args.pickSets]
    .sort((a, b) => a.participantId.localeCompare(b.participantId))
    .map(
      (s) =>
        `${s.participantId}:${s.tiebreakerPrediction ?? ""}`,
    )
    .join(",");
  const games = [...args.verifiedGames]
    .sort((a, b) => a.gameId.localeCompare(b.gameId))
    .map((g) => `${g.gameId}:${g.homeScore}-${g.awayScore}:${g.status}`)
    .join(",");
  const locks = [...args.gameLocks]
    .sort((a, b) => a.gameId.localeCompare(b.gameId))
    .map((g) => `${g.gameId}:${g.locked ? "1" : "0"}`)
    .join(",");
  return confidenceScoringFingerprint([
    args.poolId,
    args.week,
    picks,
    sets,
    games,
    locks,
  ]);
}
