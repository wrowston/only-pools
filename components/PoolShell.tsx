"use client";

import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/BrandMark";
import { OperatorNavLink } from "@/components/OperatorNavLink";
import { PoolPicker } from "@/components/PoolPicker";
import {
  COMPACT_CONTROL_CLASS,
  backHref,
  backLabel,
  poolNavItems,
  poolSectionFromPath,
  shellChromeClasses,
  type PoolSection,
} from "@/lib/gameDayShell";

function NavLink({
  href,
  label,
  active,
  variant,
}: {
  href: string;
  label: string;
  active: boolean;
  variant: "chip" | "sidebar";
}) {
  // Firecrawl nav = 32px (h-8), padding 6px, radius 8px
  const base =
    variant === "chip"
      ? `${COMPACT_CONTROL_CLASS} inline-flex items-center justify-center rounded-[8px] px-2.5 text-[13px] font-medium transition-colors`
      : `${COMPACT_CONTROL_CLASS} flex w-full items-center rounded-[8px] px-2.5 text-[13px] font-medium transition-colors`;

  const activeClass = active
    ? "bg-op-selected text-op-selected-fg"
    : "text-op-secondary hover:bg-op-control hover:text-op-text";

  if (active) {
    return (
      <span
        aria-current="page"
        className={`${base} ${activeClass}`}
        data-pool-nav={label.toLowerCase()}
      >
        {label}
      </span>
    );
  }

  return (
    <Link
      href={href}
      className={`${base} ${activeClass}`}
      data-pool-nav={label.toLowerCase()}
    >
      {label}
    </Link>
  );
}

/**
 * AppShell for in-pool surfaces: phone chips &lt;900px, desktop sidebar ≥900px.
 * Firecrawl-aligned: hairline borders, heat selected, canvas/sidebar split.
 */
export function PoolShell({
  poolId,
  poolName,
  children,
  contextRail,
}: {
  poolId: string;
  poolName?: string;
  children: ReactNode;
  /** Week Board only — Confidence/Survivor peek. Hidden below 900px. */
  contextRail?: ReactNode;
}) {
  const pathname = usePathname() ?? `/pools/${poolId}`;
  const section: PoolSection = poolSectionFromPath(pathname);
  const items = poolNavItems(poolId);
  const chrome = shellChromeClasses();
  const backTo = backHref(poolId, section);
  const backText = backLabel(section);

  return (
    <div
      className="flex min-h-0 flex-1 bg-op-canvas text-op-text"
      data-shell-breakpoint="900"
      data-pool-section={section}
    >
      <aside
        className={`${chrome.desktopSidebar} sticky top-0 h-screen w-60 shrink-0 flex-col border-r border-op-border bg-op-canvas`}
        aria-label="Pool navigation"
      >
        <div className="flex flex-col gap-1 border-b border-op-border px-3 pb-3 pt-4">
          <Link
            href="/"
            className="inline-flex h-9 items-center gap-2 rounded-[8px] px-2 text-[15px] font-medium tracking-tight text-op-text hover:bg-op-control"
          >
            <BrandMark />
            Only Pools
          </Link>
          <PoolPicker
            poolId={poolId}
            poolName={poolName}
            section={section}
            variant="sidebar"
          />
        </div>
        <nav className="flex flex-col gap-0.5 px-2 pt-3" aria-label="Pool sections">
          <p className="op-eyebrow px-2.5 pb-1.5">Play</p>
          {items.map((item) => (
            <NavLink
              key={item.section}
              href={item.href}
              label={item.label}
              active={item.section === section}
              variant="sidebar"
            />
          ))}
        </nav>
        <div className="mt-auto border-t border-op-border p-2">
          <Link
            href="/my-pools"
            className={`${COMPACT_CONTROL_CLASS} flex w-full items-center rounded-[8px] px-2.5 text-[13px] font-medium text-op-secondary hover:bg-op-control hover:text-op-text`}
          >
            My Pools
          </Link>
          <OperatorNavLink variant="sidebar" />
          <div className="flex items-center gap-2 px-2.5 py-1.5">
            <UserButton />
            <span className="text-xs text-op-muted">Account</span>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div
          className={`${chrome.mobileChips} flex-col gap-2 border-b border-op-border bg-op-surface px-4 py-2.5`}
        >
          <Link
            href={backTo}
            className={`${COMPACT_CONTROL_CLASS} inline-flex items-center text-[13px] font-medium text-op-secondary hover:text-op-text`}
          >
            ← {backText}
          </Link>
          <PoolPicker
            poolId={poolId}
            poolName={poolName}
            section={section}
            variant="mobile"
          />
          <nav
            aria-label="Pool sections"
            className="flex flex-wrap gap-2"
            data-shell-chrome="mobile-chips"
          >
            {items.map((item) => (
              <NavLink
                key={item.section}
                href={item.href}
                label={item.label}
                active={item.section === section}
                variant="chip"
              />
            ))}
          </nav>
        </div>

        <div className="flex min-w-0 flex-1 gap-0">
          <div className="min-w-0 flex-1">{children}</div>
          {contextRail ? (
            <div
              className={`${chrome.contextRail} w-56 shrink-0 flex-col border-l border-op-border bg-op-canvas p-5`}
              data-shell-chrome="context-rail"
            >
              {contextRail}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
