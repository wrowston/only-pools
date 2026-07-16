/**
 * Compact viewer marker.
 */
export function YouBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`ml-1 inline-flex shrink-0 items-center rounded-[6px] bg-op-heat-8 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-op-selected-fg ${className}`}
    >
      you
    </span>
  );
}
