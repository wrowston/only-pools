export type StandingsPickCell = {
  week: number;
  revealed: boolean;
  hasPick: boolean;
  locked: boolean;
  teamAbbreviation: string | null;
  teamName: string | null;
  provenance: "authored" | "omission" | null;
  outcome:
    | "win"
    | "loss"
    | "tie"
    | "missing_pick"
    | "pending"
    | "invalidated"
    | "no_contest_advance"
    | null;
};

type CellVisual =
  | { tone: "empty"; label: string; aria: string }
  | { tone: "hidden"; label: string; aria: string }
  | { tone: "won"; label: string; aria: string }
  | { tone: "lost"; label: string; aria: string }
  | { tone: "pending"; label: string; aria: string };

const TONE_CLASS: Record<CellVisual["tone"], string> = {
  empty: "border-op-border bg-op-surface text-op-muted",
  hidden: "border-op-border-strong bg-op-control text-op-muted",
  won: "border-op-won-border bg-op-won-bg text-op-won-fg",
  lost: "border-op-lost-border bg-op-lost-bg text-op-lost-fg",
  pending: "border-op-border-strong bg-op-surface text-op-text",
};

function cellVisual(cell: StandingsPickCell): CellVisual {
  if (!cell.revealed) {
    if (cell.hasPick) {
      return {
        tone: "hidden",
        label: "···",
        aria: "Pick saved, hidden until lock",
      };
    }
    return { tone: "empty", label: "", aria: "No pick" };
  }

  if (cell.provenance === "omission" || cell.outcome === "missing_pick") {
    return { tone: "lost", label: "—", aria: "No pick · eliminated" };
  }

  if (cell.outcome === "invalidated") {
    return { tone: "empty", label: "", aria: "Pick invalidated" };
  }

  const abbr = cell.teamAbbreviation ?? (cell.hasPick ? "?" : "");
  if (!abbr) {
    return { tone: "empty", label: "", aria: `Week ${cell.week}, no pick` };
  }

  if (cell.outcome === "win" || cell.outcome === "no_contest_advance") {
    return { tone: "won", label: abbr, aria: `${abbr}, pick won` };
  }
  if (cell.outcome === "loss" || cell.outcome === "tie") {
    return { tone: "lost", label: abbr, aria: `${abbr}, pick lost` };
  }

  return {
    tone: "pending",
    label: abbr,
    aria: cell.locked
      ? `${abbr}, locked, result pending`
      : `${abbr}, your pick`,
  };
}

/**
 * Splashsports-style pick square — pastel won/lost, text always present when relevant.
 * Compact on mobile; larger on desktop so the standings grid fills the page.
 */
export function PickCell({ cell }: { cell: StandingsPickCell }) {
  const visual = cellVisual(cell);
  return (
    <span
      className={[
        "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border text-[11px] font-semibold tabular-nums",
        "min-[900px]:h-12 min-[900px]:min-w-14 min-[900px]:w-auto min-[900px]:px-2 min-[900px]:text-xs min-[900px]:rounded-lg",
        TONE_CLASS[visual.tone],
      ].join(" ")}
      title={visual.aria}
      aria-label={`Week ${cell.week}: ${visual.aria}`}
    >
      {visual.label}
    </span>
  );
}
