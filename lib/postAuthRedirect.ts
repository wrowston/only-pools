import { POST_AUTH_HOME } from "@/lib/authRoutes";

/**
 * After Clerk sign-in / sign-up from invite surfaces, return to the invite
 * URL instead of dumping the user on My Pools.
 */
export function postAuthRedirect(pathname: string): string {
  if (/^\/join\/[^/]+\/?$/.test(pathname)) {
    return pathname.replace(/\/$/, "") || pathname;
  }
  if (/^\/return\/[^/]+\/?$/.test(pathname)) {
    return pathname.replace(/\/$/, "") || pathname;
  }
  return POST_AUTH_HOME;
}
