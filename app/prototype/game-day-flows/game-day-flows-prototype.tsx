"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import styles from "./prototype.module.css";

type Variant = "A" | "B" | "C";
type Role = "participant" | "owner";
type PoolType = "confidence" | "survivor";
type Phase = "picking" | "live" | "repair";

const variants: Array<{ key: Variant; name: string }> = [
  { key: "A", name: "Action first" },
  { key: "B", name: "Mobile week board" },
  { key: "C", name: "Trust timeline" },
];

const confidenceGames = [
  { away: "BAL", home: "CLE", kickoff: "Final", value: 16, locked: true, score: "24–17" },
  { away: "GB", home: "MIN", kickoff: "Q3 · 4:12", value: 15, locked: true, score: "20–21" },
  { away: "KC", home: "LV", kickoff: "4:25 PM", value: 14, locked: false, score: "—" },
  { away: "DAL", home: "SF", kickoff: "8:20 PM", value: 13, locked: false, score: "—" },
];

const standings = [
  { rank: "1", name: "Maya", points: 72, possible: 101, me: false },
  { rank: "2", name: "You", points: 68, possible: 105, me: true },
  { rank: "3", name: "Andre", points: 65, possible: 94, me: false },
  { rank: "4", name: "Rosa", points: 59, possible: 102, me: false },
];

const survivorRows = [
  { name: "You", team: "KC", state: "Alive · pick saved", private: true },
  { name: "Maya", team: "Hidden", state: "Alive · pick saved", private: true },
  { name: "Andre", team: "MIN", state: "Pending · game live", private: false },
  { name: "Rosa", team: "BAL", state: "Advanced · verified", private: false },
];

type IconName = "week" | "standings" | "people" | "rules" | "settings" | "bell" | "help" | "chevron" | "calendar" | "check" | "activity" | "collapse";

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    week: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    standings: <><path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/></>,
    people: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>,
    rules: <><path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1 14h6"/><path d="M9 8h6"/><path d="M17 16h6"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06-2.83 2.83-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21h-4v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06-2.83-2.83.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3v-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06 2.83-2.83.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3h4v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06 2.83 2.83-.06.06A1.65 1.65 0 0 0 19.4 9c.12.6.65 1 1.26 1H21v4h-.34c-.61 0-1.14.4-1.26 1Z"/></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></>,
    help: <><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 1 1 5.1 2.2c-1.2.8-2.2 1.4-2.2 2.8"/><path d="M12 18h.01"/></>,
    chevron: <path d="m9 18 6-6-6-6"/>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4"/><path d="M8 3v4"/><path d="M3 11h18"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    activity: <><path d="M3 3v18h18"/><path d="m7 16 4-5 4 3 5-7"/></>,
    collapse: <path d="m15 18-6-6 6-6"/>,
  };

  return <svg aria-hidden="true" fill="none" height={size} viewBox="0 0 24 24" width={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">{paths[name]}</svg>;
}

function StatusPill({ phase }: { phase: Phase }) {
  const content = {
    picking: ["Picks open", "Provider checked 42 sec ago"],
    live: ["Games in progress", "Official scoring current"],
    repair: ["Standings repair in progress", "Last official revision remains visible"],
  }[phase];

  return (
    <div className={`${styles.statusPill} ${styles[phase]}`}>
      <span aria-hidden="true" />
      <strong>{content[0]}</strong>
      <small>{content[1]}</small>
    </div>
  );
}

