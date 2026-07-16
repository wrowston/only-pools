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

/**
 * Global top bar. Hidden on in-pool desktop (≥900px) — brand lives in the
 * sidebar above the pool picker. Still shown on phone and non-pool routes.
 */
export function SiteHeader() {
  const pathname = usePathname() ?? "";
  const inPool = pathname.startsWith("/pools/");

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
        </Link>
        <div className="flex items-center gap-1.5 sm:gap-2">
          <Show when="signed-out">
            <SignInButton>
              <button
                type="button"
                className="op-btn op-btn-ghost h-8 px-2.5 text-[13px]"
              >
                Log in
              </button>
            </SignInButton>
            <SignUpButton>
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
              href="/my-pools"
              className="op-btn op-btn-ghost h-8 px-2.5 text-[13px]"
            >
              My Pools
            </Link>
            <OperatorNavLink />
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
