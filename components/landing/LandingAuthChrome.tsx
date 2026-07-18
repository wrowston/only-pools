"use client";

import Link from "next/link";
import { Show, SignInButton, SignUpButton } from "@clerk/nextjs";
import { BrandMark } from "@/components/BrandMark";
import { POST_AUTH_HOME } from "@/lib/authRoutes";

/**
 * Client-only Clerk chrome for the marketing landing page.
 * Keeping auth widgets out of the RSC page lets `/` prerender as static HTML.
 */
export function LandingHeader() {
  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-[60] px-3 pt-3 sm:px-5 sm:pt-4">
      <nav
        aria-label="Landing page"
        className="pointer-events-auto relative mx-auto flex h-14 max-w-[1040px] items-center gap-3 rounded-full border border-op-border-strong bg-op-surface/92 px-3 shadow-[0_12px_36px_-20px_rgba(38,38,38,0.35)] backdrop-blur-xl sm:px-4"
      >
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 text-[14px] font-medium tracking-tight text-op-text"
        >
          <BrandMark />
          Only Pools
        </Link>

        <div className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 md:flex">
          <Link
            href="#pool-types"
            className="rounded-full px-3 py-2 text-[13px] text-op-secondary transition-colors hover:bg-op-control hover:text-op-text"
          >
            Pool Types
          </Link>
          <Link
            href="#how-it-works"
            className="rounded-full px-3 py-2 text-[13px] text-op-secondary transition-colors hover:bg-op-control hover:text-op-text"
          >
            How It Works
          </Link>
        </div>

        <div className="ml-auto hidden items-center gap-1.5 md:flex">
          <Show when="signed-out">
            <SignInButton forceRedirectUrl={POST_AUTH_HOME}>
              <button
                type="button"
                className="op-btn op-btn-ghost h-8 rounded-full px-3 text-[13px]"
              >
                Log in
              </button>
            </SignInButton>
          </Show>
          <Show when="signed-in">
            <Link
              href="/join"
              className="op-btn op-btn-ghost h-8 rounded-full px-3 text-[13px]"
            >
              Join a Pool
            </Link>
          </Show>
          <PrimaryPoolAction className="op-btn op-btn-primary h-8 rounded-full px-4 text-[13px]" />
        </div>

        <div className="ml-auto flex items-center gap-1.5 md:hidden">
          <PrimaryPoolAction className="op-btn op-btn-primary h-8 rounded-full px-3 text-[12px]" />
          <details className="group relative">
            <summary className="grid h-8 w-8 cursor-pointer list-none place-items-center rounded-full text-op-secondary transition-colors hover:bg-op-control hover:text-op-text [&::-webkit-details-marker]:hidden">
              <span className="sr-only">Open navigation</span>
              <MenuIcon />
            </summary>
            <div className="absolute right-0 top-[calc(100%+0.55rem)] w-40 overflow-hidden rounded-[12px] border border-op-border-strong bg-op-surface p-1.5 shadow-[0_18px_42px_-18px_rgba(38,38,38,0.35)]">
              <Show when="signed-out">
                <SignInButton forceRedirectUrl={POST_AUTH_HOME}>
                  <button
                    type="button"
                    className="flex w-full rounded-[8px] px-3 py-2 text-left text-[13px] text-op-secondary hover:bg-op-control hover:text-op-text"
                  >
                    Log in
                  </button>
                </SignInButton>
              </Show>
              <Link
                href="/join"
                className="block rounded-[8px] px-3 py-2 text-[13px] text-op-secondary hover:bg-op-control hover:text-op-text"
              >
                Join a Pool
              </Link>
              <Link
                href="#pool-types"
                className="block rounded-[8px] px-3 py-2 text-[13px] text-op-secondary hover:bg-op-control hover:text-op-text"
              >
                Pool Types
              </Link>
              <Link
                href="#how-it-works"
                className="block rounded-[8px] px-3 py-2 text-[13px] text-op-secondary hover:bg-op-control hover:text-op-text"
              >
                How It Works
              </Link>
            </div>
          </details>
        </div>
      </nav>
    </header>
  );
}

export function PrimaryPoolAction({
  className,
  showArrow = false,
}: {
  className: string;
  showArrow?: boolean;
}) {
  return (
    <>
      <Show when="signed-out">
        <SignUpButton forceRedirectUrl={POST_AUTH_HOME}>
          <button type="button" className={className}>
            Start a Pool
            {showArrow ? <ArrowIcon /> : null}
          </button>
        </SignUpButton>
      </Show>
      <Show when="signed-in">
        <Link href={POST_AUTH_HOME} className={className}>
          My Pools
          {showArrow ? <ArrowIcon /> : null}
        </Link>
      </Show>
    </>
  );
}

function ArrowIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
      <path
        d="M2.5 6.5h8m-3-3 3 3-3 3"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
      <path
        d="M2.5 4.25h10M2.5 7.5h10M2.5 10.75h10"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}
