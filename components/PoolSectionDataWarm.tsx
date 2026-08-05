"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * Keeps Board / Standings / Pool section queries subscribed for the life of
 * the in-pool layout. Section pages remount on navigation, but these
 * subscriptions stay in the Convex client cache so tab switches paint warm.
 *
 * Renders nothing — side-effect subscriptions only.
 */
export function PoolSectionDataWarm({
  poolId,
  poolType,
  sessionNowMs,
  enabled,
}: {
  poolId: Id<"pools">;
  poolType: "survivor" | "confidence" | undefined;
  sessionNowMs: number;
  enabled: boolean;
}) {
  const shellArgs = enabled ? { poolId } : "skip";
  const nowArgs = enabled ? { poolId, nowMs: sessionNowMs } : "skip";

  const board = useQuery(api.pools.getWeekBoard, shellArgs);
  const myEntries = useQuery(api.pools.listMyPoolEntries, nowArgs);

  useQuery(
    api.confidenceScoring.getConfidenceStandings,
    enabled && poolType !== "survivor" ? { poolId } : "skip",
  );
  useQuery(
    api.survivorScoring.getSurvivorStandingsGrid,
    enabled && poolType !== "confidence" ? { poolId } : "skip",
  );

  // Board peek rail (different queries than full standings tabs).
  useQuery(
    api.confidenceScoring.getConfidenceStandingsPeek,
    enabled && poolType === "confidence" && board && board.week !== undefined
      ? { poolId, week: board.week }
      : "skip",
  );
  useQuery(
    api.survivorScoring.getSurvivorStandings,
    enabled && poolType === "survivor" ? { poolId } : "skip",
  );

  const members = useQuery(api.invites.listPoolMembers, nowArgs);
  useQuery(api.membershipAdmin.getOwnershipTransferStatus, shellArgs);
  useQuery(
    api.membershipAdmin.listPoolAuditEvents,
    enabled ? { poolId, limit: 20 } : "skip",
  );
  useQuery(
    api.invites.getInviteStatus,
    enabled && members?.canManageInvites && !members.archived
      ? { poolId, nowMs: sessionNowMs }
      : "skip",
  );

  const entryId = myEntries?.entries[0]?.entryId;
  const week = board?.week;
  useQuery(
    api.survivorPicks.getMySurvivorPick,
    enabled &&
      poolType === "survivor" &&
      entryId &&
      week !== undefined
      ? { poolId, week, entryId }
      : "skip",
  );
  useQuery(
    api.confidencePicks.getMyConfidencePickSet,
    enabled &&
      poolType === "confidence" &&
      entryId &&
      week !== undefined
      ? { poolId, week, entryId }
      : "skip",
  );

  return null;
}