function ScenarioControls({
  role,
  setRole,
  poolType,
  setPoolType,
  phase,
  setPhase,
}: {
  role: Role;
  setRole: (role: Role) => void;
  poolType: PoolType;
  setPoolType: (poolType: PoolType) => void;
  phase: Phase;
  setPhase: (phase: Phase) => void;
}) {
  return (
    <div className={styles.scenarioControls} aria-label="Prototype scenario controls">
      <label>
        <span>View as</span>
        <select value={role} onChange={(event) => setRole(event.target.value as Role)}>
          <option value="participant">Participant</option>
          <option value="owner">Pool Owner</option>
        </select>
      </label>
      <label>
        <span>Pool</span>
        <select value={poolType} onChange={(event) => setPoolType(event.target.value as PoolType)}>
          <option value="confidence">Confidence</option>
          <option value="survivor">Survivor</option>
        </select>
      </label>
      <label>
        <span>Moment</span>
        <select value={phase} onChange={(event) => setPhase(event.target.value as Phase)}>
          <option value="picking">Before locks</option>
          <option value="live">Live Sunday</option>
          <option value="repair">Scoring repair</option>
        </select>
      </label>
    </div>
  );
}

function PickTask({
  poolType,
  phase,
  selectedTeam,
  onPick,
  compact = false,
}: {
  poolType: PoolType;
  phase: Phase;
  selectedTeam: string;
  onPick: (team: string) => void;
  compact?: boolean;
}) {
  if (poolType === "survivor") {
    return (
      <section className={`${styles.pickTask} ${compact ? styles.compact : ""}`}>
        <div className={styles.eyebrow}>Your Week 8 Survivor Pick</div>
        <div className={styles.taskHeading}>
          <div>
            <h2>{selectedTeam || "Choose one team to stay alive"}</h2>
            <p>Unused teams only · locks with the selected team&apos;s game</p>
          </div>
          <span className={styles.clock}>2h 18m</span>
        </div>
        <div className={styles.teamChoices}>
          {["KC", "LV", "DAL", "SF"].map((team) => (
            <button
              className={selectedTeam === team ? styles.selectedTeam : ""}
              disabled={phase !== "picking"}
              key={team}
              onClick={() => onPick(team)}
            >
              <b>{team}</b>
              <small>{team === "KC" || team === "DAL" ? "Away" : "Home"}</small>
            </button>
          ))}
        </div>
        <div className={styles.saveState}>
          <span>✓</span> {selectedTeam ? `${selectedTeam} saved by server · Hidden until lock` : "No pick saved yet"}
        </div>
      </section>
    );
  }

  return (
    <section className={`${styles.pickTask} ${compact ? styles.compact : ""}`}>
      <div className={styles.eyebrow}>Your Week 8 Confidence Pick Set</div>
      <div className={styles.taskHeading}>
        <div>
          <h2>{phase === "picking" ? "2 predictions need your attention" : "Your picks are scoring live"}</h2>
          <p>Autosaved per edit · values stay unique</p>
        </div>
        <span className={styles.clock}>{phase === "picking" ? "2h 18m" : "68 pts"}</span>
      </div>
      <div className={styles.miniGames}>
        {confidenceGames.slice(2).map((game) => (
          <button disabled={phase !== "picking"} key={game.away} onClick={() => onPick(game.away)}>
            <span><b>{game.away}</b> at {game.home}</span>
            <span>{selectedTeam === game.away ? `${game.away} selected` : "Choose winner"}</span>
            <strong>{game.value}</strong>
          </button>
        ))}
      </div>
      <div className={styles.saveState}>
        <span>✓</span> {selectedTeam ? `${selectedTeam} accepted · saved just now` : "Last server save 38 sec ago"}
      </div>
    </section>
  );
}

