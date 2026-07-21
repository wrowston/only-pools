"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { PoolShell } from "./PoolShell";

type PoolChromeContextValue = {
  setPoolName: (name: string | undefined) => void;
  setContextRail: (rail: ReactNode) => void;
};

const PoolChromeContext = createContext<PoolChromeContextValue | null>(null);

/**
 * Persistent in-pool chrome. Lives in the pool route layout so Board /
 * Standings / Pool navigations do not remount the shell.
 */
export function PoolChromeProvider({
  poolId,
  children,
}: {
  poolId: string;
  children: ReactNode;
}) {
  const [poolName, setPoolName] = useState<string | undefined>();
  const [contextRail, setContextRail] = useState<ReactNode>(null);
  const value = useMemo(
    () => ({ setPoolName, setContextRail }),
    [],
  );

  return (
    <PoolChromeContext.Provider value={value}>
      <PoolShell
        poolId={poolId}
        poolName={poolName}
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

/** Sync pool display name into the persistent shell. */
export function usePoolChromeName(poolName: string | undefined) {
  const { setPoolName } = usePoolChrome();
  useEffect(() => {
    // Keep the prior name while a route's query is still loading so the
    // persistent shell does not clear/re-render on every Board ↔ Standings switch.
    if (poolName === undefined) return;
    setPoolName(poolName);
  }, [poolName, setPoolName]);
}
