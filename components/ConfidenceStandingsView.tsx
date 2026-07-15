"use client";

import { useConvexAuth, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { TOUCH_TARGET_MIN_CLASS } from "@/lib/gameDayShell";
import { PoolShell } from "./PoolShell";

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
      <PoolShell poolId={poolId}>
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-6 py-10">
          <p className="text-sm text-op-muted">Loading standings…</p>
        </div>
      </PoolShell>
    );
  }

  if (standings === null) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-6 py-10">
        <p className="text-sm text-op-secondary">
          Standings are available only to Pool members.
        </p>
        <Link
          href="/my-pools"
          className="text-sm text-op-muted hover:text-op-text"
        >
          ← My Pools
        </Link>
      </div>
    );
  }

  return (
    <PoolShell poolId={poolId} poolName={standings.poolName}>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-8 min-[900px]:px-8">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-op-text">
            Standings
          </h1>
          <p className="text-sm text-op-secondary">
            Confidence
            {standings.poolStatus === "completed"
              ? " · Completed"
              : standings.weekSettled
                ? ` · Week ${standings.week} settled`
                : ` · Week ${standings.week}`}
          </p>
        </header>

        <div
          role="tablist"
          aria-label="Standings view"
          className="flex flex-wrap gap-2 text-sm"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === "weekly"}
            onClick={() => setTab("weekly")}
            className={
              tab === "weekly"
                ? `${TOUCH_TARGET_MIN_CLASS} rounded-md bg-op-selected px-3 font-medium text-op-selected-fg`
                : `${TOUCH_TARGET_MIN_CLASS} rounded-md border border-op-border-strong px-3 text-op-secondary`
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
                ? `${TOUCH_TARGET_MIN_CLASS} rounded-md bg-op-selected px-3 font-medium text-op-selected-fg`
                : `${TOUCH_TARGET_MIN_CLASS} rounded-md border border-op-border-strong px-3 text-op-secondary`
            }
          >
            Season Standing
          </button>
        </div>

        {tab === "weekly" && standings.projectedWeekly ? (
          <p className="text-xs text-amber-800">
            {standings.projectedWeekly.label}. {standings.projectedWeekly.note}
          </p>
        ) : null}

        {tab === "weekly" ? (
          <ul className="divide-y divide-op-border rounded-xl border border-op-border bg-op-surface px-4">
            {standings.weekly.rows.map((row) => (
              <li
                key={row.participantId}
                className="flex items-baseline justify-between gap-4 py-3"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate font-medium text-op-text">
                    {row.rank !== null ? `${row.rank}. ` : ""}
                    {row.displayName}
                    {row.isViewer ? (
                      <span className="ml-2 text-xs font-normal text-op-muted">
                        you
                      </span>
                    ) : null}
                  </span>
                  <span className="text-xs text-op-muted">
                    {row.correctPickCount} correct
                    {!standings.weekSettled
                      ? ` · ${row.possibleRemainingPoints} possible remaining`
                      : null}
                  </span>
                </div>
                <span className="shrink-0 text-sm font-medium text-op-text">
                  {row.points} pts
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="divide-y divide-op-border rounded-xl border border-op-border bg-op-surface px-4">
            {standings.season.rows.map((row) => (
              <li
                key={row.participantId}
                className="flex items-baseline justify-between gap-4 py-3"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate font-medium text-op-text">
                    {row.seasonRank !== null ? `${row.seasonRank}. ` : ""}
                    {row.displayName}
                    {row.isViewer ? (
                      <span className="ml-2 text-xs font-normal text-op-muted">
                        you
                      </span>
                    ) : null}
                  </span>
                  {row.eligibility === "winner" ? (
                    <span className="text-xs text-op-muted">
                      Confidence Winner
                    </span>
                  ) : null}
                </div>
                <span className="shrink-0 text-sm font-medium text-op-text">
                  {row.seasonPoints} pts
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PoolShell>
  );
}
