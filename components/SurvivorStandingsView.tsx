"use client";

import { useConvexAuth, useQuery } from "convex/react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { PoolShell } from "./PoolShell";
import { EmptyState } from "./EmptyState";

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
      <PoolShell poolId={poolId}>
        <EmptyState
          title="Loading standings"
          description="Fetching Survivor standings…"
        />
      </PoolShell>
    );
  }

  if (standings === null) {
    return (
      <EmptyState
        title="Standings unavailable"
        description="Standings are available only to Pool members."
        action={
          <Link
            href="/my-pools"
            className="rounded-md border border-op-border-strong px-4 py-2.5 text-sm font-medium text-op-text"
          >
            Back to My Pools
          </Link>
        }
      />
    );
  }

  const aliveCount = standings.rows.filter(
    (r) => r.eligibility === "alive" || r.eligibility === "winner",
  ).length;

  return (
    <PoolShell poolId={poolId} poolName={standings.poolName}>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-8 min-[900px]:px-8">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-op-text">
            Standings
          </h1>
          <p className="text-sm text-op-secondary">
            Survivor
            {standings.poolStatus === "completed"
              ? ` · Completed week ${standings.completedWeek ?? "—"}`
              : ` · ${aliveCount} Alive`}
          </p>
        </header>

        {standings.rows.length === 0 ? (
          <EmptyState
            title="No standings yet"
            description="Standings appear after Verified Results are scored for this Pool."
          />
        ) : (
          <ul className="divide-y divide-op-border rounded-xl border border-op-border bg-op-surface px-4">
            {standings.rows.map((row) => (
              <li
                key={row.participantId}
                className="flex items-baseline justify-between gap-4 py-3"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate font-medium text-op-text">
                    {row.displayName}
                    {row.isViewer ? (
                      <span className="ml-2 text-xs font-normal text-op-muted">
                        you
                      </span>
                    ) : null}
                  </span>
                  <span className="text-xs text-op-muted">
                    {weekContext(row)}
                  </span>
                </div>
                <span
                  className={
                    row.eligibility === "alive" || row.eligibility === "winner"
                      ? "shrink-0 text-sm font-medium text-op-text"
                      : "shrink-0 text-sm text-op-muted"
                  }
                >
                  {eligibilityLabel(row.eligibility)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PoolShell>
  );
}
