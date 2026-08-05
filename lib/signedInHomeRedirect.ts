import { POST_AUTH_HOME } from "@/lib/authRoutes";
import { hasClerkSessionCookie } from "@/lib/clerkSessionHint";

/**
 * Signed-in visitors who open `/` should land on My Pools.
 * Uses the Clerk session cookie hint so public HTML can stay out of
 * clerkMiddleware while still skipping the marketing page.
 */
export function signedInHomeRedirectPath(
  pathname: string,
  cookieHeader: string | null | undefined,
): string | null {
  if (pathname !== "/") {
    return null;
  }
  if (!hasClerkSessionCookie(cookieHeader ?? undefined)) {
    return null;
  }
  return POST_AUTH_HOME;
}
