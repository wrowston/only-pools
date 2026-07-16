"use client";

import { useConvexAuth, useQuery } from "convex/react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { uiType } from "@/lib/uiType";
import { EmptyState } from "./EmptyState";
import { usePoolChromeName } from "./PoolChrome";
import { SurvivorPickGrid } from "./standings";

export function SurvivorStandingsView({
  poolId,
}: {
  poolId: Id<"pools">;
}) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const standings = useQuery(
    api.survivorScoring.getSurvivorStandingsGrid,
    isAuthenticated ? { poolId } : "skip",
  );

  const currentWeek = useMemo(() => {
    if (!standings || standings.weeks.length === 0) return 1;
    for (let i = standings.weeks.length - 1; i >= 0; i--) {
      const week = standings.weeks[i]!;
      const hasLocked = standings.rows.some((row) =>
        row.cells.some((c) => c.week === week && c.locked),
      );
      if (hasLocked) return week;
    }
    return standings.weeks[standings.weeks.length - 1]!;
  }, [standings]);

  const [focusWeek, setFocusWeek] = useState<number | null>(null);
  const activeFocus = focusWeek ?? currentWeek;
  usePoolChromeName(standings?.poolName);

  if (isLoading || standings === undefined) {
    return (
      <EmptyState
        title="Loading standings"
        description="Fetching Survivor standings…"
      />
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
            className="op-btn op-btn-secondary"
          >
            Back to My Pools
          </Link>
        }
      />
    );
  }

  return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 min-[900px]:px-8">
        <header className="flex flex-col gap-1">
          <h1 className={uiType.title}>Standings</h1>
          <p className="text-sm text-op-secondary">
            Survivor
            {standings.poolStatus === "completed"
              ? ` · Completed week ${standings.completedWeek ?? "—"}`
              : ` · ${standings.aliveCount} Alive`}
            {` · Focusing Week ${activeFocus}`}
          </p>
        </header>

        {standings.rows.length === 0 ? (
          <EmptyState
            title="No standings yet"
            description="Standings appear once the Pool has members."
          />
        ) : (
          <SurvivorPickGrid
            weeks={standings.weeks}
            rows={standings.rows}
            focusWeek={activeFocus}
            currentWeek={currentWeek}
            onFocusWeek={setFocusWeek}
          />
        )}
      </div>
  );
}