function Standings({ poolType, phase }: { poolType: PoolType; phase: Phase }) {
  return (
    <section className={styles.standings}>
      <div className={styles.sectionTitle}>
        <div>
          <span className={styles.eyebrow}>{poolType === "confidence" ? "Week 8" : "Pool status"}</span>
          <h3>{poolType === "confidence" ? "Official standings" : "Who is still alive"}</h3>
        </div>
        <button>Full standings →</button>
      </div>
      {phase === "repair" && (
        <div className={styles.repairNotice}>
          <strong>Repair in progress</strong>
          <span>Showing the last consistent official revision from 2:41 PM. Picks remain open where eligible.</span>
        </div>
      )}
      <div className={styles.standingRows}>
        {poolType === "confidence"
          ? standings.map((row) => (
              <div className={row.me ? styles.myRow : ""} key={row.name}>
                <b>{row.rank}</b>
                <span>{row.name}</span>
                <small>{row.points} pts</small>
                <em>{row.possible} possible</em>
              </div>
            ))
          : survivorRows.map((row) => (
              <div className={row.name === "You" ? styles.myRow : ""} key={row.name}>
                <span>{row.name}</span>
                <b>{row.team}</b>
                <em>{row.state}</em>
              </div>
            ))}
      </div>
    </section>
  );
}

function OwnerPanel({ phase }: { phase: Phase }) {
  return (
    <section className={styles.ownerPanel}>
      <div className={styles.sectionTitle}>
        <div>
          <span className={styles.eyebrow}>Owner workspace</span>
          <h3>Pool readiness</h3>
        </div>
        <span className={styles.ownerBadge}>Owner</span>
      </div>
      <div className={styles.readinessGrid}>
        <button><strong>18 / 22</strong><span>Pick sets started</span><small>Choices stay hidden</small></button>
        <button><strong>3</strong><span>Incomplete sets</span><small>View people, not picks</small></button>
        <button><strong>1</strong><span>No activity</span><small>Contact participant</small></button>
      </div>
      <div className={styles.ownerActions}>
        <button>Manage participants</button>
        <button>Copy Pool Invite</button>
        <button>View audit events</button>
      </div>
      <div className={styles.operatorBoundary}>
        <span>Data & scoring</span>
        <strong>{phase === "repair" ? "Production Operator repair is underway" : "Healthy · automatic recovery available"}</strong>
        <small>Pool roles can see status but cannot resync data or recalculate standings.</small>
      </div>
    </section>
  );
}

function AppHeader({ role }: { role: Role }) {
  return (
    <header className={styles.appHeader}>
      <a className={styles.brand} href="#"><span>OP</span><b>Only Pools</b></a>
      <nav><button>My pools</button><button>Standings</button><button>Rules</button></nav>
      <div className={styles.profile}><span>{role === "owner" ? "Pool Owner" : "Participant"}</span><b>RS</b></div>
    </header>
  );
}

function VariantA(props: SharedVariantProps) {
  return (
    <div className={`${styles.variant} ${styles.variantA}`}>
      <AppHeader role={props.role} />
      <main>
        <div className={styles.poolTitle}>
          <div><span>Sunday Best Friends</span><h1>Week 8 at a glance</h1></div>
          <StatusPill phase={props.phase} />
        </div>
        <div className={styles.actionLayout}>
          <PickTask {...props} />
          <aside className={styles.todayRail}>
            <div><span>Next lock</span><strong>KC at LV</strong><small>4:25 PM ET · 2h 18m</small></div>
            <div><span>Your season</span><strong>{props.poolType === "confidence" ? "2nd · 614 pts" : "Alive · 7 teams used"}</strong><small>Updated from official results</small></div>
            <div><span>NFL data</span><strong>{props.phase === "repair" ? "Repairing standings" : "Current"}</strong><small>Checked 42 sec ago</small></div>
          </aside>
        </div>
        {props.role === "owner" && <OwnerPanel phase={props.phase} />}
        <Standings poolType={props.poolType} phase={props.phase} />
      </main>
    </div>
  );
}

