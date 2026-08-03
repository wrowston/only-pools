/** Max length for optional Pool description (member-visible blurb). */
export const MAX_POOL_DESCRIPTION_LENGTH = 2000;

/**
 * Trim and validate a Pool description. Empty / whitespace-only → undefined
 * (cleared). Throws Error with a user-facing message on overflow.
 */
export function normalizePoolDescription(
  raw: string | undefined,
): string | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > MAX_POOL_DESCRIPTION_LENGTH) {
    throw new Error(
      `Pool description must be at most ${MAX_POOL_DESCRIPTION_LENGTH} characters`,
    );
  }
  return trimmed;
}
