import { Skeleton } from "@/components/ui/skeleton";

/** Layout-matching placeholder while Pool panel members load. */
export function PoolPanelSkeleton() {
  return (
    <div
      className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 py-8 min-[900px]:px-8"
      aria-busy="true"
      aria-label="Loading Pool"
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-3 w-28" />
        </div>
        <Skeleton className="h-4 w-56 max-w-full" />
      </div>
      <div className="flex flex-col gap-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            className="flex flex-col gap-3 rounded-xl border border-op-border bg-op-surface p-4"
          >
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3 w-56 max-w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Compact placeholder for the Pool Audit subsection. */
export function PoolAuditSkeleton() {
  return (
    <div
      className="flex flex-col gap-2"
      aria-busy="true"
      aria-label="Loading audit"
    >
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="flex flex-col gap-1.5 py-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-28" />
        </div>
      ))}
    </div>
  );
}