function VariantB(props: SharedVariantProps) {
  const phaseCopy = {
    picking: { title: "Picks are open", detail: "2 games still need your pick", tone: "open" },
    live: { title: "Games in progress", detail: "Official scoring is current", tone: "live" },
    repair: { title: "Standings repair underway", detail: "Last official revision remains visible", tone: "repair" },
  }[props.phase];

  return (
    <div className={`${styles.variant} ${styles.variantB}`}>
      <aside className={styles.fireSidebar}>
        <div className={styles.fireBrand}><span>OP</span><strong>Only Pools</strong></div>
        <div className={styles.fireNavGroup}>
          <small>POOL</small>
          <button className={styles.fireActive}><Icon name="week"/><span>Week 8</span></button>
          <button><Icon name="standings"/><span>Standings</span></button>
          <button><Icon name="people"/><span>Participants</span></button>
          <button><Icon name="rules"/><span>Pool rules</span></button>
        </div>
        {props.role === "owner" && <div className={styles.fireNavGroup}><small>MANAGE</small><button><Icon name="settings"/><span>Owner tools</span></button></div>}
        <div className={styles.fireSidebarBottom}>
          <button><Icon name="activity"/><span>What&apos;s new</span><b>3</b></button>
          <button className={styles.fireUser}><span>RS</span><div><strong>Riley Smith</strong><small>{props.role === "owner" ? "Pool Owner" : "Participant"}</small></div></button>
          <button><Icon name="collapse"/><span>Collapse</span></button>
        </div>
      </aside>

      <div className={styles.fireWorkspace}>
        <header className={styles.fireTopbar}>
          <button className={styles.firePoolSelect}><span>SB</span><strong>Sunday Best Friends</strong><Icon name="chevron" size={14}/></button>
          <div className={styles.fireTopActions}>
            <button aria-label="Notifications"><Icon name="bell"/></button>
            <button><Icon name="help"/><span>Help</span></button>
            <button className={styles.fireProfile}>RS</button>
          </div>
        </header>

        <main className={styles.fireMain}>
          <section className={styles.fireHero}>
            <div><span>{props.poolType === "confidence" ? "CONFIDENCE POOL" : "SURVIVOR POOL"} · REGULAR SEASON</span><h1>Week 8</h1><p>Make your picks, follow official results, and see where you stand.</p></div>
            <div className={`${styles.firePhase} ${styles[phaseCopy.tone]}`}><i/><div><strong>{phaseCopy.title}</strong><small>{phaseCopy.detail}</small></div></div>
          </section>

          <section className={styles.fireWeekBar}>
            <div className={styles.fireWeekTabs}><button><Icon name="chevron" size={14}/> Week 7</button><button className={styles.fireWeekActive}>Week 8</button><button>Week 9 <Icon name="chevron" size={14}/></button></div>
            <div className={styles.fireFreshness}><span className={styles.mintDot}/> NFL data checked 42 sec ago</div>
          </section>

          <div className={styles.fireBoardLayout}>
            <section className={styles.fireGameBoard}>
              <header><div><h2>Sunday game board</h2><p>{props.poolType === "confidence" ? "Pick each winner. Confidence values autosave with every change." : "Choose one unused team. Your pick stays hidden until it locks."}</p></div><span>{props.phase === "picking" ? "2 open" : "4 locked"}</span></header>
              <div className={styles.fireBoardHeads}><span>Matchup & status</span><span>Your pick</span><span>{props.poolType === "confidence" ? "Value" : "Used"}</span></div>
              <div className={styles.fireGames}>
                {confidenceGames.map((game, index) => {
                  const lockedTeam = index === 0 ? game.away : index === 1 ? game.home : "";
                  const awayChosen = props.selectedTeam === game.away || lockedTeam === game.away;
                  const homeChosen = props.selectedTeam === game.home || lockedTeam === game.home;
                  const disabled = game.locked || props.phase !== "picking";
                  return (
                    <article className={`${styles.fireGame} ${game.locked ? styles.fireLocked : ""}`} key={game.away}>
                      <div className={styles.fireGameMeta}><span>{game.locked ? <><Icon name="check" size={13}/> {game.kickoff}</> : <><Icon name="calendar" size={13}/> {game.kickoff} ET</>}</span><em>{game.score}</em></div>
                      <div className={styles.fireMatchup}>
                        <button className={awayChosen ? styles.fireChosen : ""} disabled={disabled} onClick={() => props.onPick(game.away)}><span><b>{game.away}</b><small>Away</small></span>{awayChosen && <Icon name="check" size={15}/>}</button>
                        <button className={homeChosen ? styles.fireChosen : ""} disabled={disabled} onClick={() => props.onPick(game.home)}><span><b>{game.home}</b><small>Home</small></span>{homeChosen && <Icon name="check" size={15}/>}</button>
                      </div>
                      <div className={styles.fireValue}><small>{props.poolType === "confidence" ? "CONFIDENCE" : "TEAM STATUS"}</small><strong>{props.poolType === "confidence" ? game.value : game.locked ? "Used" : "Available"}</strong></div>
                    </article>
                  );
                })}
              </div>
              <footer><span><Icon name="check" size={14}/> {props.selectedTeam ? `${props.selectedTeam} accepted · saved just now` : "Server-confirmed · all edits autosave"}</span><button>Review all picks <Icon name="chevron" size={14}/></button></footer>
            </section>

            <aside className={styles.fireContextRail}>
              <section><span>YOUR WEEK</span><strong>{props.poolType === "confidence" ? "2 of 4 shown picked" : props.selectedTeam ? `${props.selectedTeam} saved` : "No team saved"}</strong><small>Locked 2 · Open 2</small><div className={styles.fireProgress}><i/></div></section>
              {props.role === "owner" ? <section className={styles.firePinkCard}><span>POOL READINESS</span><strong>4 need attention</strong><small>3 incomplete · 1 untouched</small><button>View participants <Icon name="chevron" size={14}/></button><em>Completion only. Hidden picks stay private.</em></section> : <section className={styles.firePinkCard}><span>WEEKLY STANDING</span><strong>2nd · 68 pts</strong><small>105 possible points</small><button>View standings <Icon name="chevron" size={14}/></button></section>}
              <section className={props.phase === "repair" ? styles.fireRepairCard : ""}><span>OFFICIAL STATE</span><strong>{props.phase === "repair" ? "Repair underway" : "Scoring current"}</strong><small>{props.phase === "repair" ? "Showing revision from 2:41 PM" : "No scoring delays detected"}</small></section>
            </aside>
          </div>
        </main>

        <nav className={styles.fireMobileNav} aria-label="Pool navigation">
          <button className={styles.fireMobileActive}><Icon name="week"/><span>Picks</span></button>
          <button><Icon name="standings"/><span>Standings</span></button>
          <button><Icon name="people"/><span>People</span></button>
          <button><Icon name={props.role === "owner" ? "settings" : "rules"}/><span>{props.role === "owner" ? "Manage" : "Rules"}</span></button>
        </nav>
      </div>
    </div>
  );
}

