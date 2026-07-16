import { Fragment, useEffect, useRef } from "react";
import { uiType } from "@/lib/uiType";
import { InitialAvatar } from "./InitialAvatar";
import { StatusChip, eligibilityTone } from "./StatusChip";
import { YouBadge } from "./YouBadge";
import { PickCell, type StandingsPickCell } from "./PickCell";
import { WeekChips } from "./WeekChips";

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
  const colSpan = weeks.length + 2;
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
    <div className="flex flex-col gap-3">
      <WeekChips
        weeks={weeks}
        value={focusWeek}
        onChange={onFocusWeek}
        currentWeek={currentWeek}
        ariaLabel="Standings week"
      />
      <div
        ref={scrollRef}
        className="overflow-x-auto rounded-[16px] border border-op-border bg-op-surface"
      >
        <table className="w-full min-w-max border-collapse text-left">
          <thead>
            <tr className="bg-op-control">
              <th
                className={`sticky left-0 z-20 bg-op-control px-4 py-2.5 ${uiType.eyebrow}`}
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
                      "relative px-1.5 py-2.5 text-center",
                      uiType.eyebrow,
                      focused ? "text-op-selected-fg" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <button
                      type="button"
                      className="inline-flex items-center gap-1"
                      onClick={() => onFocusWeek(week)}
                    >
                      W{week}
                      {isCurrent ? (
                        <span
                          className="h-1.5 w-1.5 rounded-full bg-op-selected-fg"
                          aria-label="Current week"
                        />
                      ) : null}
                    </button>
                  </th>
                );
              })}
              <th
                className={`sticky right-0 z-20 bg-op-control px-4 py-2.5 text-right ${uiType.eyebrow}`}
              >
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const showEliminatedDivider =
                index === firstEliminatedIndex && firstEliminatedIndex > 0;
              return (
                <Fragment key={row.participantId}>
                  {showEliminatedDivider ? (
                    <tr>
                      <td
                        colSpan={colSpan}
                        className="border-y border-op-border bg-op-canvas px-4 py-2 text-center text-[11px] text-op-muted"
                      >
                        Entries below have been eliminated
                      </td>
                    </tr>
                  ) : null}
                  <tr className="group">
                    <td
                      className={[
                        "sticky left-0 z-10 border-t border-op-border px-4 py-2.5",
                        row.isViewer
                          ? "bg-op-selected"
                          : "bg-op-surface group-hover:bg-op-canvas",
                      ].join(" ")}
                    >
                      <div className="flex min-w-[10rem] max-w-[14rem] items-center gap-2.5">
                        <InitialAvatar name={row.displayName} />
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <span
                            className={`flex min-w-0 items-center ${uiType.name}`}
                          >
                            <span className="truncate">{row.displayName}</span>
                            {row.isViewer ? <YouBadge /> : null}
                          </span>
                          <span className={uiType.meta}>
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
                            "border-t border-op-border px-1.5 py-2.5 text-center",
                            row.isViewer ? "bg-op-selected" : "",
                            focused ? "ring-1 ring-inset ring-op-selected-fg/30" : "",
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
                        "sticky right-0 z-10 border-t border-op-border px-4 py-2.5 text-right",
                        row.isViewer
                          ? "bg-op-selected"
                          : "bg-op-surface group-hover:bg-op-canvas",
                      ].join(" ")}
                    >
                      <StatusChip tone={eligibilityTone(row.eligibility)}>
                        {eligibilityLabel(row.eligibility)}
                      </StatusChip>
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
