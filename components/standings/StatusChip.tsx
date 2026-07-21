import { Badge } from "@/components/ui/badge";

export type StatusChipTone =
  | "alive"
  | "winner"
  | "eliminated"
  | "neutral"
  | "attention";

/**
 * Status chip — always includes visible text (color never alone).
 * Thin wrapper over shadcn Badge with Only Pools status variants.
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
    <Badge variant={tone} className={className}>
      {children}
    </Badge>
  );
}

export function eligibilityTone(eligibility: string): StatusChipTone {
  if (eligibility === "alive") return "alive";
  if (eligibility === "winner") return "winner";
  if (eligibility === "eliminated") return "eliminated";
  return "neutral";
}
