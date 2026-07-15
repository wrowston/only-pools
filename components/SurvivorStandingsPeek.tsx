"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

const ALIVE_PEEK_CAP = 8;

/**
 * Desktop context-rail peek (≥900px): alive count, short alive list, Full standings.
 * No Hidden Picks or operator chrome.
 */
export function SurvivorStandingsPeek({
  poolId,
}: {
  poolId: Id<"pools">;
}) {
  const standings = useQuery(api.survivorScoring.getSurvivorStandings, {
    poolId,
  });

  if (standings === undefined || standings === null) return null;

  const alive = standings.rows.filter(
    (r) => r.eligibility === "alive" || r.eligibility === "winner",
  );
  const shown = alive.slice(0, ALIVE_PEEK_CAP);
  const more = Math.max(0, alive.length - shown.length);

  return (
    <aside className="flex flex-col gap-3" aria-label="Survivor standing peek">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-op-muted">
        Alive
      </h2>
      <p className="text-sm text-op-text">
        <span className="font-semibold tabular-nums">{alive.length}</span>{" "}
        still Alive
      </p>
      <ul className="flex flex-col gap-2 text-sm">
        {shown.map((row) => (
          <li key={row.participantId} className="truncate text-op-text">
            {row.displayName}
            {row.isViewer ? (
              <span className="ml-1 text-xs text-op-muted">you</span>
            ) : null}
          </li>
        ))}
      </ul>
      {more > 0 ? (
        <p className="text-xs text-op-muted">+{more} more</p>
      ) : null}
      <Link
        href={`/pools/${poolId}/standings`}
        className="text-sm text-op-secondary underline-offset-2 hover:underline"
      >
        Full standings →
      </Link>
    </aside>
  );
}
