"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { COMPACT_CONTROL_CLASS } from "@/lib/gameDayShell";

/**
 * Operator-only nav entry for Operator Incidents.
 * Renders nothing for non-operators (and while loading).
 */
export function OperatorNavLink({
  variant = "header",
}: {
  variant?: "header" | "sidebar";
}) {
  const me = useQuery(api.incidents.amIProductionOperator);
  const pathname = usePathname() ?? "";
  const active = pathname === "/operator" || pathname.startsWith("/operator/");

  if (!me?.isOperator) {
    return null;
  }

  if (variant === "sidebar") {
    const base = `${COMPACT_CONTROL_CLASS} flex w-full items-center rounded-[8px] px-2.5 text-[13px] font-medium transition-colors`;
    const activeClass = active
      ? "bg-op-selected text-op-selected-fg"
      : "text-op-secondary hover:bg-op-control hover:text-op-text";

    if (active) {
      return (
        <span
          aria-current="page"
          className={`${base} ${activeClass}`}
          data-operator-nav
        >
          Incidents
        </span>
      );
    }

    return (
      <Link
        href="/operator"
        className={`${base} ${activeClass}`}
        data-operator-nav
      >
        Incidents
      </Link>
    );
  }

  return (
    <Link
      href="/operator"
      className={`op-btn op-btn-ghost h-8 px-2.5 text-[13px]${
        active ? " bg-op-selected text-op-selected-fg" : ""
      }`}
      aria-current={active ? "page" : undefined}
      data-operator-nav
    >
      Incidents
    </Link>
  );
}
