"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

/**
 * Single top-of-experience StatusBanner for participant-visible Operator
 * Incidents. Healthy sync → renders nothing (no last-updated chrome).
 */
export function StatusBanner() {
  const banner = useQuery(api.incidents.getParticipantStatusBanner);

  if (banner === undefined || banner === null) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      data-status-banner={banner.type}
      data-incident-status={banner.status}
      className="border-b border-amber-200 bg-amber-50 px-6 py-3 text-sm text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100"
    >
      {banner.summary}
    </div>
  );
}
