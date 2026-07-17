"use client";

import { useUser } from "@clerk/nextjs";
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/** Bind the signed-in Clerk user to Sentry for error attribution. */
export function SentryUserContext() {
  const { user, isLoaded } = useUser();

  useEffect(() => {
    if (!isLoaded) return;
    if (user) {
      Sentry.setUser({
        id: user.id,
        email: user.primaryEmailAddress?.emailAddress,
        username: user.username ?? undefined,
      });
      return;
    }
    Sentry.setUser(null);
  }, [isLoaded, user]);

  return null;
}
