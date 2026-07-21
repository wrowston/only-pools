"use client";

import { useConvexAuth, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import {
  COMPACT_CONTROL_CLASS,
  poolSectionHref,
  type PoolSection,
} from "@/lib/gameDayShell";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
  const label = poolName ?? "Pool";
  const memberships: PoolPickerMembership[] =
    myPools?.memberships.map((m) => ({
      poolId: m.poolId,
      name: m.name,
      type: m.type,
    })) ?? [];
  const canSwitch = memberships.length > 1;
  const pools =
    memberships.length > 0
      ? memberships
      : ([{ poolId, name: label, type: null }] satisfies PoolPickerMembership[]);

  function selectPool(nextPoolId: string) {
    if (nextPoolId === poolId) return;
    router.push(poolSectionHref(nextPoolId, section));
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={[
          "inline-flex w-full max-w-full items-center gap-2.5 rounded-[10px] px-2 text-left transition-colors",
          "text-op-text hover:bg-op-control data-popup-open:bg-op-control data-popup-open:[&_svg]:rotate-180",
          variant === "sidebar" ? "h-11 py-1" : COMPACT_CONTROL_CLASS,
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
        <Chevron />
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className={[
          "border-op-border bg-op-surface text-op-text shadow-[0_8px_24px_rgba(0,0,0,0.08)] ring-op-border/40",
          variant === "mobile"
            ? "w-[min(18rem,calc(100vw-2rem))]"
            : "w-(--anchor-width)",
        ].join(" ")}
        data-pool-picker="menu"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-op-muted">
            Your pools
          </DropdownMenuLabel>
          {pools.map((m) => {
            const selected = m.poolId === poolId;
            const subtitle = typeLabel(m.type);
            return (
              <DropdownMenuItem
                key={m.poolId}
                onClick={() => selectPool(m.poolId)}
                className={[
                  "items-start gap-2.5 px-2.5 py-2",
                  selected
                    ? "bg-op-selected text-op-selected-fg focus:bg-op-selected focus:text-op-selected-fg"
                    : "text-op-text focus:bg-op-control focus:text-op-text",
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
                  <span className="mt-0.5 text-[11px] font-medium" aria-hidden>
                    ✓
                  </span>
                ) : null}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>

        <DropdownMenuSeparator className="bg-op-border" />

        <DropdownMenuItem
          render={<Link href="/my-pools" />}
          className="px-2.5 py-2 text-[13px] font-medium text-op-secondary focus:bg-op-control focus:text-op-text"
        >
          All pools
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Chevron() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden
      className="shrink-0 text-op-muted transition-transform"
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
