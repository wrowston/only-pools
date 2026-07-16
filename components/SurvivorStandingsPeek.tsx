"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { uiType } from "@/lib/uiType";
import {
  InitialAvatar,
  SummaryStat,
  TextLink,
  YouBadge,
} from "./standings";

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
    <aside className="flex flex-col gap-4" aria-label="Survivor standing peek">
      <h2 className={uiType.eyebrow}>Alive</h2>
      <SummaryStat value={alive.length} label="still Alive" />
      <ul className="flex flex-col gap-2.5">
        {shown.map((row) => (
          <li
            key={row.participantId}
            className="flex min-w-0 items-center gap-2"
          >
            <InitialAvatar
              name={row.displayName}
              imageUrl={row.avatarUrl}
            />
            <span className={`min-w-0 truncate ${uiType.name}`}>
              {row.displayName}
            </span>
            {row.isViewer ? <YouBadge /> : null}
          </li>
        ))}
      </ul>
      {more > 0 ? (
        <p className={uiType.meta}>+{more} more</p>
      ) : null}
      <TextLink href={`/pools/${poolId}/standings`}>
        Full standings →
      </TextLink>
    </aside>
  );
}
