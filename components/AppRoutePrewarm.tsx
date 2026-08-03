"use client";

import { useConvex, useConvexAuth } from "convex/react";
import { useEffect } from "react";
import { prewarmMyPools } from "@/lib/convexRouteData";

/**
 * Once Convex auth is ready in the app shell, warm My Pools so the first
 * navigation from any product page (or post-landing) rarely shows a skeleton.
 */
export function AppRoutePrewarm() {
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();

  useEffect(() => {
    if (!isAuthenticated) return;
    prewarmMyPools(convex);
  }, [convex, isAuthenticated]);

  return null;
}
