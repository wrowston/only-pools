/** Max length for optional Pool owner banner (member-visible announcement). */
export const MAX_POOL_BANNER_MESSAGE_LENGTH = 500;

/**
 * Trim and validate a Pool banner message. Empty / whitespace-only → undefined
 * (cleared). Throws Error with a user-facing message on overflow.
 */
export function normalizePoolBannerMessage(
  raw: string | undefined,
): string | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > MAX_POOL_BANNER_MESSAGE_LENGTH) {
    throw new Error(
      `Pool banner message must be at most ${MAX_POOL_BANNER_MESSAGE_LENGTH} characters`,
    );
  }
  return trimmed;
}
