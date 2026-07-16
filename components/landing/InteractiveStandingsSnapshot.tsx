"use client";

import { useState } from "react";

type StandingsTab = "weekly" | "season";

type StandingRow = {
  initial: string;
  name: string;
  rank: number;
  tone: "heat" | "neutral" | "green" | "blue";
  isViewer?: boolean;
};

type WeeklyStandingRow = StandingRow & {
  correct: number;
  possibleRemaining: number;
  points: number;
};

type SeasonStandingRow = StandingRow & {
  wins: number;
  losses: number;
  points: number;
};

const TABS = [
  { value: "weekly" as const, label: "Weekly Standing" },
  { value: "season" as const, label: "Season Standing" },
];

const WEEKLY_ROWS: readonly WeeklyStandingRow[] = [
  {
    initial: "A",
    name: "Alex",
    rank: 1,
    correct: 6,
    possibleRemaining: 18,
    points: 64,
    tone: "heat",
    isViewer: true,
  },
  {
    initial: "J",
    name: "Jordan",
    rank: 2,
    correct: 5,
    possibleRemaining: 16,
    points: 59,
    tone: "green",
  },
  {
    initial: "S",
    name: "Sam",
    rank: 3,
    correct: 5,
    possibleRemaining: 14,
    points: 55,
    tone: "blue",
  },
  {
    initial: "T",
    name: "Taylor",
    rank: 4,
    correct: 4,
    possibleRemaining: 12,
    points: 51,
    tone: "neutral",
  },
];

const SEASON_ROWS: readonly SeasonStandingRow[] = [
  {
    initial: "J",
    name: "Jordan",
    rank: 1,
    wins: 5,
    losses: 1,
    points: 382,
    tone: "green",
  },
  {
    initial: "A",
    name: "Alex",
    rank: 2,
    wins: 4,
    losses: 2,
    points: 371,
    tone: "heat",
    isViewer: true,
  },
  {
    initial: "T",
    name: "Taylor",
    rank: 3,
    wins: 3,
    losses: 3,
    points: 349,
    tone: "neutral",
  },
  {
    initial: "S",
    name: "Sam",
    rank: 4,
    wins: 2,
    losses: 4,
    points: 341,
    tone: "blue",
  },
];

function SnapshotAvatar({
  initial,
  tone,
}: {
  initial: string;
  tone: StandingRow["tone"];
}) {
  const toneClass = {
    heat: "bg-op-heat-12 text-op-selected-fg",
    neutral: "bg-op-control text-op-secondary",
    green: "bg-[#e4f0ea] text-[#3d5c4a]",
    blue: "bg-[#e4ebf3] text-[#45586b]",
  }[tone];

  return (
    <span
      aria-hidden="true"
      className={`grid h-7 w-7 shrink-0 place-items-center rounded-[8px] text-xs font-medium ${toneClass}`}
    >
      {initial}
    </span>
  );
}

function Player({ row }: { row: StandingRow }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <SnapshotAvatar initial={row.initial} tone={row.tone} />
      <span className="flex min-w-0 items-center text-[13px] font-medium text-op-text">
        <span className="truncate">
          {row.rank}. {row.name}
        </span>
        {row.isViewer ? (
          <span className="ml-1 shrink-0 rounded-[6px] bg-op-heat-8 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-op-selected-fg">
            you
          </span>
        ) : null}
      </span>
    </div>
  );
}

export function InteractiveStandingsSnapshot() {
  const [tab, setTab] = useState<StandingsTab>("weekly");

  return (
    <figure
      aria-label="Interactive Confidence standings preview for the Sunday Crew pool"
      className="op-marketing-snapshot overflow-hidden rounded-[16px] border border-op-border bg-op-canvas shadow-[0_24px_64px_-46px_rgba(38,38,38,0.3)]"
    >
      <div className="flex flex-col gap-5 p-4 sm:p-6">
        <header>
          <h3 className="text-2xl font-medium tracking-tight text-op-text">
            Standings
          </h3>
          <p className="mt-1 text-sm text-op-secondary">
            Confidence · Week 7
          </p>
        </header>

        <div
          role="tablist"
          aria-label="Standings preview"
          className="inline-flex h-9 w-full items-center rounded-[8px] border border-op-border bg-op-control p-0.5"
        >
          {TABS.map((option) => {
            const selected = tab === option.value;

            return (
              <button
                key={option.value}
                id={`landing-${option.value}-standings-tab`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`landing-${option.value}-standings-panel`}
                onClick={() => setTab(option.value)}
                className={[
                  "flex h-8 flex-1 items-center justify-center rounded-[6px] px-2.5 text-[13px] font-medium transition-[background-color,color,box-shadow] duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-op-heat",
                  selected
                    ? "bg-op-surface text-op-text shadow-[0_1px_2px_rgba(0,0,0,0.04)] ring-1 ring-op-border"
                    : "text-op-secondary hover:text-op-text",
                ].join(" ")}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        <div
          id="landing-weekly-standings-panel"
          role="tabpanel"
          aria-labelledby="landing-weekly-standings-tab"
          hidden={tab !== "weekly"}
          className="flex flex-col gap-5"
        >
          <p className="rounded-md border border-op-banner-border bg-op-banner-bg px-3 py-2 text-xs text-op-banner-fg">
            Projected Standing. Live scores are provisional until results are
            verified.
          </p>
          <div className="overflow-hidden rounded-[16px] border border-op-border bg-op-surface">
            <div className="flex items-center justify-between gap-4 bg-op-control px-4 py-2">
              <span className="op-eyebrow">Player</span>
              <span className="op-eyebrow">Points</span>
            </div>
            <ul className="divide-y divide-op-border">
              {WEEKLY_ROWS.map((row) => (
                <li
                  key={row.name}
                  className={`flex items-center justify-between gap-4 px-4 py-3 ${row.isViewer ? "bg-op-selected" : ""}`}
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <Player row={row} />
                    <span className="pl-10 text-xs text-op-muted">
                      {row.correct} correct · {row.possibleRemaining} possible
                      remaining
                    </span>
                  </div>
                  <span className="shrink-0 text-[13px] font-medium tabular-nums text-op-text">
                    {row.points} pts
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div
          id="landing-season-standings-panel"
          role="tabpanel"
          aria-labelledby="landing-season-standings-tab"
          hidden={tab !== "season"}
        >
          <div className="overflow-hidden rounded-[16px] border border-op-border bg-op-surface">
            <div className="grid grid-cols-[minmax(0,1fr)_2.25rem_2.25rem_4.25rem] items-center gap-2 bg-op-control px-4 py-2">
              <span className="op-eyebrow">Player</span>
              <span className="op-eyebrow text-right">W</span>
              <span className="op-eyebrow text-right">L</span>
              <span className="op-eyebrow text-right">Points</span>
            </div>
            <ul className="divide-y divide-op-border">
              {SEASON_ROWS.map((row) => (
                <li
                  key={row.name}
                  className={`grid grid-cols-[minmax(0,1fr)_2.25rem_2.25rem_4.25rem] items-center gap-2 px-4 py-3 ${row.isViewer ? "bg-op-selected" : ""}`}
                >
                  <Player row={row} />
                  <span className="text-right text-[13px] tabular-nums text-op-text">
                    {row.wins}
                  </span>
                  <span className="text-right text-[13px] tabular-nums text-op-text">
                    {row.losses}
                  </span>
                  <span className="text-right text-[13px] font-medium tabular-nums text-op-text">
                    {row.points} pts
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </figure>
  );
}
