import { Fragment, useEffect, useRef } from "react";
import { uiType } from "@/lib/uiType";
import { ParticipantAvatar } from "./ParticipantAvatar";
import { StatusChip, eligibilityTone } from "./StatusChip";
import { YouBadge } from "./YouBadge";
import { PickCell, type StandingsPickCell } from "./PickCell";
import { WeekChips } from "./WeekChips";

/** Sticky player column — narrow on mobile so week picks stay visible. */
const PLAYER_COL =
  "w-[9.5rem] min-w-[9.5rem] max-w-[9.5rem] min-[900px]:w-[16rem] min-[900px]:min-w-[16rem] min-[900px]:max-w-[16rem]";

/** Week pick columns — match PickCell size + padding (compact mobile, larger desktop). */
const WEEK_COL =
  "w-12 min-w-12 max-w-12 min-[900px]:w-16 min-[900px]:min-w-16 min-[900px]:max-w-16";

/** Sticky status column — desktop only; mobile uses player meta for status. */
const STATUS_COL =
  "hidden min-[900px]:table-cell min-[900px]:w-[7.5rem] min-[900px]:min-w-[7.5rem] min-[900px]:max-w-[7.5rem]";

function eligibilityLabel(eligibility: string): string {
  if (eligibility === "alive") return "Alive";
  if (eligibility === "winner") return "Winner";
  return "Eliminated";
}

function weekContext(row: {
  eligibility: string;
  eliminatedWeek: number | null;
  eliminationReason: string | null;
  wonAtWeek: number | null;
}): string {
  if (row.eligibility === "winner" && row.wonAtWeek !== null) {
    if (row.eliminationReason) {
      return `Joint winner · Week ${row.wonAtWeek} (${row.eliminationReason.replace("_", " ")})`;
    }
    return `Winner · Week ${row.wonAtWeek}`;
  }
  if (row.eligibility === "eliminated" && row.eliminatedWeek !== null) {
    const reason = row.eliminationReason?.replace("_", " ") ?? "eliminated";
    return `Week ${row.eliminatedWeek} · ${reason}`;
  }
  return "Still Alive";
}

export type SurvivorPickGridRow = {
  participantId: string;
  displayName: string;
  avatarUrl?: string | null;
  eligibility: string;
  eliminatedWeek: number | null;
  eliminationReason: string | null;
  wonAtWeek: number | null;
  isViewer: boolean;
  cells: StandingsPickCell[];
};

/**
 * Horizontal pick grid: sticky player column + week pick cells.
 * Week chips scroll/highlight columns (Splashsports-style).
 */
