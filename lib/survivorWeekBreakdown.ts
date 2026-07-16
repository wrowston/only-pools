export type SurvivorBreakdownOutcome =
  | "win"
  | "loss"
  | "tie"
  | "missing_pick"
  | "pending"
  | "invalidated"
  | "no_contest_advance"
  | null;

export type SurvivorBreakdownCell = {
  week: number;
  locked: boolean;
  teamAbbreviation: string | null;
  teamName: string | null;
  teamLogoUrl: string | null;
  provenance: "authored" | "omission" | null;
  outcome: SurvivorBreakdownOutcome;
};

export type SurvivorBreakdownRow = {
  eliminatedWeek: number | null;
  cells: SurvivorBreakdownCell[];
};

export type SurvivorTeamBreakdown = {
  abbreviation: string;
  name: string;
  logoUrl: string | null;
  picks: number;
  percentage: number;
  outcome: "survived" | "eliminated" | "pending";
};

export type SurvivorWeekBreakdown = {
  week: number;
  eligibleEntries: number;
  lockedEntries: number;
  survived: number;
  survivedPercentage: number;
  eliminated: number;
  eliminatedPercentage: number;
  missed: number;
  missedPercentage: number;
  pending: number;
  teams: SurvivorTeamBreakdown[];
};

function percentage(count: number, total: number, precision = 0): number {
  if (total === 0) return 0;
  const factor = 10 ** precision;
  return Math.round((count / total) * 100 * factor) / factor;
}

function teamOutcome(
  outcomes: SurvivorBreakdownOutcome[],
): SurvivorTeamBreakdown["outcome"] {
  if (outcomes.some((outcome) => outcome === "loss" || outcome === "tie")) {
    return "eliminated";
  }
  if (
    outcomes.length > 0 &&
    outcomes.every(
      (outcome) => outcome === "win" || outcome === "no_contest_advance",
    )
  ) {
    return "survived";
  }
  return "pending";
}

/**
 * Builds the selected-week pulse from the same privacy-filtered cells used by
 * the standings grid. Only locked authored picks enter the team distribution.
 */
export function buildSurvivorWeekBreakdown(
  rows: readonly SurvivorBreakdownRow[],
  week: number,
): SurvivorWeekBreakdown {
  const eligibleRows = rows.filter(
    (row) => row.eliminatedWeek === null || row.eliminatedWeek >= week,
  );
  const cells = eligibleRows
    .map((row) => row.cells.find((cell) => cell.week === week))
    .filter((cell): cell is SurvivorBreakdownCell => cell !== undefined);

  const survived = cells.filter(
    (cell) =>
      cell.outcome === "win" || cell.outcome === "no_contest_advance",
  ).length;
  const eliminated = cells.filter(
    (cell) =>
      cell.outcome === "loss" ||
      cell.outcome === "tie" ||
      cell.outcome === "missing_pick",
  ).length;
  const missed = cells.filter(
    (cell) => cell.outcome === "missing_pick",
  ).length;
  const pending = cells.filter(
    (cell) =>
      cell.locked && (cell.outcome === null || cell.outcome === "pending"),
  ).length;

  const teamPicks = new Map<
    string,
    {
      abbreviation: string;
      name: string;
      logoUrl: string | null;
      outcomes: SurvivorBreakdownOutcome[];
    }
  >();
  for (const cell of cells) {
    if (
      !cell.locked ||
      cell.provenance !== "authored" ||
      !cell.teamAbbreviation
    ) {
      continue;
    }
    const current = teamPicks.get(cell.teamAbbreviation) ?? {
      abbreviation: cell.teamAbbreviation,
      name: cell.teamName ?? cell.teamAbbreviation,
      logoUrl: cell.teamLogoUrl,
      outcomes: [],
    };
    current.outcomes.push(cell.outcome);
    teamPicks.set(cell.teamAbbreviation, current);
  }

  const eligibleEntries = eligibleRows.length;
  const teams = [...teamPicks.values()]
    .map((team) => ({
      abbreviation: team.abbreviation,
      name: team.name,
      logoUrl: team.logoUrl,
      picks: team.outcomes.length,
      percentage: percentage(team.outcomes.length, eligibleEntries, 1),
      outcome: teamOutcome(team.outcomes),
    }))
    .sort(
      (a, b) =>
        b.picks - a.picks || a.name.localeCompare(b.name),
    );

  return {
    week,
    eligibleEntries,
    lockedEntries: cells.filter((cell) => cell.locked).length,
    survived,
    survivedPercentage: percentage(survived, eligibleEntries),
    eliminated,
    eliminatedPercentage: percentage(eliminated, eligibleEntries),
    missed,
    missedPercentage: percentage(missed, eligibleEntries),
    pending,
    teams,
  };
}
