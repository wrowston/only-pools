/**
 * Browser noise from Clerk CDN / session-touch that is not actionable for us.
 * Shared by Sentry ignore lists and PostHog `before_send`.
 */

export const CLERK_CLIENT_IGNORE_ERRORS: RegExp[] = [
  /^NetworkError: A network error occurred\.?$/i,
  /^Script error\.?$/i,
  /^Load failed$/i,
  /^Failed to fetch$/i,
  /ClerkJS:\s*Network error/i,
  /Network error at ["'].*clerk/i,
  /Token refresh failed/i,
];

export const CLERK_CLIENT_DENY_URLS: RegExp[] = [
  /clerk-telemetry\.com/i,
  /clerk\.accounts\.dev/i,
  /[^/]*\.clerk\.com/i,
  /cdn\.clerk\./i,
  /npm\/@clerk\//i,
];

export function isNoisyClerkClientMessage(message: string): boolean {
  return CLERK_CLIENT_IGNORE_ERRORS.some((pattern) => pattern.test(message));
}

export function isNoisyClerkClientUrl(url: string): boolean {
  return CLERK_CLIENT_DENY_URLS.some((pattern) => pattern.test(url));
}
