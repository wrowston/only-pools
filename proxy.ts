import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { NextFetchEvent, NextRequest } from "next/server";
import { PROTECTED_ROUTE_PATTERNS } from "@/lib/authRoutes";
import { createLogger } from "@/lib/serverLog";
import { signedInHomeRedirectPath } from "@/lib/signedInHomeRedirect";

/**
 * Auth proxy runs on product routes that need a Participant session, plus `/`
 * for a cheap signed-in home redirect.
 *
 * Other public marketing/guides/sign-in HTML never enters this file — that is
 * the dominant TTFB win for prerendered pages under `next start`. `/` only
 * checks the Clerk session cookie hint and never calls clerkMiddleware.
 *
 * Logs go to the Next/Vercel runtime only (never the browser).
 */
const isProtectedRoute = createRouteMatcher(PROTECTED_ROUTE_PATTERNS);
const log = createLogger("next.proxy");

function redirectSignedInHome(request: NextRequest) {
  const destination = signedInHomeRedirectPath(
    request.nextUrl.pathname,
    request.headers.get("cookie"),
  );
  if (!destination) {
    return null;
  }
  log.debug("signed_in_home_redirect", {
    path: request.nextUrl.pathname,
    destination,
  });
  return NextResponse.redirect(new URL(destination, request.url));
}

function benchAuthProxy(request: NextRequest) {
  const homeRedirect = redirectSignedInHome(request);
  if (homeRedirect) {
    return homeRedirect;
  }
  if (!isProtectedRoute(request)) {
    return NextResponse.next();
  }
  log.warn("bench_proxy_redirect", {
    path: request.nextUrl.pathname,
    method: request.method,
  });
  const signIn = new URL("/sign-in", request.url);
  signIn.searchParams.set(
    "redirect_url",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  return NextResponse.redirect(signIn);
}

const clerkAuthProxy = clerkMiddleware(async (auth, request) => {
  // Callers must only invoke this for protected product routes.
  const session = await auth();
  if (!session.userId) {
    log.warn("protected_route_unauthenticated", {
      path: request.nextUrl.pathname,
      method: request.method,
    });
  } else {
    log.debug("protected_route", {
      path: request.nextUrl.pathname,
      method: request.method,
      clerkUserId: session.userId,
    });
  }
  await auth.protect();
});

function authProxy(request: NextRequest, event: NextFetchEvent) {
  // Matcher `"/"` also expands to `/index` and App Router transport forms.
  // Only the exact home path does the cookie-hint redirect; other expansions
  // must not fall through into auth.protect().
  if (request.nextUrl.pathname === "/") {
    return redirectSignedInHome(request) ?? NextResponse.next();
  }
  if (!isProtectedRoute(request)) {
    return NextResponse.next();
  }
  return clerkAuthProxy(request, event);
}

export default process.env.PAGE_LOAD_BENCH === "1"
  ? benchAuthProxy
  : authProxy;

export const config = {
  matcher: [
    // Exact home only: cookie-hint redirect for already-signed-in visitors.
    "/",
    "/my-pools/:path*",
    "/pools/:path*",
    // /join stays public so invite link previews (iMessage OG) are not
    // redirected to sign-in. Accept still requires an authenticated Participant.
    "/return/:path*",
    "/operator/:path*",
    "/prototype/:path*",
    "/settings/:path*",
  ],
};
