import type { ConvexReactClient } from "convex/react";
import {
  getFunctionName,
  type FunctionArgs,
  type FunctionReference,
} from "convex/server";
import { convexToJson, type Value } from "convex/values";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export const PREWARM_DEBOUNCE_MS = 120;
export const PREWARM_EXTEND_MS = 8_000;
export const PREWARM_DEDUPE_MS = 3_000;

export type RouteQuerySpec<Query extends FunctionReference<"query">> = {
  query: Query;
  args: FunctionArgs<Query>;
  key: string;
};

export type PoolType = "survivor" | "confidence";

export function buildQueryKey(queryName: string, args: unknown): string {
  return `${queryName}:${JSON.stringify(convexToJson(args as Value))}`;
}

export function makeRouteQuerySpec<Query extends FunctionReference<"query">>(
  query: Query,
  args: FunctionArgs<Query>,
): RouteQuerySpec<Query> {
  return {
    query,
    args,
    key: buildQueryKey(getFunctionName(query), args),
  };
}

type PrewarmSpecsOptions = {
  dedupeMs?: number;
  extendSubscriptionFor?: number;
};

const lastPrewarmedAt = new Map<string, number>();

export function prewarmSpecs(
  convex: ConvexReactClient,
  specs: RouteQuerySpec<FunctionReference<"query">>[],
  options: PrewarmSpecsOptions = {},
): void {
  const dedupeMs = options.dedupeMs ?? PREWARM_DEDUPE_MS;
  const extendSubscriptionFor =
    options.extendSubscriptionFor ?? PREWARM_EXTEND_MS;
  const now = Date.now();

  for (const spec of specs) {
    const previous = lastPrewarmedAt.get(spec.key);
    if (previous !== undefined && now - previous < dedupeMs) {
      continue;
    }

    lastPrewarmedAt.set(spec.key, now);

    try {
      convex.prewarmQuery({
        query: spec.query,
        args: spec.args,
        extendSubscriptionFor,
      });
    } catch (error) {
      // Prewarm failures should never block navigation.
      console.warn("Convex prewarm failed", {
        key: spec.key,
        error,
      });
    }
  }
}

export function resetPrewarmDedupeForTests(): void {
  lastPrewarmedAt.clear();
}

export function getMyPoolsEssentialSpecs(opts?: {
  includeArchived?: boolean;
}) {
  return [
    makeRouteQuerySpec(api.participants.myPools, {
      includeArchived: opts?.includeArchived === true,
    }),
  ];
}

export function getPoolShellEssentialSpecs(poolId: Id<"pools">) {
  return [makeRouteQuerySpec(api.pools.getPoolShell, { poolId })];
}

export function getBoardEssentialSpecs(poolId: Id<"pools">) {
  return [
    makeRouteQuerySpec(api.pools.getPoolShell, { poolId }),
    makeRouteQuerySpec(api.pools.getWeekBoard, { poolId }),
  ];
}

export function getStandingsEssentialSpecs(
  poolId: Id<"pools">,
  poolType: PoolType | null | undefined,
) {
  const shell = getPoolShellEssentialSpecs(poolId);
  if (poolType === "confidence") {
    return [
      ...shell,
      makeRouteQuerySpec(api.confidenceScoring.getConfidenceStandings, {
        poolId,
      }),
    ];
  }
  if (poolType === "survivor") {
    return [
      ...shell,
      makeRouteQuerySpec(api.survivorScoring.getSurvivorStandingsGrid, {
        poolId,
      }),
    ];
  }
  // Type unknown: warm both standings queries so either section paints warm.
  return [
    ...shell,
    makeRouteQuerySpec(api.confidenceScoring.getConfidenceStandings, {
      poolId,
    }),
    makeRouteQuerySpec(api.survivorScoring.getSurvivorStandingsGrid, {
      poolId,
    }),
  ];
}

export function getPoolPanelEssentialSpecs(poolId: Id<"pools">) {
  // Avoid nowMs-keyed queries here — wall-clock args miss the client cache.
  return [makeRouteQuerySpec(api.pools.getPoolShell, { poolId })];
}

export function getPoolSectionEssentialSpecs(
  poolId: Id<"pools">,
  section: "board" | "standings" | "pool",
  poolType?: PoolType | null,
) {
  if (section === "standings") {
    return getStandingsEssentialSpecs(poolId, poolType);
  }
  if (section === "pool") {
    return getPoolPanelEssentialSpecs(poolId);
  }
  return getBoardEssentialSpecs(poolId);
}

export function prewarmMyPools(convex: ConvexReactClient): void {
  prewarmSpecs(convex, getMyPoolsEssentialSpecs());
}

export function prewarmPoolSection(
  convex: ConvexReactClient,
  poolId: Id<"pools">,
  section: "board" | "standings" | "pool",
  poolType?: PoolType | null,
): void {
  prewarmSpecs(
    convex,
    getPoolSectionEssentialSpecs(poolId, section, poolType),
  );
}
