"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * Desktop context-rail peek content (Week Board only).
 * Visibility is owned by PoolShell (≥900px).
 */
export function ConfidenceStandingsPeek({
  poolId,
  week,
}: {
  poolId: Id<"pools">;
  week: number;
}) {
  const peek = useQuery(api.confidenceScoring.getConfidenceStandingsPeek, {
    poolId,
    week,
  });

  if (peek === undefined || peek === null) return null;

  return (
    <aside className="flex flex-col gap-3" aria-label="Weekly Standing peek">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-op-muted">
        Week {peek.week} Standing
      </h2>
      <ol className="flex flex-col gap-2 text-sm">
        {peek.top5.map((row) => (
          <li
            key={row.participantId}
            className="flex items-baseline justify-between gap-3"
          >
            <span className="min-w-0 truncate text-op-text">
              {row.rank !== null ? `${row.rank}. ` : ""}
              {row.displayName}
              {row.isViewer ? (
                <span className="ml-1 text-xs text-op-muted">you</span>
              ) : null}
            </span>
            <span className="shrink-0 tabular-nums text-op-secondary">
              {row.points}
            </span>
          </li>
        ))}
      </ol>
      {peek.viewer ? (
        <p className="border-t border-op-border pt-2 text-sm text-op-text">
          {peek.viewer.rank !== null ? `${peek.viewer.rank}. ` : ""}
          {peek.viewer.displayName}{" "}
          <span className="tabular-nums text-op-muted">
            {peek.viewer.points} pts
          </span>
        </p>
      ) : null}
      <Link
        href={peek.standingsPath}
        className="text-sm text-op-secondary underline-offset-2 hover:underline"
      >
        Full standings →
      </Link>
    </aside>
  );
}
