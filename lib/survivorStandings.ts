type StandingsWeekCell = {
  week: number;
  hasPick: boolean;
  locked: boolean;
};

type StandingsWeekRow = {
  cells: readonly StandingsWeekCell[];
};

export function currentSurvivorStandingsWeek(args: {
  weeks: readonly number[];
  rows: readonly StandingsWeekRow[];
  startWeek: number;
}): number {
  for (const week of args.weeks) {
    const hasOpenPick = args.rows.some((row) =>
      row.cells.some(
        (cell) => cell.week === week && cell.hasPick && !cell.locked,
      ),
    );
    if (hasOpenPick) return week;
  }

  for (let index = args.weeks.length - 1; index >= 0; index--) {
    const week = args.weeks[index]!;
    const hasLockedPick = args.rows.some((row) =>
      row.cells.some((cell) => cell.week === week && cell.locked),
    );
    if (hasLockedPick) return week;
  }

  return args.startWeek;
}
