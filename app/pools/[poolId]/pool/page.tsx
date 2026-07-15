import Link from "next/link";

export default async function PoolDetailsStubPage({
  params,
}: {
  params: Promise<{ poolId: string }>;
}) {
  const { poolId } = await params;
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-6 py-10">
      <Link
        href={`/pools/${poolId}`}
        className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
      >
        ← Week Board
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Pool
      </h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Pool rules and membership management arrive in later tickets.
      </p>
    </div>
  );
}