function VariantC(props: SharedVariantProps) {
  const events = props.phase === "picking"
    ? [
        ["Now", "Your next decision", props.poolType === "confidence" ? "Pick KC or LV before 4:25 PM." : "Choose one unused team before its game locks."],
        ["1:00 PM", "Earlier choices locked", "Locked picks are now visible to the Pool. Your remaining choices stay hidden."],
        ["Sunday night", "Weekly tiebreaker locks", "Your prediction follows the final scheduled game."],
      ]
    : props.phase === "live"
      ? [
          ["3:47 PM", "MIN 21 · GB 20", "Projected rank: 1st. Official rank remains 2nd until the result is verified."],
          ["2:41 PM", "BAL result verified", "Official Week 8 standing updated atomically."],
          ["1:03 PM", "First games locked", "Opponent picks and their provenance became visible."],
        ]
      : [
          ["Now", "Automatic repair underway", "Picking continues. The last consistent official standing remains in place."],
          ["3:52 PM", "Scoring delay detected", "No partial standings were published."],
          ["2:41 PM", "Last official revision", "BAL 24 · CLE 17 was verified and scored."],
        ];

  return (
    <div className={`${styles.variant} ${styles.variantC}`}>
      <AppHeader role={props.role} />
      <main>
        <div className={styles.timelineHero}>
          <div><span className={styles.eyebrow}>Sunday Best Friends · Week 8</span><h1>What&apos;s happening now</h1><p>One stream for decisions, locks, official results, and corrections.</p></div>
          <StatusPill phase={props.phase} />
        </div>
        <div className={styles.timelineLayout}>
          <section className={styles.timeline}>
            {events.map(([time, title, body], index) => (
              <article className={index === 0 ? styles.currentEvent : ""} key={time + title}>
                <time>{time}</time><span className={styles.timelineDot} />
                <div><h2>{title}</h2><p>{body}</p>{index === 0 && <button>{props.phase === "picking" ? "Make this decision →" : "View official detail →"}</button>}</div>
              </article>
            ))}
          </section>
          <aside className={styles.timelineAside}>
            <PickTask {...props} compact />
            {props.role === "owner" ? (
              <div className={styles.peoplePulse}><span>POOL READINESS</span><strong>18 ready · 4 need attention</strong><div><i style={{ width: "82%" }} /></div><button>See participant status →</button><small>Completion only. Hidden choices stay private.</small></div>
            ) : (
              <div className={styles.peoplePulse}><span>YOUR POSITION</span><strong>{props.poolType === "confidence" ? "2nd · 68 official points" : "Alive · 7 teams used"}</strong><div><i style={{ width: "68%" }} /></div><button>Open standings →</button><small>Projections never replace official results.</small></div>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}

type SharedVariantProps = {
  role: Role;
  poolType: PoolType;
  phase: Phase;
  selectedTeam: string;
  onPick: (team: string) => void;
};

function PrototypeSwitcher({ variant, onChange }: { variant: Variant; onChange: (variant: Variant) => void }) {
  const index = variants.findIndex((item) => item.key === variant);
  const cycle = (direction: -1 | 1) => onChange(variants[(index + direction + variants.length) % variants.length].key);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable) return;
      if (event.key === "ArrowLeft") cycle(-1);
      if (event.key === "ArrowRight") cycle(1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  if (process.env.NODE_ENV === "production") return null;

  return (
    <div className={styles.prototypeSwitcher}>
      <button aria-label="Previous variant" onClick={() => cycle(-1)}>←</button>
      <div><small>THROWAWAY PROTOTYPE</small><strong>{variant} — {variants[index].name}</strong></div>
      <button aria-label="Next variant" onClick={() => cycle(1)}>→</button>
    </div>
  );
}

export default function GameDayFlowsPrototype() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const rawVariant = searchParams.get("variant")?.toUpperCase();
  const variant: Variant = rawVariant === "B" || rawVariant === "C" ? rawVariant : "A";
  const [role, setRole] = useState<Role>("participant");
  const [poolType, setPoolType] = useState<PoolType>("confidence");
  const [phase, setPhase] = useState<Phase>("picking");
  const [selectedTeam, setSelectedTeam] = useState("");

  const shared = useMemo(() => ({ role, poolType, phase, selectedTeam, onPick: setSelectedTeam }), [role, poolType, phase, selectedTeam]);
  const changeVariant = (next: Variant) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("variant", next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  return (
    <div className={styles.prototypeShell}>
      <ScenarioControls role={role} setRole={setRole} poolType={poolType} setPoolType={setPoolType} phase={phase} setPhase={setPhase} />
      {variant === "A" && <VariantA {...shared} />}
      {variant === "B" && <VariantB {...shared} />}
      {variant === "C" && <VariantC {...shared} />}
      <PrototypeSwitcher variant={variant} onChange={changeVariant} />
    </div>
  );
}
