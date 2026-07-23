"use client";

import { useConvexAuth, useQuery } from "convex/react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { uiType } from "@/lib/uiType";
import { EmptyState } from "./EmptyState";
import { usePoolChromeName } from "./PoolChrome";
import { StandingsSkeleton } from "./StandingsSkeleton";
import {
  SurvivorPickGrid,
  SurvivorWeekBreakdown,
  WeekChips,
} from "./standings";

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
    // Prefer the earliest week that still has an unlocked authored pick —
    // that is the live board week once prior weeks have locked.
    for (const week of standings.weeks) {
      const hasOpenPick = standings.rows.some((row) =>
        row.cells.some(
          (c) => c.week === week && c.hasPick && !c.locked,
        ),
      );
      if (hasOpenPick) return week;
    }
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
    return <StandingsSkeleton />;
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
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 min-[900px]:max-w-none min-[900px]:px-8 min-[900px]:py-10">
        <header className="flex flex-col gap-1">
          <h1 className={`${uiType.title} min-[900px]:text-3xl`}>Standings</h1>
          <p className="text-sm text-op-secondary min-[900px]:text-[15px]">
            Survivor
            {standings.poolStatus === "completed"
              ? ` · Completed week ${standings.completedWeek ?? "—"}`
              : ` · ${standings.aliveCount} Alive`}
            {` · Focusing Week ${activeFocus}`}
          </p>
          <Link href="/guides/standings-and-results" className="text-xs font-medium text-op-selected-fg underline underline-offset-4">
            Understand standings
          </Link>
        </header>

        {standings.rows.length === 0 ? (
          <EmptyState
            title="No standings yet"
            description="Standings appear once the Pool has members."
          />
        ) : (
          <div className="flex flex-col gap-4">
            <WeekChips
              weeks={standings.weeks}
              value={activeFocus}
              onChange={setFocusWeek}
              currentWeek={currentWeek}
              ariaLabel="Standings week"
            />
            <SurvivorWeekBreakdown
              week={activeFocus}
              rows={standings.rows}
            />
            <div className="mt-1 flex items-end justify-between gap-4">
              <div>
                <p className={uiType.eyebrow}>Entry history</p>
                <h2 className="mt-1 text-lg font-medium tracking-tight text-op-text">
                  Pool standings
                </h2>
              </div>
              <p className="text-xs text-op-muted">Week {activeFocus} highlighted</p>
            </div>
            <SurvivorPickGrid
              weeks={standings.weeks}
              rows={standings.rows}
              focusWeek={activeFocus}
              currentWeek={currentWeek}
              onFocusWeek={setFocusWeek}
            />
          </div>
        )}
      </div>
  );
}
