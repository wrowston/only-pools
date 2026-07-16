import { COMPACT_CONTROL_CLASS } from "@/lib/gameDayShell";

export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
};

/**
 * Raised-segment control — Firecrawl 32px segment height.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex h-9 w-full max-w-md items-center rounded-[8px] border border-op-border bg-op-control p-0.5"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(option.value)}
            className={[
              COMPACT_CONTROL_CLASS,
              "flex flex-1 items-center justify-center rounded-[6px] px-2.5 text-[13px] font-medium transition-colors",
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
  );
}
