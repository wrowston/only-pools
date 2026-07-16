/**
 * Settled responsive game-day shell contract helpers (ticket 14 / spec issue 20).
 * Hard switch at 900px; My Pools → Week Board primary; Standings/Pool secondary.
 */

export const SHELL_BREAKPOINT_PX = 900;

/** Tailwind min-h-11 / min-w-11 = 2.75rem = 44px — pick actions only. */
export const TOUCH_TARGET_MIN_CLASS = "min-h-11 min-w-11";

/**
 * Firecrawl chrome control height: nav links / chips / tabs = 32px (h-8).
 * Measured on firecrawl.dev header: Products, Sign up, etc.
 */
export const COMPACT_CONTROL_CLASS = "h-8";

export const SHELL_BREAKPOINT_CLASS = "min-[900px]:";

/** Polite aria-live is allowed only on these production surfaces. */
export const LIVE_REGION_ALLOWLIST = ["SaveTrust", "StatusBanner"] as const;

export type PoolSection = "board" | "standings" | "pool";

export type PoolNavItem = {
  section: PoolSection;
  href: string;
  label: string;
  /** Board is primary; Standings/Pool are secondary chips. */
  primary: boolean;
};

export function poolSectionFromPath(pathname: string): PoolSection {
  // Match section suffixes only — "/pools/x" must not match "/pool".
  if (/\/standings\/?$/.test(pathname)) return "standings";
  if (/\/pool\/?$/.test(pathname)) return "pool";
  return "board";
}

export function poolNavItems(poolId: string): readonly PoolNavItem[] {
  return [
    {
      section: "board",
      href: `/pools/${poolId}`,
      label: "Board",
      primary: true,
    },
    {
      section: "standings",
      href: `/pools/${poolId}/standings`,
      label: "Standings",
      primary: false,
    },
    {
      section: "pool",
      href: `/pools/${poolId}/pool`,
      label: "Pool",
      primary: false,
    },
  ] as const;
}

/** Same in-pool section on another Pool (picker preserves Board / Standings / Pool). */
export function poolSectionHref(
  poolId: string,
  section: PoolSection,
): string {
  if (section === "standings") return `/pools/${poolId}/standings`;
  if (section === "pool") return `/pools/${poolId}/pool`;
  return `/pools/${poolId}`;
}

export function backHref(poolId: string, section: PoolSection): string {
  return section === "board" ? "/my-pools" : `/pools/${poolId}`;
}

export function backLabel(section: PoolSection): string {
  return section === "board" ? "My Pools" : "Week Board";
}

/**
 * Desktop (≥900px) shows sidebar; phone shows chips. Same hierarchy either way.
 */
export function shellChromeClasses(): {
  mobileChips: string;
  desktopSidebar: string;
  contextRail: string;
} {
  return {
    mobileChips: "flex min-[900px]:hidden",
    desktopSidebar: "hidden min-[900px]:flex",
    contextRail: "hidden min-[900px]:flex",
  };
}
