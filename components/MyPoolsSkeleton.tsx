import { Skeleton } from "@/components/ui/skeleton";

/** Visible on --op-canvas; default shadcn bg-muted is nearly invisible there. */
const PLACEHOLDER = "bg-op-border-strong";

/** Layout-matching placeholder while My Pools memberships load. */
export function MyPoolsSkeleton() {
  return (
    <div
      className="bg-op-canvas mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-12"
      aria-busy="true"
      aria-label="Loading My Pools"
    >
      <div className="flex flex-col gap-2">
        <Skeleton className={`h-9 w-40 ${PLACEHOLDER}`} />
        <Skeleton className={`h-4 w-72 max-w-full ${PLACEHOLDER}`} />
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className={`h-3 w-24 ${PLACEHOLDER}`} />
        <div className="op-panel divide-y divide-op-border overflow-hidden p-0">
          {Array.from({ length: 3 }, (_, i) => (
            <div
              key={i}
              className="flex items-start justify-between gap-3 px-4 py-3.5"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Skeleton className={`h-4 w-36 ${PLACEHOLDER}`} />
                <Skeleton className={`h-3 w-48 ${PLACEHOLDER}`} />
                <Skeleton className={`h-5 w-28 rounded-[8px] ${PLACEHOLDER}`} />
              </div>
              <Skeleton
                className={`h-5 w-20 shrink-0 rounded-[8px] ${PLACEHOLDER}`}
              />
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <Skeleton className={`h-9 w-28 rounded-lg ${PLACEHOLDER}`} />
        <Skeleton className={`h-9 w-28 rounded-lg ${PLACEHOLDER}`} />
      </div>
    </div>
  );
}
