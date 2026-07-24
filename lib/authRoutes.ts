/** App home after sign-in / sign-up when no deeper redirect_url applies. */
export const POST_AUTH_HOME = "/my-pools";

/** Routes that stay readable without a Participant session. */
export const PUBLIC_ROUTE_PATTERNS = [
  "/",
  "/guides(.*)",
  "/help(.*)",
  "/opengraph-image(.*)",
  "/sitemap.xml",
  "/sign-in(.*)",
  "/sign-up(.*)",
];

/**
 * Paths that require a signed-in Participant. Kept in sync with `proxy.ts`
 * matcher — public HTML never enters clerkMiddleware.
 */
export const PROTECTED_ROUTE_PATTERNS = [
  "/my-pools(.*)",
  "/pools(.*)",
  "/join(.*)",
  "/return(.*)",
  "/operator(.*)",
  "/prototype(.*)",
];
