/**
 * Sync cookie hint for Clerk session presence.
 * Used to paint signed-in CTAs before Clerk finishes loading.
 *
 * `__client_uat` is a unix timestamp when signed in, and `"0"` when signed out.
 * `__session` is the session JWT cookie when present.
 */
export function hasClerkSessionCookie(
  cookieSource: string | undefined = typeof document !== "undefined"
    ? document.cookie
    : undefined,
): boolean {
  if (!cookieSource) return false;

  const clientUat = cookieSource.match(/(?:^|;\s*)__client_uat=([^;]*)/);
  if (clientUat?.[1] !== undefined && clientUat[1] !== "" && clientUat[1] !== "0") {
    return true;
  }

  return /(?:^|;\s*)__session=/.test(cookieSource);
}
