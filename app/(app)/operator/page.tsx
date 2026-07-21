"use client";

import { useAuth } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { OperatorIncidentsPanel } from "@/components/OperatorIncidentsPanel";
import { OperatorPageSkeleton } from "@/components/OperatorSkeleton";
import { api } from "@/convex/_generated/api";

export default function OperatorPage() {
  const { isLoaded, isSignedIn } = useAuth();
  const me = useQuery(
    api.incidents.amIProductionOperator,
    isSignedIn ? {} : "skip",
  );

  if (!isLoaded || (isSignedIn && me === undefined)) {
    return <OperatorPageSkeleton />;
  }

  if (!isSignedIn) {
    return (
      <EmptyState
        title="Sign in required"
        description="Operator Incidents are only available to the allowlisted Production Operator."
        action={
          <Link
            href="/sign-in"
            className="op-btn op-btn-primary"
          >
            Sign in
          </Link>
        }
      />
    );
  }

  if (!me?.isOperator) {
    return (
      <EmptyState
        title="Not available"
        description="Operator Incidents are only available to the allowlisted Production Operator."
        action={
          <Link
            href="/my-pools"
            className="op-btn op-btn-primary"
          >
            Back to My Pools
          </Link>
        }
      />
    );
  }

  return <OperatorIncidentsPanel />;
}
