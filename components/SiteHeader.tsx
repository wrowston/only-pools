"use client";

import {
  SignInButton,
  SignUpButton,
  UserButton,
} from "@clerk/nextjs";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandMark } from "@/components/BrandMark";
import { OperatorNavLink } from "@/components/OperatorNavLink";
import { MyPoolsNavLink } from "@/components/MyPoolsNavLink";
import { POST_AUTH_HOME } from "@/lib/authRoutes";
import { clerkPhoneFirstInitialValues } from "@/lib/clerkPhoneFirst";
import { HELP_FEEDBACK_LABEL } from "@/lib/helpNav";
import { postAuthRedirect } from "@/lib/postAuthRedirect";
import { useLikelySignedIn } from "@/lib/useLikelySignedIn";

const menuItemClassName =
  "flex w-full rounded-[8px] px-3 py-2 text-left text-[13px] text-op-secondary transition-colors hover:bg-op-control hover:text-op-text";

/**
 * Global top bar. Hidden on in-pool desktop (≥900px) — brand lives in the
 * sidebar above the pool picker. Still shown on phone and non-pool routes.
 *
 * `variant="marketing"` shows Guides and omits Convex-backed Operator nav so
 * public pages do not need a Convex provider. `variant="app"` (dashboard)
 * hides Guides — that link lives on the marketing home page instead.
 *
 * Secondary links (Help, My Pools, Incidents, Guides, Log in) always live
 * behind a hamburger so the bar stays a single clean row on every width.
 * Brand + the primary auth control (UserButton or Sign up) stay visible.
 */
export function SiteHeader({
  variant = "app",
}: {
  variant?: "marketing" | "app";
}) {
  const pathname = usePathname() ?? "";
  const inPool = pathname.startsWith("/pools/");
  const likelySignedIn = useLikelySignedIn();
  const authRedirectUrl = postAuthRedirect(pathname);

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
      <div className="mx-auto flex h-[4.5rem] w-full max-w-[1200px] items-center justify-between gap-3 px-5 sm:px-8">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 whitespace-nowrap text-[15px] font-medium tracking-tight text-op-text"
        >
          <BrandMark />
          Only Pools
          <span className="rounded-[4px] border border-op-border bg-op-control px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.06em] text-op-secondary">
            Beta
          </span>
        </Link>

        <div className="flex items-center gap-1.5">
          {likelySignedIn ? (
            <div className="flex items-center">
              <UserButton />
            </div>
          ) : (
            <SignUpButton
              forceRedirectUrl={authRedirectUrl}
              initialValues={clerkPhoneFirstInitialValues}
            >
              <button
                type="button"
                className="op-btn op-btn-secondary h-8 px-3 text-[13px]"
              >
                Sign up
              </button>
            </SignUpButton>
          )}
          <NavMenu
            variant={variant}
            likelySignedIn={likelySignedIn}
            authRedirectUrl={authRedirectUrl}
          />
        </div>
      </div>
      <div className="h-px w-full bg-op-border" />
    </header>
  );
}

function NavMenu({
  variant,
  likelySignedIn,
  authRedirectUrl,
}: {
  variant: "marketing" | "app";
  likelySignedIn: boolean;
  authRedirectUrl: string;
}) {
  return (
    <details className="group relative">
      <summary className="grid h-8 w-8 cursor-pointer list-none place-items-center rounded-[8px] text-op-secondary transition-colors hover:bg-op-control hover:text-op-text [&::-webkit-details-marker]:hidden">
        <span className="sr-only">Open navigation</span>
        <MenuIcon />
      </summary>
      <div className="absolute right-0 top-[calc(100%+0.55rem)] w-48 overflow-hidden rounded-[12px] border border-op-border-strong bg-op-surface p-1.5 shadow-[0_18px_42px_-18px_rgba(38,38,38,0.35)]">
        {variant === "marketing" ? (
          <Link href="/guides" className={menuItemClassName}>
            Guides
          </Link>
        ) : null}
        <Link href="/help" className={menuItemClassName}>
          {HELP_FEEDBACK_LABEL}
        </Link>
        {likelySignedIn ? (
          <>
            <Link href="/settings/notifications" className={menuItemClassName}>
              Notifications
            </Link>
            {variant === "app" ? (
              <MyPoolsNavLink className={menuItemClassName} />
            ) : (
              <Link href={POST_AUTH_HOME} className={menuItemClassName}>
                My Pools
              </Link>
            )}
            {variant === "app" ? (
              <OperatorNavLink className={menuItemClassName} />
            ) : null}
          </>
        ) : (
          <SignInButton
            forceRedirectUrl={authRedirectUrl}
            initialValues={clerkPhoneFirstInitialValues}
          >
            <button type="button" className={menuItemClassName}>
              Log in
            </button>
          </SignInButton>
        )}
      </div>
    </details>
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
