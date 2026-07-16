"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { uiType } from "@/lib/uiType";
import {
  InitialAvatar,
  TextLink,
  YouBadge,
} from "./standings";

type Peek = NonNullable<
  FunctionReturnType<typeof api.confidenceScoring.getConfidenceStandingsPeek>
>;

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
  const peekResult = useQuery(api.confidenceScoring.getConfidenceStandingsPeek, {
    poolId,
    week,
  });
  const [cachedPeek, setCachedPeek] = useState<Peek | null>(null);
  if (peekResult && peekResult !== cachedPeek) {
    setCachedPeek(peekResult);
  }
  // Keep prior peek mounted while the next week’s query is in flight.
  const peek =
    peekResult === null ? null : (peekResult ?? cachedPeek);

  if (peek === null) return null;

  return (
    <aside className="flex flex-col gap-4" aria-label="Weekly Standing peek">
      <h2 className={uiType.eyebrow}>Week {peek.week} Standing</h2>
      <ol className="flex flex-col gap-2.5">
        {peek.top5.map((row) => (
          <li
            key={row.participantId}
            className="flex min-w-0 items-center justify-between gap-3"
          >
            <div className="flex min-w-0 items-center gap-2">
              <InitialAvatar name={row.displayName} />
              <span className={`min-w-0 truncate ${uiType.name}`}>
                {row.rank !== null ? `${row.rank}. ` : ""}
                {row.displayName}
              </span>
              {row.isViewer ? <YouBadge /> : null}
            </div>
            <span className={`shrink-0 ${uiType.metricSm}`}>{row.points}</span>
          </li>
        ))}
      </ol>
      {peek.viewer ? (
        <div className="flex items-center justify-between gap-3 border-t border-op-border pt-3">
          <div className="flex min-w-0 items-center gap-2">
            <InitialAvatar name={peek.viewer.displayName} />
            <span className={`min-w-0 truncate ${uiType.name}`}>
              {peek.viewer.rank !== null ? `${peek.viewer.rank}. ` : ""}
              {peek.viewer.displayName}
            </span>
            <YouBadge />
          </div>
          <span className={`shrink-0 ${uiType.metricSm}`}>
            {peek.viewer.points}
          </span>
        </div>
      ) : null}
      <TextLink href={peek.standingsPath}>Full standings →</TextLink>
    </aside>
  );
}
