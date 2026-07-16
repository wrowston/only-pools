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
      className={[
        "grid h-7 w-7 shrink-0 place-items-center rounded-[8px] text-xs font-medium",
        toneClass,
      ].join(" ")}
    >
      {initial}
    </span>
  );
}

function PreviewWeekChips() {
  return (
    <div className="flex gap-1.5 overflow-hidden">
      {[5, 6, 7, 8].map((week) => (
        <span
          key={week}
          className={[
            "relative inline-flex h-8 shrink-0 items-center justify-center rounded-[8px] border px-2.5 text-[13px] font-medium",
            week === 7
              ? "border-op-heat bg-op-heat-8 text-op-selected-fg"
              : "border-transparent bg-op-control text-op-text",
          ].join(" ")}
        >
          Week {week}
        </span>
      ))}
    </div>
  );
}

function TeamPick({
  team,
  selected = false,
  locked = false,
}: {
  team: MarketingTeam;
  selected?: boolean;
  locked?: boolean;
}) {
  return (
    <div
      className={[
        "flex h-12 items-center justify-center gap-2 rounded-[8px] border px-3 text-sm font-medium tracking-wide",
        selected
          ? "border-op-selected-fg bg-op-selected text-op-selected-fg"
          : "border-op-border bg-op-surface text-op-text",
        locked ? "opacity-50" : "",
      ].join(" ")}
    >
      <TeamLogo
        logoUrl={team.logoUrl}
        abbreviation={team.abbreviation}
        size="sm"
      />
      <span>{team.abbreviation}</span>
    </div>
  );
}

