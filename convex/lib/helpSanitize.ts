/**
 * Sanitize Help & Feedback payloads — reject Hidden Picks, invite credentials,
 * and password-like secrets. Shared with Abuse Report intake.
 */

const INVITE_SECRET_PATTERN =
  /\/join\/[A-Za-z0-9_-]{16,}|invite[_-]?token|credentialSecret/i;

const HIDDEN_PICK_PATTERN =
  /\b(nflTeamId|pickedTeamId|confidenceValue|tiebreakerPrediction)\b/i;

const PASSWORD_LIKE_PATTERN =
  /\b(password|passwd|secret|api[_-]?key|auth[_-]?token|bearer\s+[A-Za-z0-9._-]{8,})\b/i;

export type SanitizeViolation =
  | "invite_credential"
  | "hidden_pick"
  | "password_like_secret";

export function findSanitizeViolations(text: string): SanitizeViolation[] {
  const violations: SanitizeViolation[] = [];
  if (INVITE_SECRET_PATTERN.test(text)) {
    violations.push("invite_credential");
  }
  if (HIDDEN_PICK_PATTERN.test(text)) {
    violations.push("hidden_pick");
  }
  if (PASSWORD_LIKE_PATTERN.test(text)) {
    violations.push("password_like_secret");
  }
  return violations;
}

export function assertTextSafeForHelp(
  text: string,
  fieldLabel = "message",
): void {
  const violations = findSanitizeViolations(text);
  if (violations.includes("invite_credential")) {
    throw new Error(
      `${fieldLabel} must not include raw Pool Invite credentials`,
    );
  }
  if (violations.includes("hidden_pick")) {
    throw new Error(`${fieldLabel} must not include Hidden Pick values`);
  }
  if (violations.includes("password_like_secret")) {
    throw new Error(
      `${fieldLabel} must not include passwords or secret credentials`,
    );
  }
}

/** Allowed context keys for sanitized JSON storage. */
const ALLOWED_CONTEXT_KEYS = new Set([
  "pagePath",
  "browserSummary",
  "appVersion",
]);

export function sanitizeHelpContext(
  context: Record<string, unknown> | undefined,
  maxFieldLength: number,
  maxJsonLength: number,
): string | undefined {
  if (context === undefined) return undefined;

  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(context)) {
    if (!ALLOWED_CONTEXT_KEYS.has(key)) continue;
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length === 0) continue;
    sanitized[key] = trimmed.slice(0, maxFieldLength);
  }

  if (Object.keys(sanitized).length === 0) return undefined;

  const json = JSON.stringify(sanitized);
  if (json.length > maxJsonLength) {
    throw new Error("Context payload is too large");
  }
  return json;
}
