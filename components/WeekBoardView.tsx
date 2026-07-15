"use client";

import { useConvexAuth, useQuery } from "convex/react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

function formatKickoff(ms: number): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ms));
}

export function WeekBoardView({
  poolId,
  week,
}: {
  poolId: Id<"pools">;
  week?: number;
}) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const board = useQuery(
    api.pools.getWeekBoard,
    isAuthenticated
      ? { poolId, week }
      : "skip",
  );

  if (isLoading || (isAuthenticated && board === undefined)) {
    return (
      <div className="px-6 py-16 text-sm text-zinc-600 dark:text-zinc-400">
        Loading Week Board…
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="mx-auto max-w-md px-6 py-16 text-sm">
        <Link href="/sign-in" className="underline">
          Sign in
        </Link>{" "}
        to open this Pool.
      </div>
    );
  }

  if (!board) {
    return null;
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-10">
      <div className="flex flex-col gap-3">
        <Link
          href="/my-pools"
          className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          ← My Pools
        </Link>
        <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              {board.pool.name}
            </h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Week {board.week} ·{" "}
              {board.pool.type === "survivor" ? "Survivor" : "Confidence"}
              {board.pool.seasonLabel
                ? ` · Season ${board.pool.seasonLabel}`
                : null}
            </p>
          </div>
          <nav
            aria-label="Pool sections"
            className="flex flex-wrap gap-2 text-sm"
          >
            <span className="rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
              Board
            </span>
            <Link
              href={`/pools/${poolId}/standings`}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
            >
              Standings
            </Link>
            <Link
              href={`/pools/${poolId}/pool`}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
            >
              Pool
            </Link>
          </nav>
        </header>
      </div>

      <section aria-labelledby="slate-heading" className="flex flex-col gap-3">
        <h2
          id="slate-heading"
          className="text-sm font-medium uppercase tracking-wide text-zinc-500"
        >
          Week Board
        </h2>
        {board.slate.length === 0 ? (
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            No published slate for this week.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {board.slate.map((game) => (
              <li
                key={game.gameId}
                className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                  {game.awayTeam?.abbreviation ?? "?"} @{" "}
                  {game.homeTeam?.abbreviation ?? "?"}
                  <span className="mt-0.5 block text-xs font-normal text-zinc-500">
                    {game.awayTeam?.name ?? "Away"} at{" "}
                    {game.homeTeam?.name ?? "Home"}
                  </span>
                </div>
                <div className="text-xs text-zinc-500">
                  {formatKickoff(game.scheduledKickoffMs)}
                  <span className="mt-0.5 block text-zinc-400">
                    Picks locked soon — editing comes in a later ticket
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
