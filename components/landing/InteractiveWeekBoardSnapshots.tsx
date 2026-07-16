"use client";

import { useState } from "react";
import { BrandMark } from "../BrandMark";
import { TeamLogo } from "../TeamLogo";

type MarketingTeam = {
  abbreviation: string;
  name: string;
  logoUrl: string;
};

const teams = {
  den: {
    abbreviation: "DEN",
    name: "Denver Broncos",
    logoUrl:
      "https://r2.thesportsdb.com/images/media/team/badge/upsspx1421635647.png",
  },
  no: {
    abbreviation: "NO",
    name: "New Orleans Saints",
    logoUrl:
      "https://r2.thesportsdb.com/images/media/team/badge/nd46c71537821337.png",
  },
  buf: {
    abbreviation: "BUF",
    name: "Buffalo Bills",
    logoUrl:
      "https://r2.thesportsdb.com/images/media/team/badge/6pb37b1515849026.png",
  },
  kc: {
    abbreviation: "KC",
    name: "Kansas City Chiefs",
    logoUrl:
      "https://r2.thesportsdb.com/images/media/team/badge/936t161515847222.png",
  },
  det: {
    abbreviation: "DET",
    name: "Detroit Lions",
    logoUrl:
      "https://r2.thesportsdb.com/images/media/team/badge/lgsgkr1546168257.png",
  },
  min: {
    abbreviation: "MIN",
    name: "Minnesota Vikings",
    logoUrl:
      "https://r2.thesportsdb.com/images/media/team/badge/qstqqr1421609163.png",
  },
} satisfies Record<string, MarketingTeam>;

type TeamKey = keyof typeof teams;

const PREVIEW_WEEKS = [5, 6, 7, 8] as const;
type PreviewWeek = (typeof PREVIEW_WEEKS)[number];

type PreviewGame = {
  id: string;
  away: TeamKey;
  home: TeamKey;
  kickoff: string;
  confidenceLocked?: boolean;
  hideOnPhone?: boolean;
};

const WEEK_GAMES = {
  5: [
    { id: "w5-buf-kc", away: "buf", home: "kc", kickoff: "Thu, Oct 3 · 6:15 PM" },
    { id: "w5-no-den", away: "no", home: "den", kickoff: "Sun, Oct 6 · 11:00 AM" },
    { id: "w5-min-det", away: "min", home: "det", kickoff: "Sun, Oct 6 · 2:25 PM", hideOnPhone: true },
  ],
  6: [
    { id: "w6-den-kc", away: "den", home: "kc", kickoff: "Thu, Oct 10 · 6:15 PM" },
    { id: "w6-buf-no", away: "buf", home: "no", kickoff: "Sun, Oct 13 · 11:00 AM" },
    { id: "w6-min-det", away: "min", home: "det", kickoff: "Sun, Oct 13 · 2:25 PM", hideOnPhone: true },
  ],
  7: [
    { id: "w7-den-no", away: "den", home: "no", kickoff: "Thu, Oct 17 · 6:15 PM", confidenceLocked: true },
    { id: "w7-buf-kc", away: "buf", home: "kc", kickoff: "Sun, Oct 20 · 11:00 AM" },
    { id: "w7-det-min", away: "det", home: "min", kickoff: "Sun, Oct 20 · 11:00 AM", hideOnPhone: true },
  ],
  8: [
    { id: "w8-kc-den", away: "kc", home: "den", kickoff: "Thu, Oct 24 · 6:15 PM" },
    { id: "w8-min-buf", away: "min", home: "buf", kickoff: "Sun, Oct 27 · 11:00 AM" },
    { id: "w8-no-det", away: "no", home: "det", kickoff: "Sun, Oct 27 · 2:25 PM", hideOnPhone: true },
  ],
} satisfies Record<PreviewWeek, readonly PreviewGame[]>;

type WeeklySelections = Record<PreviewWeek, Record<string, string>>;
type WeeklyConfidenceValues = Record<PreviewWeek, Record<string, number>>;

