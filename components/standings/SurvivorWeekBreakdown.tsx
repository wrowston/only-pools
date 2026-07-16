import {
  buildSurvivorWeekBreakdown,
  type SurvivorTeamBreakdown,
} from "@/lib/survivorWeekBreakdown";
import { uiType } from "@/lib/uiType";
import type { SurvivorPickGridRow } from "./SurvivorPickGrid";

const STAT_TONES = {
  survived: {
    card: "border-op-won-border bg-op-won-bg",
    label: "text-op-won-fg",
    dot: "bg-op-mint",
  },
  eliminated: {
    card: "border-op-lost-border bg-op-lost-bg",
    label: "text-op-lost-fg",
    dot: "bg-op-lost-fg",
  },
  missed: {
    card: "border-op-banner-border bg-op-banner-bg",
    label: "text-op-banner-fg",
    dot: "bg-op-heat",
  },
} as const;

const TEAM_TONES: Record<
  SurvivorTeamBreakdown["outcome"],
  { text: string; tile: string; bar: string; label: string }
> = {
  survived: {
    text: "text-op-won-fg",
    tile: "border-op-won-border bg-op-won-bg text-op-won-fg",
    bar: "bg-op-mint",
    label: "Advanced",
  },
  eliminated: {
    text: "text-op-lost-fg",
    tile: "border-op-lost-border bg-op-lost-bg text-op-lost-fg",
    bar: "bg-op-lost-fg",
    label: "Eliminated",
  },
  pending: {
    text: "text-op-text",
    tile: "border-op-border-strong bg-op-control text-op-text",
    bar: "bg-op-heat",
    label: "Pending",
  },
};

function percentLabel(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

function WeekStat({
  label,
  value,
  percentage,
  tone,
}: {
  label: string;
  value: number;
  percentage: number;
  tone: keyof typeof STAT_TONES;
}) {
  const styles = STAT_TONES[tone];
  return (
    <div className={`rounded-[10px] border px-3 py-2.5 ${styles.card}`}>
      <div className="flex items-center justify-between gap-2">
        <p className={`flex min-w-0 items-center gap-1.5 text-xs font-medium ${styles.label}`}>
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${styles.dot}`} aria-hidden />
          <span className="truncate">{label}</span>
        </p>
        <span className="shrink-0 text-sm font-medium tabular-nums text-op-text">
          {percentLabel(percentage)}
        </span>
      </div>
      <p className="mt-1.5 flex items-baseline gap-1.5">
        <span className="text-xl font-medium tabular-nums text-op-text">{value}</span>
        <span className="text-[11px] text-op-muted">entries</span>
      </p>
    </div>
  );
}

function TeamRow({ team }: { team: SurvivorTeamBreakdown }) {
  const tone = TEAM_TONES[team.outcome];
  return (
    <li className="relative grid grid-cols-[minmax(0,1fr)_4.25rem_2.75rem] items-center gap-3 px-4 py-3.5 min-[900px]:grid-cols-[minmax(0,1fr)_6rem_3.5rem] min-[900px]:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={`inline-flex h-9 min-w-10 shrink-0 items-center justify-center rounded-lg border px-1.5 text-[11px] font-semibold tracking-[0.04em] ${tone.tile}`}
          aria-hidden
        >
          {team.abbreviation}
        </span>
        <div className="min-w-0">
          <p className={`truncate text-[13px] font-medium min-[900px]:text-sm ${tone.text}`}>
            {team.name}
          </p>
          <p className={uiType.meta}>{tone.label}</p>
        </div>
      </div>
      <span className="text-right text-sm font-medium tabular-nums text-op-text">
        {percentLabel(team.percentage)}
      </span>
      <span className="text-right text-sm tabular-nums text-op-secondary">
        {team.picks}
      </span>
      <span
        className="absolute bottom-0 left-4 right-4 h-px overflow-hidden rounded-full bg-op-control min-[900px]:left-5 min-[900px]:right-5"
        aria-hidden
      >
        <span
          className={`block h-full rounded-full ${tone.bar}`}
          style={{ width: `${team.percentage}%` }}
        />
      </span>
    </li>
  );
}

/** Selected-week outcome and pick-share panel, modeled on Splash Sports stats. */
export function SurvivorWeekBreakdown({
  week,
  rows,
}: {
  week: number;
  rows: SurvivorPickGridRow[];
}) {
  const breakdown = buildSurvivorWeekBreakdown(rows, week);
  const status =
    breakdown.lockedEntries === 0
      ? "Pick stats appear after entries lock."
      : breakdown.pending > 0
        ? `${breakdown.lockedEntries} locked · ${breakdown.pending} awaiting a result`
        : `${breakdown.eligibleEntries} entries · Results final`;

  return (
    <section
      className="overflow-hidden rounded-[16px] border border-op-border bg-op-surface"
      aria-labelledby={`week-${week}-breakdown`}
    >
      <div className="flex flex-col gap-1 border-b border-op-border px-4 py-4 min-[900px]:flex-row min-[900px]:items-end min-[900px]:justify-between min-[900px]:px-5">
        <div>
          <p className={uiType.eyebrow}>Weekly pulse</p>
          <h2
            id={`week-${week}-breakdown`}
            className="mt-1 text-lg font-medium tracking-tight text-op-text"
          >
            Week {week} breakdown
          </h2>
        </div>
        <p className="text-xs text-op-muted" aria-live="polite">
          {status}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-2 border-b border-op-border bg-op-canvas-lighter p-2.5 min-[560px]:grid-cols-3 min-[900px]:p-3">
        <WeekStat
          label="Survived"
          value={breakdown.survived}
          percentage={breakdown.survivedPercentage}
          tone="survived"
        />
        <WeekStat
          label="Eliminated"
          value={breakdown.eliminated}
          percentage={breakdown.eliminatedPercentage}
          tone="eliminated"
        />
        <WeekStat
          label="Missed"
          value={breakdown.missed}
          percentage={breakdown.missedPercentage}
          tone="missed"
        />
      </div>

      <div className="flex items-center justify-between gap-4 border-b border-op-border bg-op-control px-4 py-2.5 min-[900px]:px-5">
        <div>
          <p className={uiType.eyebrow}>Pick distribution</p>
          <p className="mt-0.5 text-[11px] text-op-muted">Locked entries only</p>
        </div>
        <div className={`grid grid-cols-[4.25rem_2.75rem] gap-3 text-right min-[900px]:grid-cols-[6rem_3.5rem] ${uiType.eyebrow}`}>
          <span>Picked</span>
          <span>Picks</span>
        </div>
      </div>

      {breakdown.teams.length > 0 ? (
        <ul className="divide-y divide-op-border" aria-label={`Week ${week} team pick distribution`}>
          {breakdown.teams.map((team) => (
            <TeamRow key={team.abbreviation} team={team} />
          ))}
        </ul>
      ) : (
        <div className="px-4 py-8 text-center min-[900px]:px-5">
          <p className="text-sm font-medium text-op-text">No locked picks to show yet</p>
          <p className="mt-1 text-xs text-op-muted">
            Team shares stay private until the week locks.
          </p>
        </div>
      )}
    </section>
  );
}
