import { uiType } from "@/lib/uiType";

/**
 * Bold count + muted label (e.g. “7 still Alive”).
 */
export function SummaryStat({
  value,
  label,
}: {
  value: string | number;
  label: string;
}) {
  return (
    <p className="flex items-baseline gap-1.5">
      <span className={uiType.metric}>{value}</span>
      <span className={uiType.meta}>{label}</span>
    </p>
  );
}
