"use client";

import { useConvexAuth, useQuery } from "convex/react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ConfidenceStandingsView } from "./ConfidenceStandingsView";
import { SurvivorStandingsView } from "./SurvivorStandingsView";

/**
 * Routes Standings to Survivor or Confidence view by Pool Type.
 */
export function PoolStandingsView({ poolId }: { poolId: Id<"pools"> }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const board = useQuery(
    api.pools.getWeekBoard,
    isAuthenticated ? { poolId } : "skip",
  );

  if (isLoading || board === undefined) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-6 py-10">
        <p className="text-sm text-zinc-500">Loading standings…</p>
      </div>
    );
  }

  if (board === null) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-6 py-10">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Standings are available only to Pool members.
        </p>
        <Link
          href="/my-pools"
          className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          ← My Pools
        </Link>
      </div>
    );
  }

  if (board.pool.type === "confidence") {
    return <ConfidenceStandingsView poolId={poolId} />;
  }
  return <SurvivorStandingsView poolId={poolId} />;
}
