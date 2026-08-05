"use client";

import { useConvex, useConvexAuth, useQuery } from "convex/react";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { prewarmInPool } from "@/lib/convexRouteData";
import { resolveKeepPrevious } from "@/lib/keepPreviousQuery";
import { PoolSectionDataWarm } from "./PoolSectionDataWarm";
import { PoolShell } from "./PoolShell";

export type PoolChromeShell = {
  poolId: Id<"pools">;
  name: string;
  type: "survivor" | "confidence";
  status: "active" | "completed";
  bannerMessage: string | null;
};

type PoolChromeContextValue = {
  poolId: Id<"pools">;
  shell: PoolChromeShell | null | undefined;
  poolType: "survivor" | "confidence" | undefined;
  /**
   * Stable wall-clock for in-pool nowMs-keyed queries so Board / Pool panel
   * share the same Convex cache entries as the layout warm subscriptions.
   */
  sessionNowMs: number;
  setPoolName: (name: string | undefined) => void;
  setContextRail: (rail: ReactNode) => void;
};

const PoolChromeContext = createContext<PoolChromeContextValue | null>(null);

/**
 * Persistent in-pool chrome. Lives in the pool route layout so Board /
 * Standings / Pool navigations do not remount the shell.
 * Subscribes to getPoolShell plus section data (via PoolSectionDataWarm) so
 * tab switches reuse live Convex subscriptions instead of cold-loading.
 */
export function PoolChromeProvider({
  poolId,
  children,
}: {
  poolId: string;
  children: ReactNode;
}) {
  const typedPoolId = poolId as Id<"pools">;
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();
  const liveShell = useQuery(
    api.pools.getPoolShell,
    isAuthenticated ? { poolId: typedPoolId } : "skip",
  );
  const { value: keptShell, isPrevious } = resolveKeepPrevious(
    `poolShell:${poolId}`,
    liveShell,
  );
  // A cached null is a prior non-member response — don't treat it as a live
  // denial while getPoolShell is still undefined (refetch / remount).
  const shell = isPrevious && keptShell === null ? undefined : keptShell;
  /** Optional override from section views; shell name is the default. */
  const [nameOverride, setPoolName] = useState<string | undefined>();
  const [sessionNowMs, setSessionNowMs] = useState(() => Date.now());
  const [seenPoolId, setSeenPoolId] = useState(poolId);
  if (seenPoolId !== poolId) {
    setSeenPoolId(poolId);
    setPoolName(undefined);
    setSessionNowMs(Date.now());
  }
  const [contextRail, setContextRail] = useState<ReactNode>(null);
  const poolName = nameOverride ?? shell?.name;

  // Kick remote prewarm as soon as auth is ready; refine when pool type resolves.
  useEffect(() => {
    if (!isAuthenticated) return;
    prewarmInPool(convex, typedPoolId, shell?.type);
  }, [convex, isAuthenticated, typedPoolId, shell?.type]);

  const value = useMemo(
    () => ({
      poolId: typedPoolId,
      shell,
      poolType: shell?.type,
      sessionNowMs,
      setPoolName,
      setContextRail,
    }),
    [typedPoolId, shell, sessionNowMs],
  );

  return (
    <PoolChromeContext.Provider value={value}>
      <PoolSectionDataWarm
        poolId={typedPoolId}
        poolType={shell?.type}
        sessionNowMs={sessionNowMs}
        enabled={isAuthenticated}
      />
      <PoolShell
        poolId={poolId}
        poolName={poolName}
        poolType={shell?.type}
        bannerMessage={shell?.bannerMessage ?? null}
        contextRail={contextRail}
      >
        {children}
      </PoolShell>
    </PoolChromeContext.Provider>
  );
}

export function usePoolChrome(): PoolChromeContextValue {
  const ctx = useContext(PoolChromeContext);
  if (!ctx) {
    throw new Error("usePoolChrome requires PoolChromeProvider");
  }
  return ctx;
}

/**
 * Optional name sync from section views when it differs from getPoolShell.
 * Shell name covers the common case; this keeps legacy callers working.
 */
export function usePoolChromeName(poolName: string | undefined) {
  const { setPoolName, shell } = usePoolChrome();
  useEffect(() => {
    if (poolName === undefined) return;
    if (poolName === shell?.name) return;
    setPoolName(poolName);
  }, [poolName, shell?.name, setPoolName]);
}
