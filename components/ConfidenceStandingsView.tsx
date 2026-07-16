"use client";

import { useConvexAuth, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { uiType } from "@/lib/uiType";
import { EmptyState } from "./EmptyState";
import { usePoolChromeName } from "./PoolChrome";
import {
  ParticipantAvatar,
  SegmentedControl,
  YouBadge,
} from "./standings";

const STANDINGS_TABS = [
  { value: "weekly" as const, label: "Weekly Standing" },
  { value: "season" as const, label: "Season Standing" },
];

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
  usePoolChromeName(standings?.poolName);

  if (isLoading || standings === undefined) {
    return (
      <EmptyState
        title="Loading standings"
        description="Fetching Confidence standings…"
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
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-8 min-[900px]:px-8">
        <header className="flex flex-col gap-1">
          <h1 className={uiType.title}>Standings</h1>
          <p className="text-sm text-op-secondary">
            Confidence
            {standings.poolStatus === "completed"
              ? " · Completed"
              : standings.weekSettled
                ? ` · Week ${standings.week} settled`
                : ` · Week ${standings.week}`}
          </p>
        </header>

        <SegmentedControl
          options={STANDINGS_TABS}
          value={tab}
          onChange={setTab}
          ariaLabel="Standings view"
        />

        {tab === "weekly" && standings.projectedWeekly ? (
          <p className="rounded-md border border-op-banner-border bg-op-banner-bg px-3 py-2 text-xs text-op-banner-fg">
            {standings.projectedWeekly.label}. {standings.projectedWeekly.note}
          </p>
        ) : null}

        {/* Keep both panels mounted so tab switches don't remount the list tree. */}
        <div hidden={tab !== "weekly"}>
          {standings.weekly.rows.length === 0 ? (
            <EmptyState
              title="No weekly standings yet"
              description="Weekly standings appear as Verified Results are scored for this week."
            />
          ) : (
            <div className="overflow-hidden rounded-[16px] border border-op-border bg-op-surface">
              <div className="flex items-center justify-between gap-4 bg-op-control px-4 py-2">
                <span className={uiType.eyebrow}>Player</span>
                <span className={uiType.eyebrow}>Points</span>
              </div>
              <ul className="divide-y divide-op-border">
                {standings.weekly.rows.map((row) => (
                  <li
                    key={row.participantId}
                    className={[
                      "flex items-center justify-between gap-4 px-4 py-3",
                      row.isViewer ? "bg-op-selected" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <ParticipantAvatar
                        name={row.displayName}
                        imageUrl={row.avatarUrl}
                        isViewer={row.isViewer}
                      />
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span
                          className={`flex min-w-0 items-center truncate ${uiType.name}`}
                        >
                          <span className="truncate">
                            {row.rank !== null ? `${row.rank}. ` : ""}
                            {row.displayName}
                          </span>
                          {row.isViewer ? <YouBadge /> : null}
                        </span>
                        <span className={uiType.meta}>
                          {row.correctPickCount} correct
                          {!standings.weekSettled
                            ? ` · ${row.possibleRemainingPoints} possible remaining`
                            : null}
                        </span>
                      </div>
                    </div>
                    <span className={`shrink-0 ${uiType.metricSm}`}>
                      {row.points} pts
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div hidden={tab !== "season"}>
          {standings.season.rows.length === 0 ? (
            <EmptyState
              title="No season standings yet"
              description="Season standings advance only after a Pool Week fully resolves."
            />
          ) : (
            <div className="overflow-hidden rounded-[16px] border border-op-border bg-op-surface">
              <div className="grid grid-cols-[minmax(0,1fr)_2.5rem_2.5rem_4.5rem] items-center gap-2 bg-op-control px-4 py-2">
                <span className={uiType.eyebrow}>Player</span>
                <span className={`text-right ${uiType.eyebrow}`}>W</span>
                <span className={`text-right ${uiType.eyebrow}`}>L</span>
                <span className={`text-right ${uiType.eyebrow}`}>Points</span>
              </div>
              <ul className="divide-y divide-op-border">
                {standings.season.rows.map((row) => (
                  <li
                    key={row.participantId}
                    className={[
                      "grid grid-cols-[minmax(0,1fr)_2.5rem_2.5rem_4.5rem] items-center gap-2 px-4 py-3",
                      row.isViewer ? "bg-op-selected" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <ParticipantAvatar
                        name={row.displayName}
                        imageUrl={row.avatarUrl}
                        isViewer={row.isViewer}
                      />
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span
                          className={`flex min-w-0 items-center truncate ${uiType.name}`}
                        >
                          <span className="truncate">
                            {row.seasonRank !== null
                              ? `${row.seasonRank}. `
                              : ""}
                            {row.displayName}
                          </span>
                          {row.isViewer ? <YouBadge /> : null}
                        </span>
                        {row.eligibility === "winner" ? (
                          <span className={uiType.meta}>Confidence Winner</span>
                        ) : null}
                      </div>
                    </div>
                    <span
                      className={`text-right tabular-nums text-sm text-op-text`}
                    >
                      {row.wins}
                    </span>
                    <span
                      className={`text-right tabular-nums text-sm text-op-text`}
                    >
                      {row.losses}
                    </span>
                    <span className={`text-right ${uiType.metricSm}`}>
                      {row.seasonPoints} pts
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
  );
}
