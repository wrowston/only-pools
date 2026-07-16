import { COMPACT_CONTROL_CLASS } from "@/lib/gameDayShell";

/**
 * Horizontal week chips — Firecrawl 32px chip height (h-8).
 */
export function WeekChips({
  weeks,
  value,
  onChange,
  currentWeek,
  ariaLabel = "Select week",
}: {
  weeks: readonly number[];
  value: number;
  onChange: (week: number) => void;
  /** Shows a small accent dot — “current” week/round marker. */
  currentWeek?: number;
  ariaLabel?: string;
}) {
  if (weeks.length === 0) return null;

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5"
    >
      {weeks.map((week) => {
        const selected = week === value;
        const isCurrent = currentWeek === week;
        return (
          <button
            key={week}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(week)}
            className={[
              COMPACT_CONTROL_CLASS,
              "relative inline-flex shrink-0 items-center justify-center rounded-[8px] border px-2.5 text-[13px] font-medium transition-colors",
              selected
                ? "border-op-heat bg-op-heat-8 text-op-selected-fg"
                : "border-transparent bg-op-control text-op-text hover:border-op-border-strong",
            ].join(" ")}
          >
            Week {week}
            {isCurrent ? (
              <span
                className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-op-heat"
                aria-label="Current week"
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
