"use client";

import { useUser } from "@clerk/nextjs";
import posthog from "posthog-js";
import { useEffect } from "react";

/** Identify the signed-in Clerk user in PostHog for person-level analytics. */
export function PostHogUserContext() {
  const { user, isLoaded } = useUser();

  useEffect(() => {
    if (!isLoaded) return;
    if (user) {
      posthog.identify(user.id, {
        email: user.primaryEmailAddress?.emailAddress,
        name: user.fullName ?? undefined,
      });
      return;
    }
    posthog.reset();
  }, [isLoaded, user]);

  return null;
}
