"use client";

import { useUser } from "@clerk/nextjs";
import { InitialAvatar } from "./InitialAvatar";

/**
 * Standings avatar: stored Clerk photo, with a live fallback for the viewer
 * when their Participant row has not synced `avatarUrl` yet.
 */
export function ParticipantAvatar({
  name,
  imageUrl,
  isViewer = false,
  className = "",
}: {
  name: string;
  imageUrl?: string | null;
  isViewer?: boolean;
  className?: string;
}) {
  const { user } = useUser();
  const resolved =
    imageUrl ?? (isViewer ? (user?.imageUrl ?? null) : null);

  return (
    <InitialAvatar name={name} imageUrl={resolved} className={className} />
  );
}
