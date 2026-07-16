export type StatusChipTone =
  | "alive"
  | "winner"
  | "eliminated"
  | "neutral"
  | "attention";

const TONE_CLASS: Record<StatusChipTone, string> = {
  alive: "border-op-won-border bg-op-won-bg text-op-won-fg",
  winner: "border-op-won-border bg-op-won-bg text-op-won-fg",
  eliminated: "border-op-lost-border bg-op-lost-bg text-op-lost-fg",
  neutral: "border-op-border bg-op-control text-op-secondary",
  attention: "border-op-heat-40 bg-op-heat-8 text-op-selected-fg",
};

/**
 * Status chip — always includes visible text (color never alone).
 */
export function StatusChip({
  tone,
  children,
  className = "",
}: {
  tone: StatusChipTone;
  children: string;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-[8px] border px-2 py-0.5 text-[11px] font-medium ${TONE_CLASS[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function eligibilityTone(eligibility: string): StatusChipTone {
  if (eligibility === "alive") return "alive";
  if (eligibility === "winner") return "winner";
  if (eligibility === "eliminated") return "eliminated";
  return "neutral";
}
