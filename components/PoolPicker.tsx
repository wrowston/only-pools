"use client";

import { useConvexAuth, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import {
  COMPACT_CONTROL_CLASS,
  poolSectionHref,
  type PoolSection,
} from "@/lib/gameDayShell";

type PoolPickerMembership = {
  poolId: string;
  name: string;
  type: "survivor" | "confidence" | null;
};

function typeLabel(type: "survivor" | "confidence" | null): string | null {
  if (type === "survivor") return "Survivor";
  if (type === "confidence") return "Confidence";
  return null;
}

/**
 * In-pool switcher — Firecrawl-style select in the shell chrome.
 * Preserves Board / Standings / Pool when jumping between memberships.
 */
export function PoolPicker({
  poolId,
  poolName,
  section,
  variant,
}: {
  poolId: string;
  poolName?: string;
  section: PoolSection;
  variant: "sidebar" | "mobile";
}) {
  const { isAuthenticated } = useConvexAuth();
  const myPools = useQuery(
    api.participants.myPools,
    isAuthenticated ? {} : "skip",
  );
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const label = poolName ?? "Pool";
  const memberships: PoolPickerMembership[] =
    myPools?.memberships.map((m) => ({
      poolId: m.poolId,
      name: m.name,
      type: m.type,
    })) ?? [];
  const canSwitch = memberships.length > 1;

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function selectPool(nextPoolId: string) {
    setOpen(false);
    if (nextPoolId === poolId) return;
    router.push(poolSectionHref(nextPoolId, section));
  }

  const menuAlign =
    variant === "sidebar"
      ? "left-0 right-0 top-[calc(100%+0.35rem)]"
      : "left-0 top-[calc(100%+0.35rem)] w-[min(18rem,calc(100vw-2rem))]";

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
        className={[
          "inline-flex w-full max-w-full items-center gap-2.5 rounded-[10px] px-2 text-left transition-colors",
          open
            ? "bg-op-control text-op-text"
            : "text-op-text hover:bg-op-control",
          variant === "sidebar" ? "h-11 py-1" : `${COMPACT_CONTROL_CLASS}`,
        ].join(" ")}
        data-pool-picker="trigger"
      >
        <span className="min-w-0 flex-1">
          <span
            className={[
              "block truncate font-medium tracking-tight",
              variant === "mobile" ? "text-base" : "text-[13px]",
            ].join(" ")}
          >
            {label}
          </span>
          {variant === "sidebar" ? (
            <span className="op-eyebrow mt-0.5 block">
              {canSwitch ? "Switch pool" : "In pool"}
            </span>
          ) : null}
        </span>
        <Chevron open={open} />
      </button>

      {open ? (
        <div
          id={listId}
          role="listbox"
          aria-label="Your pools"
          className={`absolute z-40 overflow-hidden rounded-[10px] border border-op-border bg-op-surface shadow-[0_8px_24px_rgba(0,0,0,0.08)] ${menuAlign}`}
          data-pool-picker="menu"
        >
          <ul className="max-h-64 overflow-y-auto py-1">
            {(memberships.length > 0
              ? memberships
              : ([{ poolId, name: label, type: null }] satisfies PoolPickerMembership[])
            ).map((m) => {
              const selected = m.poolId === poolId;
              const subtitle = typeLabel(m.type);
              return (
                <li key={m.poolId} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => selectPool(m.poolId)}
                    className={[
                      "flex w-full items-center gap-2.5 px-2.5 py-2 text-left transition-colors",
                      selected
                        ? "bg-op-selected text-op-selected-fg"
                        : "text-op-text hover:bg-op-control",
                    ].join(" ")}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">
                        {m.name}
                      </span>
                      {subtitle ? (
                        <span
                          className={[
                            "block text-[11px]",
                            selected
                              ? "text-op-selected-fg/80"
                              : "text-op-muted",
                          ].join(" ")}
                        >
                          {subtitle}
                        </span>
                      ) : null}
                    </span>
                    {selected ? (
                      <span className="text-[11px] font-medium" aria-hidden>
                        ✓
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="border-t border-op-border p-1">
            <Link
              href="/my-pools"
              onClick={() => setOpen(false)}
              className={`${COMPACT_CONTROL_CLASS} flex w-full items-center rounded-[6px] px-2.5 text-[13px] font-medium text-op-secondary hover:bg-op-control hover:text-op-text`}
            >
              All pools
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden
      className={`shrink-0 text-op-muted transition-transform ${open ? "rotate-180" : ""}`}
    >
      <path
        d="M3 4.5L6 7.5L9 4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
