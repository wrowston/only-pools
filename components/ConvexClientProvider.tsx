"use client";

import { useAuth } from "@clerk/nextjs";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { ReactNode, useCallback, useMemo, useRef } from "react";
import { clearKeepPreviousQuery } from "@/lib/keepPreviousQuery";

/**
 * Clerk's Convex integration sets session token `aud` to "convex".
 * ConvexProviderWithClerk then calls getToken() *without* the JWT template,
 * so custom claims (email, phone_number) never appear.
 *
 * Always request the named "convex" JWT template so those claims are present.
 */
function useAuthWithConvexJwtTemplate() {
  const auth = useAuth();
  const getToken = useCallback(
    async (options: { template?: string; skipCache?: boolean } = {}) => {
      return auth.getToken({
        ...options,
        template: "convex",
      });
    },
    [auth],
  );

  return {
    isLoaded: auth.isLoaded,
    isSignedIn: auth.isSignedIn,
    getToken,
    orgId: auth.orgId,
    orgRole: auth.orgRole,
    sessionId: auth.sessionId,
    sessionClaims: auth.sessionClaims,
  };
}

/**
 * Clears keep-previous query cache when the signed-in Clerk user changes.
 * Runs during render (before children) so skipped/loading queries cannot
 * resurface the previous account's memberships or standings.
 */
function KeepPreviousAuthBoundary({ children }: { children: ReactNode }) {
  const { isLoaded, userId } = useAuth();
  const seenUserIdRef = useRef<string | null | undefined>(undefined);

  if (isLoaded) {
    const next = userId ?? null;
    if (seenUserIdRef.current === undefined) {
      seenUserIdRef.current = next;
    } else if (seenUserIdRef.current !== next) {
      clearKeepPreviousQuery();
      seenUserIdRef.current = next;
    }
  }

  return children;
}

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  }

  const client = useMemo(() => new ConvexReactClient(convexUrl), [convexUrl]);

  return (
    <ConvexProviderWithClerk
      client={client}
      useAuth={useAuthWithConvexJwtTemplate}
    >
      <KeepPreviousAuthBoundary>{children}</KeepPreviousAuthBoundary>
    </ConvexProviderWithClerk>
  );
}
