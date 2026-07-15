"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

/**
 * Single top-of-experience StatusBanner for participant-visible Operator
 * Incidents. Healthy sync → renders nothing (no last-updated chrome).
 * Polite aria-live only here and SaveTrust (scenario 47).
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
      data-live-region="incident-banner"
      className="border-b border-op-banner-border bg-op-banner-bg px-6 py-3 text-sm text-op-banner-fg"
    >
      {banner.summary}
    </div>
  );
}
