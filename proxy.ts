import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { PROTECTED_ROUTE_PATTERNS } from "@/lib/authRoutes";

/**
 * Auth proxy runs only on routes that need a Participant session.
 * Public marketing/guides/sign-in HTML never enters clerkMiddleware — that is
 * the dominant TTFB win for prerendered pages under `next start`.
 */
const isProtectedRoute = createRouteMatcher(PROTECTED_ROUTE_PATTERNS);

function benchAuthProxy(request: NextRequest) {
  if (!isProtectedRoute(request)) {
    return NextResponse.next();
  }
  const signIn = new URL("/sign-in", request.url);
  signIn.searchParams.set(
    "redirect_url",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  return NextResponse.redirect(signIn);
}

const clerkAuthProxy = clerkMiddleware(async (auth) => {
  // Matcher already excludes public routes; every hit here must be signed in.
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
