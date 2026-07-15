"use client";

import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  TOUCH_TARGET_MIN_CLASS,
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
  const base =
    variant === "chip"
      ? `${TOUCH_TARGET_MIN_CLASS} inline-flex items-center justify-center rounded-md px-3 text-sm font-medium transition-colors`
      : `${TOUCH_TARGET_MIN_CLASS} flex w-full items-center rounded-[10px] px-3 text-sm transition-colors`;

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
 * Same Board → Standings → Pool hierarchy; no equal-weight bottom tabs.
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
      {/* Desktop sidebar */}
      <aside
        className={`${chrome.desktopSidebar} sticky top-0 h-[calc(100vh-4.25rem)] w-64 shrink-0 flex-col border-r border-op-border bg-op-canvas`}
        aria-label="Pool navigation"
      >
        <div className="flex h-[4.5rem] items-center gap-3 border-b border-op-border px-5">
          <span
            className="grid h-8 w-8 place-items-center rounded-[9px] bg-op-ink text-[10px] font-bold tracking-tight text-white"
            aria-hidden
          >
            OP
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight">
              {poolName ?? "Pool"}
            </p>
            <p className="text-[10px] font-medium uppercase tracking-wider text-op-muted">
              In pool
            </p>
          </div>
        </div>
        <nav className="flex flex-col gap-1 px-2 pt-4" aria-label="Pool sections">
          <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-op-muted">
            Play
          </p>
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
            className={`${TOUCH_TARGET_MIN_CLASS} flex w-full items-center rounded-[10px] px-3 text-sm text-op-secondary hover:bg-op-control hover:text-op-text`}
          >
            My Pools
          </Link>
          <div className="flex items-center gap-2 px-3 py-2">
            <UserButton />
            <span className="text-xs text-op-muted">Account</span>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile / phone chrome */}
        <div className={`${chrome.mobileChips} flex-col gap-3 border-b border-op-border bg-op-surface px-4 py-3`}>
          <Link
            href={backTo}
            className={`${TOUCH_TARGET_MIN_CLASS} inline-flex items-center text-sm text-op-secondary hover:text-op-text`}
          >
            ← {backText}
          </Link>
          {poolName ? (
            <p className="text-lg font-semibold tracking-tight text-op-text">
              {poolName}
            </p>
          ) : null}
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
