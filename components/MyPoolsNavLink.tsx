"use client";

import Link from "next/link";
import { useConvex, useConvexAuth } from "convex/react";
import { POST_AUTH_HOME } from "@/lib/authRoutes";
import { prewarmMyPools } from "@/lib/convexRouteData";
import { useRoutePrewarmIntent } from "@/lib/useRoutePrewarmIntent";

/**
 * App-shell My Pools link that prewarms memberships on hover/focus intent.
 */
export function MyPoolsNavLink({
  className,
  children = "My Pools",
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();
  const prewarmHandlers = useRoutePrewarmIntent(() => {
    if (!isAuthenticated) return;
    prewarmMyPools(convex);
  });

  return (
    <Link href={POST_AUTH_HOME} className={className} {...prewarmHandlers}>
      {children}
    </Link>
  );
}
