import { Skeleton } from "@/components/ui/skeleton";

function SlateRowSkeleton() {
  return (
    <li className="flex flex-col gap-2 px-4 py-2.5 min-[900px]:px-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-3 w-40" />
        </div>
        <Skeleton className="h-3 w-28 shrink-0" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Skeleton className="h-11 w-full rounded-[8px]" />
        <Skeleton className="h-11 w-full rounded-[8px]" />
      </div>
    </li>
  );
}

/** Slate body placeholder while a week switch is in flight. */
export function WeekBoardSlateSkeleton({
  label = "Loading week board slate",
}: {
  label?: string;
}) {
  return (
    <section
      className="flex flex-col gap-2"
      aria-busy="true"
      aria-label={label}
    >
      <Skeleton className="h-3 w-12" />
      <ul className="divide-y divide-op-border rounded-[16px] border border-op-border bg-op-surface min-[900px]:overflow-hidden">
        {Array.from({ length: 5 }, (_, i) => (
          <SlateRowSkeleton key={i} />
        ))}
      </ul>
    </section>
  );
}

/** Full-page Week Board placeholder for the initial load. */
export function WeekBoardSkeleton() {
  return (
    <div
      className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-8 min-[900px]:max-w-3xl min-[900px]:px-8"
      aria-busy="true"
      aria-label="Loading Week Board"
    >
      <header className="flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-40 min-[900px]:h-9" />
          <Skeleton className="h-4 w-56 max-w-full" />
          <Skeleton className="h-3 w-36" />
        </div>
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-8 w-10 rounded-[8px]" />
          ))}
        </div>
      </header>
      <Skeleton className="h-4 w-72 max-w-full" />
      <WeekBoardSlateSkeleton />
    </div>
  );
}
