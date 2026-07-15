"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * Desktop context-rail peek (≥900px): top 5 Weekly Standing + current user + link.
 * No Hidden Picks or operator chrome.
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
    <aside
      className="hidden w-56 shrink-0 flex-col gap-3 border-l border-zinc-200 pl-5 min-[900px]:flex dark:border-zinc-800"
      aria-label="Weekly Standing peek"
    >
      <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Week {peek.week} Standing
      </h2>
      <ol className="flex flex-col gap-2 text-sm">
        {peek.top5.map((row) => (
          <li
            key={row.participantId}
            className="flex items-baseline justify-between gap-3"
          >
            <span className="min-w-0 truncate text-zinc-800 dark:text-zinc-200">
              {row.rank !== null ? `${row.rank}. ` : ""}
              {row.displayName}
              {row.isViewer ? (
                <span className="ml-1 text-xs text-zinc-500">you</span>
              ) : null}
            </span>
            <span className="shrink-0 tabular-nums text-zinc-600 dark:text-zinc-400">
              {row.points}
            </span>
          </li>
        ))}
      </ol>
      {peek.viewer ? (
        <p className="border-t border-zinc-200 pt-2 text-sm text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">
          {peek.viewer.rank !== null ? `${peek.viewer.rank}. ` : ""}
          {peek.viewer.displayName}{" "}
          <span className="tabular-nums text-zinc-500">
            {peek.viewer.points} pts
          </span>
        </p>
      ) : null}
      <Link
        href={peek.standingsPath}
        className="text-sm text-zinc-600 underline-offset-2 hover:underline dark:text-zinc-400"
      >
        Full standings →
      </Link>
    </aside>
  );
}
