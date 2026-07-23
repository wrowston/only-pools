import { TeamLogo } from "../TeamLogo";

export type StandingsPickCell = {
  week: number;
  revealed: boolean;
  hasPick: boolean;
  locked: boolean;
  teamAbbreviation: string | null;
  teamName: string | null;
  teamLogoUrl: string | null;
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

/** Text/tint only — no bordered cards in the pick grid. */
const TONE_CLASS: Record<CellVisual["tone"], string> = {
  empty: "text-op-muted",
  hidden: "text-op-muted",
  won: "text-op-won-fg",
  lost: "text-op-lost-fg",
  pending: "text-op-text",
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
 * Compact pick marker — logo + abbr, outcome via text color only.
 */
export function PickCell({ cell }: { cell: StandingsPickCell }) {
  const visual = cellVisual(cell);
  const showTeamLogo = Boolean(
    cell.revealed && cell.teamAbbreviation && cell.teamLogoUrl,
  );
  return (
    <span
      className={[
        "inline-flex h-10 w-10 shrink-0 flex-col items-center justify-center gap-0.5 text-[9px] font-semibold leading-none tabular-nums",
        "min-[900px]:h-12 min-[900px]:w-auto min-[900px]:min-w-0 min-[900px]:flex-row min-[900px]:gap-1.5 min-[900px]:text-xs",
        TONE_CLASS[visual.tone],
      ].join(" ")}
      title={visual.aria}
      aria-label={`Week ${cell.week}: ${visual.aria}`}
    >
      {showTeamLogo && cell.teamAbbreviation ? (
        <>
          <TeamLogo
            logoUrl={cell.teamLogoUrl}
            abbreviation={cell.teamAbbreviation}
            size="xs"
          />
          <span>{visual.label}</span>
        </>
      ) : (
        visual.label
      )}
    </span>
  );
}