const INITIAL_SURVIVOR_PICKS: Record<PreviewWeek, string | null> = {
  5: "BUF",
  6: "DEN",
  7: "DEN",
  8: null,
};

const INITIAL_CONFIDENCE_PICKS: WeeklySelections = {
  5: { "w5-buf-kc": "BUF", "w5-no-den": "DEN", "w5-min-det": "MIN" },
  6: { "w6-den-kc": "KC", "w6-buf-no": "BUF", "w6-min-det": "DET" },
  7: { "w7-den-no": "DEN", "w7-buf-kc": "BUF", "w7-det-min": "DET" },
  8: {},
};

const INITIAL_CONFIDENCE_VALUES: WeeklyConfidenceValues = {
  5: { "w5-buf-kc": 16, "w5-no-den": 15, "w5-min-det": 14 },
  6: { "w6-den-kc": 16, "w6-buf-no": 15, "w6-min-det": 14 },
  7: { "w7-den-no": 16, "w7-buf-kc": 15, "w7-det-min": 14 },
  8: { "w8-kc-den": 16, "w8-min-buf": 15, "w8-no-det": 14 },
};

function StaticAvatar({
  initial,
  tone = "neutral",
}: {
  initial: string;
  tone?: "heat" | "neutral" | "green" | "blue";
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

function PreviewWeekTabs({
  value,
  onChange,
  idPrefix,
  ariaLabel,
}: {
  value: PreviewWeek;
  onChange: (week: PreviewWeek) => void;
  idPrefix: string;
  ariaLabel: string;
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="flex gap-1.5 overflow-x-auto pb-0.5">
      {PREVIEW_WEEKS.map((week) => {
        const selected = value === week;

        return (
          <button
            key={week}
            id={`${idPrefix}-week-${week}-tab`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`${idPrefix}-week-${week}-panel`}
            onClick={() => onChange(week)}
            className={[
              "relative inline-flex h-8 shrink-0 items-center justify-center rounded-[8px] border px-2.5 text-[13px] font-medium transition-[background-color,border-color,color] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-op-heat",
              selected
                ? "border-op-heat bg-op-heat-8 text-op-selected-fg"
                : "border-transparent bg-op-control text-op-text hover:border-op-border-strong",
            ].join(" ")}
          >
            Week {week}
          </button>
        );
      })}
    </div>
  );
}

function TeamPick({
  team,
  selected,
  locked,
  onPick,
}: {
  team: MarketingTeam;
  selected: boolean;
  locked?: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Pick ${team.name}`}
      aria-pressed={selected}
      disabled={locked}
      onClick={onPick}
      className={[
        "flex h-12 items-center justify-center gap-2 rounded-[8px] border px-3 text-sm font-medium tracking-wide transition-[background-color,border-color,color,transform] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-op-heat",
        selected
          ? "border-op-selected-fg bg-op-selected text-op-selected-fg"
          : "border-op-border bg-op-surface text-op-text",
        locked
          ? "cursor-not-allowed opacity-50"
          : "hover:border-op-selected-fg active:scale-[0.985]",
      ].join(" ")}
    >
      <TeamLogo
        logoUrl={team.logoUrl}
        abbreviation={team.abbreviation}
        size="sm"
      />
      <span>{team.abbreviation}</span>
    </button>
  );
}

function SurvivorGame({
  game,
  selected,
  locked,
  onPick,
}: {
  game: PreviewGame;
  selected: string | null;
  locked: boolean;
  onPick: (team: MarketingTeam) => void;
}) {
  const away = teams[game.away];
  const home = teams[game.home];

  return (
    <li
      className={[
        "flex flex-col gap-2 px-4 py-2.5 min-[900px]:px-5",
        game.hideOnPhone ? "hidden sm:flex" : "",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 text-[13px] font-medium text-op-text">
          {away.abbreviation} @ {home.abbreviation}
          <span className="mt-0.5 block truncate text-[11px] font-normal text-op-muted">
            {away.name} at {home.name}
          </span>
        </div>
        <span className="shrink-0 text-right text-[11px] text-op-muted">
          {game.kickoff}
          {locked ? <span className="mt-0.5 block">Pick Lock reached</span> : null}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <TeamPick
          team={away}
          selected={selected === away.abbreviation}
          locked={locked}
          onPick={() => onPick(away)}
        />
        <TeamPick
          team={home}
          selected={selected === home.abbreviation}
          locked={locked}
          onPick={() => onPick(home)}
        />
      </div>
    </li>
  );
}

export function InteractiveSurvivorSnapshot() {
  const [week, setWeek] = useState<PreviewWeek>(7);
  const [picks, setPicks] = useState(INITIAL_SURVIVOR_PICKS);
  const games: readonly PreviewGame[] = WEEK_GAMES[week];
  const selected = picks[week];
  const weekLocked = week < 7;

  return (
    <figure
      aria-label="Interactive Survivor Week Board preview"
      className="op-marketing-snapshot overflow-hidden rounded-[16px] border border-op-border bg-op-canvas shadow-[0_28px_72px_-48px_rgba(38,38,38,0.32)]"
    >
      <div className="grid min-[860px]:grid-cols-[170px_minmax(0,1fr)] min-[1060px]:grid-cols-[170px_minmax(0,1fr)_180px]">
        <aside className="hidden min-[860px]:flex min-h-[560px] flex-col border-r border-op-border bg-op-canvas">
          <div className="border-b border-op-border px-3 pb-3 pt-4">
            <div className="flex h-9 items-center gap-2 px-2 text-[14px] font-medium text-op-text">
              <BrandMark />
              Only Pools
            </div>
            <div className="mt-1 rounded-[8px] bg-op-control px-2.5 py-2 text-[12px] font-medium text-op-text">
              Sunday Crew
              <span className="mt-0.5 block text-[10px] font-normal text-op-muted">
                Survivor · 2025
              </span>
            </div>
          </div>
          <div className="flex flex-col gap-0.5 px-2 pt-3">
            <p className="op-eyebrow px-2.5 pb-1.5">Play</p>
            <span className="flex h-8 items-center rounded-[8px] bg-op-selected px-2.5 text-[12px] font-medium text-op-selected-fg">
              Week Board
            </span>
            <span className="flex h-8 items-center rounded-[8px] px-2.5 text-[12px] font-medium text-op-secondary">
              Standings
            </span>
            <span className="flex h-8 items-center rounded-[8px] px-2.5 text-[12px] font-medium text-op-secondary">
              Pool
            </span>
          </div>
          <span className="mt-auto border-t border-op-border px-4 py-4 text-[11px] text-op-muted">
            My Pools
          </span>
        </aside>

        <div className="min-w-0 bg-op-canvas">
          <div className="border-b border-op-border bg-op-surface px-4 py-3 min-[860px]:hidden">
            <p className="text-[13px] font-medium text-op-text">Sunday Crew</p>
            <div className="mt-2 flex gap-1.5" aria-hidden="true">
              {["Week Board", "Standings", "Pool"].map((label, index) => (
                <span
                  key={label}
                  className={[
                    "rounded-[8px] px-2.5 py-1.5 text-[11px] font-medium",
                    index === 0
                      ? "bg-op-selected text-op-selected-fg"
                      : "bg-op-control text-op-secondary",
                  ].join(" ")}
                >
                  {label}
                </span>
              ))}
            </div>
          </div>
          <div className="mx-auto flex max-w-3xl flex-col gap-5 p-4 sm:p-6">
            <header className="flex flex-col gap-3">
              <div>
                <h3 className="text-2xl font-medium tracking-tight text-op-text">
                  Week Board
                </h3>
                <p className="mt-1 text-sm text-op-secondary">
                  Week {week} · Survivor · Season 2025
                </p>
              </div>
              <PreviewWeekTabs
                value={week}
                onChange={setWeek}
                idPrefix="survivor"
                ariaLabel="Select Survivor week"
              />
            </header>
            <div
              id={`survivor-week-${week}-panel`}
              role="tabpanel"
              aria-labelledby={`survivor-week-${week}-tab`}
              className="flex flex-col gap-5"
            >
              <div className="flex flex-col gap-1">
                <p className="text-sm leading-5 text-op-secondary">
                  Tap a team to autosave your Survivor Pick. Hidden from others
                  until Pick Lock.
                </p>
                <p className="text-sm text-op-secondary" aria-live="polite">
                  {weekLocked
                    ? "Pick locked"
                    : selected
                      ? "Saved"
                      : "Choose a team"}
                </p>
              </div>
              <section className="flex flex-col gap-2">
                <p className="op-eyebrow">Slate</p>
                <ul className="divide-y divide-op-border overflow-hidden rounded-[16px] border border-op-border bg-op-surface">
                  {games.map((game) => (
                    <SurvivorGame
                      key={game.id}
                      game={game}
                      selected={selected}
                      locked={weekLocked}
                      onPick={(team) =>
                        setPicks((current) => ({
                          ...current,
                          [week]: team.abbreviation,
                        }))
                      }
                    />
                  ))}
                </ul>
              </section>
            </div>
          </div>
        </div>

        <aside className="hidden min-[1060px]:flex flex-col gap-4 border-l border-op-border bg-op-canvas p-5">
          <p className="op-eyebrow">Alive</p>
          <div>
            <span className="block text-xl font-medium tabular-nums text-op-text">
              8
            </span>
            <span className="text-xs text-op-muted">still Alive</span>
          </div>
          <ul className="flex flex-col gap-2.5">
            {[
              ["A", "Alex", "heat"],
              ["J", "Jordan", "green"],
              ["S", "Sam", "blue"],
            ].map(([initial, name, tone]) => (
              <li key={name} className="flex min-w-0 items-center gap-2">
                <StaticAvatar
                  initial={initial}
                  tone={tone as "heat" | "green" | "blue"}
                />
                <span className="truncate text-[13px] font-medium text-op-text">
                  {name}
                </span>
                {name === "Alex" ? (
                  <span className="ml-auto rounded-[6px] bg-op-heat-8 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-op-selected-fg">
                    you
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          <span className="mt-1 text-[12px] font-medium text-op-secondary underline underline-offset-2">
            Full standings →
          </span>
        </aside>
      </div>
    </figure>
  );
}

function ConfidenceGame({
  game,
  selected,
  confidence,
  locked,
  onPick,
  onConfidenceChange,
}: {
  game: PreviewGame;
  selected?: string;
  confidence: number;
  locked: boolean;
  onPick: (team: MarketingTeam) => void;
  onConfidenceChange: (value: number) => void;
}) {
  const away = teams[game.away];
  const home = teams[game.home];

  return (
    <li className="flex flex-col gap-2 px-4 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 text-[13px] font-medium text-op-text">
          {away.abbreviation} @ {home.abbreviation}
          <span className="mt-0.5 block truncate text-[11px] font-normal text-op-muted">
            {away.name} at {home.name}
          </span>
        </div>
        <span className="shrink-0 text-right text-[11px] text-op-muted">
          {game.kickoff}
          {locked ? (
            <span className="mt-0.5 block">Pick Lock reached · authored</span>
          ) : null}
        </span>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-2">
          <TeamPick
            team={away}
            selected={selected === away.abbreviation}
            locked={locked}
            onPick={() => onPick(away)}
          />
          <TeamPick
            team={home}
            selected={selected === home.abbreviation}
            locked={locked}
            onPick={() => onPick(home)}
          />
        </div>
        <label className="flex shrink-0 items-center gap-2 text-sm text-op-text">
          <span className="text-[11px] font-medium uppercase tracking-wide text-op-muted">
            Conf
          </span>
          <span className="relative">
            <select
              aria-label={`Confidence for ${away.name} at ${home.name}`}
              value={confidence}
              disabled={locked}
              onChange={(event) => onConfidenceChange(Number(event.target.value))}
              className="h-12 w-[58px] appearance-none rounded-[8px] border border-op-border bg-op-surface px-3 pr-6 text-sm font-medium text-op-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-op-heat disabled:cursor-not-allowed disabled:opacity-50"
            >
              {Array.from({ length: 16 }, (_, index) => 16 - index).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            <svg
              aria-hidden="true"
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-op-muted"
            >
              <path
                d="M3 4.5 6 7.5 9 4.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </label>
      </div>
    </li>
  );
}

export function InteractiveConfidenceSnapshot() {
  const [week, setWeek] = useState<PreviewWeek>(7);
  const [picks, setPicks] = useState<WeeklySelections>(INITIAL_CONFIDENCE_PICKS);
  const [confidenceValues, setConfidenceValues] =
    useState<WeeklyConfidenceValues>(INITIAL_CONFIDENCE_VALUES);
  const games: readonly PreviewGame[] = WEEK_GAMES[week];
  const pickedCount = games.filter((game) => picks[week][game.id]).length;
  const weekLocked = week < 7;
  const saveStatus = weekLocked
    ? "Picks locked"
    : pickedCount === games.length
      ? "Saved"
      : `${pickedCount} of ${games.length} picks saved`;

  function updateConfidence(gameId: string, nextValue: number) {
    setConfidenceValues((current) => {
      const weekValues = { ...current[week] };
      const currentValue = weekValues[gameId];
      const duplicate = Object.entries(weekValues).find(
        ([otherGameId, value]) => otherGameId !== gameId && value === nextValue,
      );

      if (duplicate) {
        weekValues[duplicate[0]] = currentValue;
      }
      weekValues[gameId] = nextValue;

      return { ...current, [week]: weekValues };
    });
  }

  return (
    <figure
      aria-label="Interactive Confidence Pick Sheet preview"
      className="op-marketing-snapshot overflow-hidden rounded-[16px] border border-op-border bg-op-canvas shadow-[0_24px_64px_-46px_rgba(38,38,38,0.3)]"
    >
      <div className="flex flex-col gap-5 p-4 sm:p-6">
        <header className="flex flex-col gap-3">
          <div>
            <h3 className="text-2xl font-medium tracking-tight text-op-text">
              Week Board
            </h3>
            <p className="mt-1 text-sm text-op-secondary">
              Week {week} · Confidence · Season 2025
            </p>
          </div>
          <PreviewWeekTabs
            value={week}
            onChange={setWeek}
            idPrefix="confidence"
            ariaLabel="Select Confidence week"
          />
        </header>
        <div
          id={`confidence-week-${week}-panel`}
          role="tabpanel"
          aria-labelledby={`confidence-week-${week}-tab`}
          className="flex flex-col gap-5"
        >
          <div className="flex flex-col gap-1">
            <p className="text-sm leading-5 text-op-secondary">
              Pick winners and unique confidence values. Autosaves; hidden until
              Pick Lock.
            </p>
            <p className="text-sm text-op-secondary" aria-live="polite">
              {saveStatus}
            </p>
          </div>
          <section className="flex flex-col gap-2">
            <p className="op-eyebrow">Slate</p>
            <ul className="divide-y divide-op-border overflow-hidden rounded-[16px] border border-op-border bg-op-surface">
              {games.map((game) => {
                const locked = weekLocked || Boolean(game.confidenceLocked);

                return (
                  <ConfidenceGame
                    key={game.id}
                    game={game}
                    selected={picks[week][game.id]}
                    confidence={confidenceValues[week][game.id]}
                    locked={locked}
                    onPick={(team) =>
                      setPicks((current) => ({
                        ...current,
                        [week]: {
                          ...current[week],
                          [game.id]: team.abbreviation,
                        },
                      }))
                    }
                    onConfidenceChange={(value) =>
                      updateConfidence(game.id, value)
                    }
                  />
                );
              })}
            </ul>
          </section>
        </div>
      </div>
    </figure>
  );
}
