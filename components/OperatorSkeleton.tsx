import { Skeleton } from "@/components/ui/skeleton";

/** Full-page placeholder while operator access is checked. */
export function OperatorPageSkeleton() {
  return (
    <div
      className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-6 py-12"
      aria-busy="true"
      aria-label="Loading operator"
    >
      <Skeleton className="h-9 w-56" />
      <Skeleton className="h-4 w-80 max-w-full" />
      <OperatorIncidentsListSkeleton />
    </div>
  );
}

/** List placeholder while operator incidents load. */
export function OperatorIncidentsListSkeleton() {
  return (
    <ul
      className="mt-4 space-y-3"
      aria-busy="true"
      aria-label="Loading incidents"
    >
      {Array.from({ length: 3 }, (_, i) => (
        <li
          key={i}
          className="flex flex-wrap items-center justify-between gap-3 border border-op-border px-3 py-2"
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-64 max-w-full" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-8 w-24 rounded-lg" />
            <Skeleton className="h-8 w-20 rounded-lg" />
          </div>
        </li>
      ))}
    </ul>
  );
}
