/** App home after sign-in / sign-up when no deeper redirect_url applies. */
export const POST_AUTH_HOME = "/my-pools";

/** Routes that stay readable without a Participant session. */
export const PUBLIC_ROUTE_PATTERNS = [
  "/",
  "/guides(.*)",
  "/opengraph-image(.*)",
  "/sitemap.xml",
  "/sign-in(.*)",
  "/sign-up(.*)",
];
