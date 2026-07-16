"use client";

import { useState } from "react";

export type TeamLogoSize = "xs" | "sm" | "md" | "lg";

const SIZE_STYLES: Record<
  TeamLogoSize,
  { box: string; fallback: string; pixels: number }
> = {
  xs: { box: "h-5 w-5", fallback: "text-[7px]", pixels: 20 },
  sm: { box: "h-7 w-7", fallback: "text-[9px]", pixels: 28 },
  md: { box: "h-9 w-9", fallback: "text-[10px]", pixels: 36 },
  lg: { box: "h-11 w-11", fallback: "text-xs", pixels: 44 },
};

function previewUrl(url: string, size: TeamLogoSize): string {
  const base = url.replace(/\/(?:medium|small|tiny)\/?$/, "");
  return `${base}/${size === "lg" ? "small" : "tiny"}`;
}

/**
 * NFL team mark with a compact abbreviation fallback. The image is decorative;
 * callers keep the accessible team name on the surrounding control or text.
 */
export function TeamLogo({
  logoUrl,
  abbreviation,
  size = "sm",
  className = "",
}: {
  logoUrl?: string | null;
  abbreviation: string;
  size?: TeamLogoSize;
  className?: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const styles = SIZE_STYLES[size];
  const showImage = Boolean(logoUrl && failedUrl !== logoUrl);

  return (
    <span
      className={[
        "relative inline-grid shrink-0 place-items-center overflow-hidden rounded-lg",
        styles.box,
        showImage
          ? "bg-transparent"
          : "border border-op-border-strong bg-op-control text-op-secondary",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      aria-hidden="true"
    >
      {showImage && logoUrl ? (
        // TheSportsDB already serves this at /tiny or /small; a native image
        // avoids routing an already-resized asset through another optimizer.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={previewUrl(logoUrl, size)}
          alt=""
          width={styles.pixels}
          height={styles.pixels}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-contain drop-shadow-[0_1px_1px_rgb(38_38_38_/_0.12)]"
          onError={() => setFailedUrl(logoUrl)}
        />
      ) : (
        <span
          className={`font-semibold leading-none tracking-[0.02em] ${styles.fallback}`}
        >
          {abbreviation.slice(0, 3)}
        </span>
      )}
    </span>
  );
}
