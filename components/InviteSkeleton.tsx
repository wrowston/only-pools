import { Skeleton } from "@/components/ui/skeleton";

/** Layout-matching placeholder while an invite preview loads. */
export function InviteSkeleton({
  label = "Loading invite",
}: {
  label?: string;
}) {
  return (
    <div
      className="mx-auto flex w-full max-w-md flex-col gap-5 px-6 py-16"
      aria-busy="true"
      aria-label={label}
    >
      <Skeleton className="h-8 w-52 max-w-full" />
      <Skeleton className="h-4 w-40" />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-16 w-full rounded-md" />
        <Skeleton className="h-10 w-full rounded-lg" />
      </div>
      <Skeleton className="h-4 w-36" />
    </div>
  );
}
