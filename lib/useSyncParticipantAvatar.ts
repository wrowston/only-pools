"use client";

import { useUser } from "@clerk/nextjs";
import { useConvexAuth, useMutation } from "convex/react";
import { useEffect, useRef } from "react";
import { api } from "@/convex/_generated/api";

/**
 * Persist Clerk `user.imageUrl` onto the Participant row.
 * Does not rely on JWT `picture` claims (Convex integration template is often locked).
 */
export function useSyncParticipantAvatar() {
  const { isAuthenticated } = useConvexAuth();
  const { user, isLoaded } = useUser();
  const ensureMyParticipant = useMutation(api.participants.ensureMyParticipant);
  const lastSyncedUrl = useRef<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated || !isLoaded) return;
    const avatarUrl = user?.imageUrl;
    if (!avatarUrl || lastSyncedUrl.current === avatarUrl) return;

    let cancelled = false;
    void (async () => {
      try {
        await ensureMyParticipant({ avatarUrl });
        if (!cancelled) lastSyncedUrl.current = avatarUrl;
      } catch {
        // Establish/sync failures surface elsewhere (My Pools gate).
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, isLoaded, user?.imageUrl, ensureMyParticipant]);
}
