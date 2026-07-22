import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { PROTECTED_ROUTE_PATTERNS } from "@/lib/authRoutes";
import { createLogger } from "@/lib/serverLog";

/**
 * Auth proxy runs only on routes that need a Participant session.
 * Public marketing/guides/sign-in HTML never enters clerkMiddleware — that is
 * the dominant TTFB win for prerendered pages under `next start`.
 *
 * Logs go to the Next/Vercel runtime only (never the browser).
 */
const isProtectedRoute = createRouteMatcher(PROTECTED_ROUTE_PATTERNS);
const log = createLogger("next.proxy");

function benchAuthProxy(request: NextRequest) {
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
  // Matcher already excludes public routes; every hit here must be signed in.
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

export default process.env.PAGE_LOAD_BENCH === "1"
  ? benchAuthProxy
  : clerkAuthProxy;

export const config = {
  matcher: [
    "/my-pools/:path*",
    "/pools/:path*",
    "/join",
    "/join/:path*",
    "/return/:path*",
    "/operator/:path*",
    "/prototype/:path*",
  ],
};
