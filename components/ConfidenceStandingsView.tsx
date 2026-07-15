"use client";

import { useConvexAuth, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export function ConfidenceStandingsView({
  poolId,
}: {
  poolId: Id<"pools">;
}) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const [tab, setTab] = useState<"weekly" | "season">("weekly");
  const standings = useQuery(
    api.confidenceScoring.getConfidenceStandings,
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

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-10">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {standings.poolName}
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Confidence Standings
            {standings.poolStatus === "completed"
              ? " · Completed"
              : standings.weekSettled
                ? ` · Week ${standings.week} settled`
                : ` · Week ${standings.week}`}
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

      <div
        role="tablist"
        aria-label="Standings view"
        className="flex gap-2 text-sm"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === "weekly"}
          onClick={() => setTab("weekly")}
          className={
            tab === "weekly"
              ? "rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "rounded-md border border-zinc-300 px-3 py-1.5 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
          }
        >
          Weekly Standing
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "season"}
          onClick={() => setTab("season")}
          className={
            tab === "season"
              ? "rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "rounded-md border border-zinc-300 px-3 py-1.5 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
          }
        >
          Season Standing
        </button>
      </div>

      {tab === "weekly" && standings.projectedWeekly ? (
        <p className="text-xs text-amber-800 dark:text-amber-200">
          {standings.projectedWeekly.label}. {standings.projectedWeekly.note}
        </p>
      ) : null}

      {tab === "weekly" ? (
        <ul className="divide-y divide-zinc-200 border-y border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {standings.weekly.rows.map((row) => (
            <li
              key={row.participantId}
              className="flex items-baseline justify-between gap-4 py-3"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate font-medium text-zinc-900 dark:text-zinc-50">
                  {row.rank !== null ? `${row.rank}. ` : ""}
                  {row.displayName}
                  {row.isViewer ? (
                    <span className="ml-2 text-xs font-normal text-zinc-500">
                      you
                    </span>
                  ) : null}
                </span>
                <span className="text-xs text-zinc-500">
                  {row.correctPickCount} correct
                  {!standings.weekSettled
                    ? ` · ${row.possibleRemainingPoints} possible remaining`
                    : null}
                </span>
              </div>
              <span className="shrink-0 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {row.points} pts
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="divide-y divide-zinc-200 border-y border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {standings.season.rows.map((row) => (
            <li
              key={row.participantId}
              className="flex items-baseline justify-between gap-4 py-3"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate font-medium text-zinc-900 dark:text-zinc-50">
                  {row.seasonRank !== null ? `${row.seasonRank}. ` : ""}
                  {row.displayName}
                  {row.isViewer ? (
                    <span className="ml-2 text-xs font-normal text-zinc-500">
                      you
                    </span>
                  ) : null}
                </span>
                {row.eligibility === "winner" ? (
                  <span className="text-xs text-zinc-500">Confidence Winner</span>
                ) : null}
              </div>
              <span className="shrink-0 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {row.seasonPoints} pts
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
