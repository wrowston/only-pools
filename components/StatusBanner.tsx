"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { StatusBannerMessage } from "./StatusBannerMessage";

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

  return <StatusBannerMessage banner={banner} />;
}
