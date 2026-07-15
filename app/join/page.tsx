/**
 * Join entry point stub for ticket 01 — visible from My Pools.
 * Invite acceptance lands in a later ticket.
 */
export default function JoinPage() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-3 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Join a Pool
      </h1>
      <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
        Open a Pool Invite link from a Pool Owner or Pool Admin to join. Invite
        acceptance ships in a later ticket.
      </p>
    </div>
  );
}
