"use client";

import { useConvexAuth, useQuery } from "convex/react";
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
import { resolveKeepPrevious } from "@/lib/keepPreviousQuery";
import { PoolShell } from "./PoolShell";

export type PoolChromeShell = {
  poolId: Id<"pools">;
  name: string;
  type: "survivor" | "confidence";
  status: "active" | "completed";
};

type PoolChromeContextValue = {
  poolId: Id<"pools">;
  shell: PoolChromeShell | null | undefined;
  poolType: "survivor" | "confidence" | undefined;
  setPoolName: (name: string | undefined) => void;
  setContextRail: (rail: ReactNode) => void;
};

const PoolChromeContext = createContext<PoolChromeContextValue | null>(null);

/**
 * Persistent in-pool chrome. Lives in the pool route layout so Board /
 * Standings / Pool navigations do not remount the shell.
 * Subscribes to thin getPoolShell once for name + type across sections.
 */
export function PoolChromeProvider({
  poolId,
  children,
}: {
  poolId: string;
  children: ReactNode;
}) {
  const typedPoolId = poolId as Id<"pools">;
  const { isAuthenticated } = useConvexAuth();
  const liveShell = useQuery(
    api.pools.getPoolShell,
    isAuthenticated ? { poolId: typedPoolId } : "skip",
  );
  const { value: shell } = resolveKeepPrevious(
    `poolShell:${poolId}`,
    liveShell,
  );
  /** Optional override from section views; shell name is the default. */
  const [nameOverride, setPoolName] = useState<string | undefined>();
  const [seenPoolId, setSeenPoolId] = useState(poolId);
  if (seenPoolId !== poolId) {
    setSeenPoolId(poolId);
    setPoolName(undefined);
  }
  const [contextRail, setContextRail] = useState<ReactNode>(null);
  const poolName = nameOverride ?? shell?.name;

  const value = useMemo(
    () => ({
      poolId: typedPoolId,
      shell,
      poolType: shell?.type,
      setPoolName,
      setContextRail,
    }),
    [typedPoolId, shell],
  );

  return (
    <PoolChromeContext.Provider value={value}>
      <PoolShell
        poolId={poolId}
        poolName={poolName}
        poolType={shell?.type}
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
