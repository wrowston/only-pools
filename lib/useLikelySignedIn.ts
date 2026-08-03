"use client";

import { useAuth } from "@clerk/nextjs";
import { useSyncExternalStore } from "react";
import { hasClerkSessionCookie } from "@/lib/clerkSessionHint";

const subscribeNoop = () => () => {};

/**
 * Prefer Clerk once loaded; while loading, paint from the session cookie so
 * signed-in CTAs (e.g. My Pools) appear without waiting on network auth.
 */
export function useLikelySignedIn(): boolean {
  const { isLoaded, isSignedIn } = useAuth();
  const cookieHint = useSyncExternalStore(
    subscribeNoop,
    hasClerkSessionCookie,
    () => false,
  );

  if (isLoaded) {
    return Boolean(isSignedIn);
  }
  return cookieHint;
}
