import { Skeleton } from "@/components/ui/skeleton";

/** Layout-matching placeholder while Pool standings load. */
export function StandingsSkeleton() {
  return (
    <div
      className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-8 min-[900px]:max-w-6xl min-[900px]:px-8 min-[900px]:py-10"
      aria-busy="true"
      aria-label="Loading standings"
    >
      <header className="flex flex-col gap-2">
        <Skeleton className="h-8 w-36 min-[900px]:h-9" />
        <Skeleton className="h-4 w-48 max-w-full" />
        <Skeleton className="h-3 w-32" />
      </header>
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-10 rounded-[8px]" />
        ))}
      </div>
      <div className="overflow-hidden rounded-[16px] border border-op-border bg-op-surface">
        <div className="flex items-center justify-between gap-4 bg-op-control px-4 py-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-14" />
        </div>
        <ul className="divide-y divide-op-border">
          {Array.from({ length: 6 }, (_, i) => (
            <li
              key={i}
              className="flex items-center justify-between gap-4 px-4 py-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <Skeleton className="size-8 shrink-0 rounded-full" />
                <div className="flex min-w-0 flex-col gap-1.5">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
              <Skeleton className="h-4 w-12 shrink-0" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Compact desktop-rail placeholder while standings peeks load. */
export function StandingsPeekSkeleton({
  label = "Loading standings peek",
}: {
  label?: string;
}) {
  return (
    <aside
      className="flex flex-col gap-4"
      aria-busy="true"
      aria-label={label}
    >
      <Skeleton className="h-3 w-16" />
      <div className="flex flex-col gap-1">
        <Skeleton className="h-8 w-10" />
        <Skeleton className="h-3 w-20" />
      </div>
      <ul className="flex flex-col gap-2.5">
        {Array.from({ length: 5 }, (_, i) => (
          <li key={i} className="flex min-w-0 items-center gap-2">
            <Skeleton className="size-7 shrink-0 rounded-full" />
            <Skeleton className="h-3.5 w-24" />
          </li>
        ))}
      </ul>
      <Skeleton className="h-3 w-28" />
    </aside>
  );
}
