/** SHA-256 hex digest for Pool Invite credential lookup. Never log the raw input. */
export async function hashInviteCredential(rawToken: string): Promise<string> {
  const data = new TextEncoder().encode(rawToken);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Cryptographically random bearer token (64 hex chars). */
export function generateInviteToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const INVITE_PATH_PREFIX = "/join/";

export function inviteUrlFromToken(rawToken: string): string {
  return `${INVITE_PATH_PREFIX}${rawToken}`;
}

/** Extract raw token from a path or bare token string. */
export function parseInviteToken(tokenOrPath: string): string {
  const trimmed = tokenOrPath.trim();
  if (trimmed.startsWith(INVITE_PATH_PREFIX)) {
    return trimmed.slice(INVITE_PATH_PREFIX.length);
  }
  return trimmed;
}
