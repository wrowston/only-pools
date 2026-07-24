"use client";

import {
  Show,
  SignInButton,
  SignUpButton,
  UserButton,
} from "@clerk/nextjs";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandMark } from "@/components/BrandMark";
import { OperatorNavLink } from "@/components/OperatorNavLink";
import { POST_AUTH_HOME } from "@/lib/authRoutes";

/**
 * Global top bar. Hidden on in-pool desktop (≥900px) — brand lives in the
 * sidebar above the pool picker. Still shown on phone and non-pool routes.
 *
 * `variant="marketing"` shows Guides and omits Convex-backed Operator nav so
 * public pages do not need a Convex provider. `variant="app"` (dashboard)
 * hides Guides — that link lives on the marketing home page instead.
 */
export function SiteHeader({
  variant = "app",
}: {
  variant?: "marketing" | "app";
}) {
  const pathname = usePathname() ?? "";
  const inPool = pathname.startsWith("/pools/");

  if (pathname === "/") {
    return null;
  }

  return (
    <header
      className={[
        "sticky top-0 z-50 w-full bg-op-canvas/95 backdrop-blur-[6px]",
        inPool ? "min-[900px]:hidden" : "",
      ].join(" ")}
    >
      <div className="mx-auto flex h-[4.5rem] w-full max-w-[1200px] items-center justify-between gap-4 px-5 sm:px-8">
        <Link
          href="/"
          className="flex items-center gap-2 text-[15px] font-medium tracking-tight text-op-text"
        >
          <BrandMark />
          Only Pools
          <span className="rounded-[4px] border border-op-border bg-op-control px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.06em] text-op-secondary">
            Beta
          </span>
        </Link>
        <div className="flex items-center gap-1.5 sm:gap-2">
          {variant === "marketing" ? (
            <Link
              href="/guides"
              className="op-btn op-btn-ghost h-8 px-2.5 text-[13px]"
            >
              Guides
            </Link>
          ) : null}
          <Link
            href="/help"
            className="op-btn op-btn-ghost h-8 px-2.5 text-[13px]"
          >
            Help & feedback
          </Link>
          <Show when="signed-out">
            <SignInButton forceRedirectUrl={POST_AUTH_HOME}>
              <button
                type="button"
                className="op-btn op-btn-ghost h-8 px-2.5 text-[13px]"
              >
                Log in
              </button>
            </SignInButton>
            <SignUpButton forceRedirectUrl={POST_AUTH_HOME}>
              <button
                type="button"
                className="op-btn op-btn-secondary h-8 px-3 text-[13px]"
              >
                Sign up
              </button>
            </SignUpButton>
          </Show>
          <Show when="signed-in">
            <Link
              href={POST_AUTH_HOME}
              className="op-btn op-btn-ghost h-8 px-2.5 text-[13px]"
            >
              My Pools
            </Link>
            {variant === "app" ? <OperatorNavLink /> : null}
            <div className="ml-1 flex items-center">
              <UserButton />
            </div>
          </Show>
        </div>
      </div>
      <div className="h-px w-full bg-op-border" />
    </header>
  );
}
