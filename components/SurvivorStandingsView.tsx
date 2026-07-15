"use client";

import { useConvexAuth, useQuery } from "convex/react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

function eligibilityLabel(eligibility: string): string {
  if (eligibility === "alive") return "Alive";
  if (eligibility === "winner") return "Winner";
  return "Eliminated";
}

function weekContext(row: {
  eligibility: string;
  eliminatedWeek: number | null;
  eliminationReason: string | null;
  wonAtWeek: number | null;
}): string {
  if (row.eligibility === "winner" && row.wonAtWeek !== null) {
    if (row.eliminationReason) {
      return `Joint winner · Week ${row.wonAtWeek} (${row.eliminationReason.replace("_", " ")})`;
    }
    return `Winner · Week ${row.wonAtWeek}`;
  }
  if (row.eligibility === "eliminated" && row.eliminatedWeek !== null) {
    const reason = row.eliminationReason?.replace("_", " ") ?? "eliminated";
    return `Week ${row.eliminatedWeek} · ${reason}`;
  }
  return "Still Alive";
}

export function SurvivorStandingsView({
  poolId,
}: {
  poolId: Id<"pools">;
}) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const standings = useQuery(
    api.survivorScoring.getSurvivorStandings,
    isAuthenticated ? { poolId } : "skip",
  );

  if (isLoading || standings === undefined) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-6 py-10">
        <p className="text-sm text-zinc-500">Loading standings…</p>
      </div>
    );
  }

  if (standings === null) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-6 py-10">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Standings are available only to Pool members.
        </p>
        <Link
          href="/my-pools"
          className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          ← My Pools
        </Link>
      </div>
    );
  }

  const aliveCount = standings.rows.filter(
    (r) => r.eligibility === "alive" || r.eligibility === "winner",
  ).length;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-10">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {standings.poolName}
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Survivor Standings
            {standings.poolStatus === "completed"
              ? ` · Completed week ${standings.completedWeek ?? "—"}`
              : ` · ${aliveCount} Alive`}
          </p>
        </div>
        <nav
          aria-label="Pool sections"
          className="flex flex-wrap gap-2 text-sm"
        >
          <Link
            href={`/pools/${poolId}`}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
          >
            Board
          </Link>
          <span className="rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
            Standings
          </span>
          <Link
            href={`/pools/${poolId}/pool`}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
          >
            Pool
          </Link>
        </nav>
      </header>

      <ul className="divide-y divide-zinc-200 border-y border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {standings.rows.map((row) => (
          <li
            key={row.participantId}
            className="flex items-baseline justify-between gap-4 py-3"
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate font-medium text-zinc-900 dark:text-zinc-50">
                {row.displayName}
                {row.isViewer ? (
                  <span className="ml-2 text-xs font-normal text-zinc-500">
                    you
                  </span>
                ) : null}
              </span>
              <span className="text-xs text-zinc-500">
                {weekContext(row)}
              </span>
            </div>
            <span
              className={
                row.eligibility === "alive" || row.eligibility === "winner"
                  ? "shrink-0 text-sm font-medium text-zinc-900 dark:text-zinc-100"
                  : "shrink-0 text-sm text-zinc-500"
              }
            >
              {eligibilityLabel(row.eligibility)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