function SurvivorGame({
  away,
  home,
  kickoff,
  selected,
  hideOnPhone = false,
}: {
  away: MarketingTeam;
  home: MarketingTeam;
  kickoff: string;
  selected?: string;
  hideOnPhone?: boolean;
}) {
  return (
    <li
      className={[
        "flex flex-col gap-2 px-4 py-2.5 min-[900px]:px-5",
        hideOnPhone ? "hidden sm:flex" : "",
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
          {kickoff}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <TeamPick team={away} selected={selected === away.abbreviation} />
        <TeamPick team={home} selected={selected === home.abbreviation} />
      </div>
    </li>
  );
}

function SurvivorSnapshot() {
  return (
    <figure
      aria-label="Survivor Week Board showing a saved Denver Broncos pick"
      className="op-marketing-snapshot overflow-hidden rounded-[16px] border border-op-border bg-op-canvas shadow-[0_28px_72px_-48px_rgba(38,38,38,0.32)]"
    >
      <div
        aria-hidden="true"
        className="grid min-[860px]:grid-cols-[170px_minmax(0,1fr)] min-[1060px]:grid-cols-[170px_minmax(0,1fr)_180px]"
      >
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
            <div className="mt-2 flex gap-1.5">
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
                  Week 7 · Survivor · Season 2025
                </p>
              </div>
              <PreviewWeekChips />
            </header>
            <div className="flex flex-col gap-1">
              <p className="text-sm leading-5 text-op-secondary">
                Tap a team to autosave your Survivor Pick. Hidden from others
                until Pick Lock.
              </p>
              <p className="text-sm text-op-secondary">Saved</p>
            </div>
            <section className="flex flex-col gap-2">
              <p className="op-eyebrow">Slate</p>
              <ul className="divide-y divide-op-border overflow-hidden rounded-[16px] border border-op-border bg-op-surface">
                <SurvivorGame
                  away={teams.den}
                  home={teams.no}
                  kickoff="Thu, Oct 17 · 6:15 PM"
                  selected="DEN"
                />
                <SurvivorGame
                  away={teams.buf}
                  home={teams.kc}
                  kickoff="Sun, Oct 20 · 11:00 AM"
                />
                <SurvivorGame
                  away={teams.det}
                  home={teams.min}
                  kickoff="Sun, Oct 20 · 11:00 AM"
                  hideOnPhone
                />
              </ul>
            </section>
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
  away,
  home,
  kickoff,
  selected,
  confidence,
  locked = false,
}: {
  away: MarketingTeam;
  home: MarketingTeam;
  kickoff: string;
  selected: string;
  confidence: number;
  locked?: boolean;
}) {
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
          {kickoff}
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
          />
          <TeamPick
            team={home}
            selected={selected === home.abbreviation}
            locked={locked}
          />
        </div>
        <div className="flex shrink-0 items-center gap-2 text-sm text-op-text">
          <span className="text-[11px] font-medium uppercase tracking-wide text-op-muted">
            Conf
          </span>
          <span
            className={[
              "flex h-12 w-[58px] items-center justify-between rounded-[8px] border border-op-border bg-op-surface px-3 text-sm font-medium",
              locked ? "opacity-50" : "",
            ].join(" ")}
          >
            {confidence}
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              className="text-op-muted"
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
        </div>
      </div>
    </li>
  );
}

function ConfidenceSnapshot() {
  return (
    <figure
      aria-label="Confidence Pick Sheet with winner predictions and confidence values"
      className="op-marketing-snapshot overflow-hidden rounded-[16px] border border-op-border bg-op-canvas shadow-[0_24px_64px_-46px_rgba(38,38,38,0.3)]"
    >
      <div aria-hidden="true" className="flex flex-col gap-5 p-4 sm:p-6">
        <header className="flex flex-col gap-3">
          <div>
            <h3 className="text-2xl font-medium tracking-tight text-op-text">
              Week Board
            </h3>
            <p className="mt-1 text-sm text-op-secondary">
              Week 7 · Confidence · Season 2025
            </p>
          </div>
          <PreviewWeekChips />
        </header>
        <div className="flex flex-col gap-1">
          <p className="text-sm leading-5 text-op-secondary">
            Pick winners and unique confidence values. Autosaves; hidden until
            Pick Lock.
          </p>
          <p className="text-sm text-op-secondary">Saved</p>
        </div>
        <section className="flex flex-col gap-2">
          <p className="op-eyebrow">Slate</p>
          <ul className="divide-y divide-op-border overflow-hidden rounded-[16px] border border-op-border bg-op-surface">
            <ConfidenceGame
              away={teams.den}
              home={teams.no}
              kickoff="Thu, Oct 17 · 6:15 PM"
              selected="DEN"
              confidence={16}
              locked
            />
            <ConfidenceGame
              away={teams.buf}
              home={teams.kc}
              kickoff="Sun, Oct 20 · 11:00 AM"
              selected="BUF"
              confidence={15}
            />
            <ConfidenceGame
              away={teams.det}
              home={teams.min}
              kickoff="Sun, Oct 20 · 11:00 AM"
              selected="DET"
              confidence={14}
            />
          </ul>
        </section>
      </div>
    </figure>
  );
}

function StandingsSnapshot() {
  const rows = [
    { initial: "A", name: "Alex", correct: 6, points: 64, tone: "heat" },
    { initial: "J", name: "Jordan", correct: 5, points: 59, tone: "green" },
    { initial: "S", name: "Sam", correct: 5, points: 55, tone: "blue" },
    { initial: "T", name: "Taylor", correct: 4, points: 51, tone: "neutral" },
  ] as const;

  return (
    <figure
      aria-label="Live weekly standings for the Sunday Crew pool"
      className="op-marketing-snapshot overflow-hidden rounded-[16px] border border-op-border bg-op-canvas shadow-[0_24px_64px_-46px_rgba(38,38,38,0.3)]"
    >
      <div aria-hidden="true" className="flex flex-col gap-5 p-4 sm:p-6">
        <header>
          <h3 className="text-2xl font-medium tracking-tight text-op-text">
            Standings
          </h3>
          <p className="mt-1 text-sm text-op-secondary">
            Confidence · Week 7
          </p>
        </header>
        <div className="inline-flex h-9 w-full items-center rounded-[8px] border border-op-border bg-op-control p-0.5">
          <span className="flex h-8 flex-1 items-center justify-center rounded-[6px] bg-op-surface px-2.5 text-[13px] font-medium text-op-text shadow-[0_1px_2px_rgba(0,0,0,0.04)] ring-1 ring-op-border">
            Weekly Standing
          </span>
          <span className="flex h-8 flex-1 items-center justify-center px-2.5 text-[13px] font-medium text-op-secondary">
            Season Standing
          </span>
        </div>
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
            {rows.map((row, index) => (
              <li
                key={row.name}
                className={[
                  "flex items-center justify-between gap-4 px-4 py-3",
                  index === 0 ? "bg-op-selected" : "",
                ].join(" ")}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <StaticAvatar initial={row.initial} tone={row.tone} />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-[13px] font-medium text-op-text">
                      {index + 1}. {row.name}
                      {index === 0 ? (
                        <span className="ml-1 rounded-[6px] bg-op-heat-8 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-op-selected-fg">
                          you
                        </span>
                      ) : null}
                    </span>
                    <span className="text-xs text-op-muted">
                      {row.correct} correct · {18 - index * 2} possible remaining
                    </span>
                  </div>
                </div>
                <span className="shrink-0 text-[13px] font-medium tabular-nums text-op-text">
                  {row.points} pts
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </figure>
  );
}

export function MarketingShowcase() {
  return (
    <>
      <section className="relative px-4 pb-24 sm:px-6 sm:pb-32">
        <div
          className="op-grid-bg-soft pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,black_0%,black_64%,transparent_100%)]"
          aria-hidden
        />
        <div className="op-marketing-enter op-marketing-enter-delay-2 relative mx-auto max-w-[1040px]">
          <SurvivorSnapshot />
        </div>
      </section>

      <section
        id="pool-types"
        className="scroll-mt-28 border-y border-op-border bg-op-surface px-5 py-20 sm:px-8 sm:py-28"
      >
        <div className="mx-auto max-w-[1040px]">
          <div className="max-w-xl">
            <p className="op-eyebrow text-op-heat">Pick your pool</p>
            <h2 className="mt-3 text-3xl font-medium leading-tight tracking-[-0.03em] text-op-text sm:text-5xl">
              Two ways to play. One simple home.
            </h2>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-2">
            <article className="rounded-[16px] border border-op-border bg-op-canvas p-6 sm:p-8">
              <span className="font-mono text-[10px] tracking-[0.08em] text-op-heat">
                01 / SURVIVOR
              </span>
              <h3 className="mt-8 text-2xl font-medium tracking-tight text-op-text">
                One team. One week.
              </h3>
              <p className="mt-3 max-w-sm text-[15px] leading-7 text-op-secondary">
                Pick one team each week. Win and move on. Use each team once.
              </p>
            </article>
            <article className="rounded-[16px] border border-op-border bg-op-canvas p-6 sm:p-8">
              <span className="font-mono text-[10px] tracking-[0.08em] text-op-heat">
                02 / CONFIDENCE
              </span>
              <h3 className="mt-8 text-2xl font-medium tracking-tight text-op-text">
                Every game. Ranked your way.
              </h3>
              <p className="mt-3 max-w-sm text-[15px] leading-7 text-op-secondary">
                Pick every winner. Rank each pick by how sure you are.
              </p>
            </article>
          </div>
        </div>
      </section>

      <section className="px-5 py-20 sm:px-8 sm:py-32">
        <div className="mx-auto max-w-[1040px]">
          <div className="mx-auto max-w-2xl text-center">
            <p className="op-eyebrow text-op-heat">Game day, handled</p>
            <h2 className="mt-3 text-3xl font-medium leading-tight tracking-[-0.03em] text-op-text sm:text-5xl">
              Everything that matters. Nothing that doesn’t.
            </h2>
          </div>
          <div className="mt-16 grid items-center gap-10 md:grid-cols-[0.72fr_1.28fr] md:gap-16">
            <div className="max-w-md">
              <span className="font-mono text-[10px] tracking-[0.08em] text-op-heat">
                MAKE YOUR PICKS
              </span>
              <h3 className="mt-3 text-2xl font-medium tracking-tight text-op-text sm:text-3xl">
                Sure about that one?
              </h3>
              <p className="mt-4 text-[15px] leading-7 text-op-secondary">
                Choose every winner, then put more points behind the picks you
                trust most. Only Pools keeps every value unique and every open
                game editable.
              </p>
            </div>
            <ConfidenceSnapshot />
          </div>
          <div className="mt-20 grid items-center gap-10 md:mt-28 md:grid-cols-[1.18fr_0.82fr] md:gap-16">
            <StandingsSnapshot />
            <div className="max-w-md md:order-last">
              <span className="font-mono text-[10px] tracking-[0.08em] text-op-heat">
                SEE WHERE YOU STAND
              </span>
              <h3 className="mt-3 text-2xl font-medium tracking-tight text-op-text sm:text-3xl">
                Standings without the wait.
              </h3>
              <p className="mt-4 text-[15px] leading-7 text-op-secondary">
                Standings update as verified results arrive, so everyone sees
                the same score without waiting for someone to do the math.
              </p>
            </div>
          </div>
          <div className="mt-20 grid gap-px overflow-hidden rounded-[16px] border border-op-border bg-op-border sm:grid-cols-3 md:mt-28">
            {[
              {
                title: "Autosaves as you go",
                copy: "Make a pick and keep moving. Your latest saved choice is always clear.",
              },
              {
                title: "Locks at kickoff",
                copy: "Each choice closes when its game begins. Everything else stays open.",
              },
              {
                title: "Hidden until lock",
                copy: "Other participants cannot see your choice before it is locked.",
              },
            ].map((item) => (
              <article key={item.title} className="bg-op-surface p-6 sm:p-7">
                <span className="mb-5 block h-2 w-2 rounded-full bg-op-heat" />
                <h3 className="text-base font-medium text-op-text">
                  {item.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-op-secondary">
                  {item.copy}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