export function SurvivorPickGrid({
  weeks,
  rows,
  focusWeek,
  currentWeek,
  onFocusWeek,
}: {
  weeks: number[];
  rows: SurvivorPickGridRow[];
  focusWeek: number;
  currentWeek: number;
  onFocusWeek: (week: number) => void;
}) {
  const firstEliminatedIndex = rows.findIndex(
    (r) => r.eligibility === "eliminated",
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerRefs = useRef<Map<number, HTMLTableCellElement>>(new Map());
  const didInitScrollRef = useRef(false);

  useEffect(() => {
    const el = headerRefs.current.get(focusWeek);
    if (!el) return;
    // Instant align on first paint; smooth only for subsequent week picks.
    el.scrollIntoView({
      behavior: didInitScrollRef.current ? "smooth" : "auto",
      inline: "center",
      block: "nearest",
    });
    didInitScrollRef.current = true;
  }, [focusWeek]);

  return (
    <div className="flex w-full flex-col gap-3">
      <WeekChips
        weeks={weeks}
        value={focusWeek}
        onChange={onFocusWeek}
        currentWeek={currentWeek}
        ariaLabel="Standings week"
      />
      <div
        ref={scrollRef}
        className="w-full overflow-x-auto rounded-[16px] border border-op-border bg-op-surface"
      >
        <table className="min-w-max border-collapse text-left">
          <thead>
            <tr className="bg-op-control">
              <th
                className={`sticky left-0 z-20 overflow-hidden border-r border-op-border bg-op-control px-2.5 py-2.5 min-[900px]:px-5 min-[900px]:py-3.5 ${PLAYER_COL} ${uiType.eyebrow}`}
              >
                Player
              </th>
              {weeks.map((week) => {
                const focused = week === focusWeek;
                const isCurrent = week === currentWeek;
                return (
                  <th
                    key={week}
                    ref={(node) => {
                      if (node) headerRefs.current.set(week, node);
                      else headerRefs.current.delete(week);
                    }}
                    className={[
                      "relative px-1 py-2.5 text-center min-[900px]:px-2 min-[900px]:py-3.5",
                      WEEK_COL,
                      uiType.eyebrow,
                      focused ? "bg-op-heat-8 text-op-selected-fg" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <button
                      type="button"
                      className="inline-flex items-center justify-center gap-1"
                      onClick={() => onFocusWeek(week)}
                    >
                      W{week}
                      {isCurrent ? (
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full bg-op-selected-fg"
                          aria-label="Current week"
                        />
                      ) : null}
                    </button>
                  </th>
                );
              })}
              <th
                className={`sticky right-0 z-20 overflow-hidden border-l border-op-border bg-op-control px-2 py-2.5 text-right min-[900px]:px-5 min-[900px]:py-3.5 ${STATUS_COL} ${uiType.eyebrow}`}
              >
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const showEliminatedDivider =
                index === firstEliminatedIndex && firstEliminatedIndex > 0;
              const playerBg = row.isViewer
                ? "bg-op-selected"
                : "bg-op-surface group-hover:bg-op-canvas";
              return (
                <Fragment key={row.participantId}>
                  {showEliminatedDivider ? (
                    <tr>
                      <td
                        colSpan={weeks.length + 1}
                        className="border-y border-op-border bg-op-canvas px-4 py-2 text-center text-[11px] text-op-muted min-[900px]:py-2.5 min-[900px]:text-xs"
                      >
                        Entries below have been eliminated
                      </td>
                      <td
                        className={`border-y border-op-border bg-op-canvas ${STATUS_COL}`}
                        aria-hidden
                      />
                    </tr>
                  ) : null}
                  <tr className="group">
                    <td
                      className={[
                        "sticky left-0 z-10 overflow-hidden border-r border-op-border border-t px-2.5 py-2.5 min-[900px]:px-5 min-[900px]:py-3.5",
                        PLAYER_COL,
                        playerBg,
                      ].join(" ")}
                    >
                      <div className="flex min-w-0 items-start gap-2 min-[900px]:gap-3">
                        <span className="mt-0.5 shrink-0">
                          <ParticipantAvatar
                            name={row.displayName}
                            imageUrl={row.avatarUrl}
                            isViewer={row.isViewer}
                            className="min-[900px]:h-9 min-[900px]:w-9 min-[900px]:text-sm"
                          />
                        </span>
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span
                            className={`flex min-w-0 items-center ${uiType.name} min-[900px]:text-[15px]`}
                          >
                            <span className="min-w-0 truncate">
                              {row.displayName}
                            </span>
                            {row.isViewer ? (
                              <YouBadge className="min-[900px]:px-2 min-[900px]:text-[11px]" />
                            ) : null}
                          </span>
                          <span
                            className={`truncate ${uiType.meta} min-[900px]:text-[13px]`}
                          >
                            {weekContext(row)}
                          </span>
                        </div>
                      </div>
                    </td>
                    {row.cells.map((cell) => {
                      const focused = cell.week === focusWeek;
                      return (
                        <td
                          key={cell.week}
                          className={[
                            "border-t border-op-border px-1 py-2.5 text-center min-[900px]:px-2 min-[900px]:py-3.5",
                            WEEK_COL,
                            row.isViewer ? "bg-op-selected" : "",
                            focused
                              ? "ring-1 ring-inset ring-op-selected-fg/30"
                              : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          <div className="flex justify-center">
                            <PickCell cell={cell} />
                          </div>
                        </td>
                      );
                    })}
                    <td
                      className={[
                        "sticky right-0 z-10 overflow-hidden border-l border-op-border border-t px-2 py-2.5 min-[900px]:px-3 min-[900px]:py-3.5",
                        STATUS_COL,
                        playerBg,
                      ].join(" ")}
                    >
                      <div className="flex justify-end">
                        <StatusChip
                          tone={eligibilityTone(row.eligibility)}
                          className="min-[900px]:px-2.5 min-[900px]:py-1 min-[900px]:text-xs"
                        >
                          {eligibilityLabel(row.eligibility)}
                        </StatusChip>
                      </div>
                    </td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
