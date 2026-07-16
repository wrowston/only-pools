"use client";

import { useState } from "react";

const AVATAR_PALETTES = [
  "bg-op-heat-12 text-op-selected-fg",
  "bg-[#e8e4f3] text-[#4a4568]",
  "bg-[#e4f0ea] text-[#3d5c4a]",
  "bg-[#e4ebf3] text-[#45586b]",
  "bg-[#f0ebe4] text-[#5c5040]",
  "bg-op-control text-op-secondary",
] as const;

function hashName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * Clerk photo when available; otherwise heat-tinted initial.
 */
export function InitialAvatar({
  name,
  imageUrl,
  className = "",
}: {
  name: string;
  imageUrl?: string | null;
  className?: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const initial = (name.trim().charAt(0) || "?").toUpperCase();
  const palette = AVATAR_PALETTES[hashName(name) % AVATAR_PALETTES.length];
  const showImage = Boolean(imageUrl) && imageUrl !== failedUrl;

  if (showImage && imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- Clerk CDN URLs; no next/image remotePatterns
      <img
        src={imageUrl}
        alt=""
        className={`h-7 w-7 shrink-0 rounded-[8px] object-cover ${className}`}
        aria-hidden
        onError={() => setFailedUrl(imageUrl)}
      />
    );
  }

  return (
    <span
      className={`grid h-7 w-7 shrink-0 place-items-center rounded-[8px] text-xs font-medium ${palette} ${className}`}
      aria-hidden
    >
      {initial}
    </span>
  );
}
