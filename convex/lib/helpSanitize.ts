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

/** Client may submit only these optional diagnostic keys. */
const CLIENT_CONTEXT_KEYS = new Set([
  "pagePath",
  "browserSummary",
  "appVersion",
]);

/** Keys that must never appear in client context — reject submission. */
const FORBIDDEN_CLIENT_CONTEXT_KEYS = new Set([
  "participantId",
  "accountId",
  "email",
  "poolId",
  "hiddenPick",
  "credentialSecret",
  "inviteToken",
  "source",
  "startedAtMs",
]);

const FORBIDDEN_CLIENT_CONTEXT_KEY_PATTERN =
  /^(hiddenPick|pickedTeamId|nflTeamId|credentialSecret|inviteToken|participantId|password|secret)/i;

/** All keys allowed in stored contextJson (client diagnostics + server identity). */
const STORED_CONTEXT_KEYS = new Set([
  ...CLIENT_CONTEXT_KEYS,
  "accountId",
  "email",
  "poolId",
]);

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

export function assertSafeClientContextKeys(
  context: Record<string, unknown>,
): void {
  for (const key of Object.keys(context)) {
    if (FORBIDDEN_CLIENT_CONTEXT_KEYS.has(key)) {
      throw new Error(`context must not include forbidden field: ${key}`);
    }
    if (FORBIDDEN_CLIENT_CONTEXT_KEY_PATTERN.test(key)) {
      throw new Error(`context must not include forbidden field: ${key}`);
    }
    if (!CLIENT_CONTEXT_KEYS.has(key)) {
      throw new Error(`context contains unsupported field: ${key}`);
    }
  }
}

export function sanitizeClientHelpContext(
  context: Record<string, unknown> | undefined,
  maxFieldLength: number,
  maxJsonLength: number,
): string | undefined {
  if (context === undefined) return undefined;

  assertSafeClientContextKeys(context);

  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(context)) {
    if (!CLIENT_CONTEXT_KEYS.has(key)) continue;
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length === 0) continue;
    assertTextSafeForHelp(trimmed, `context.${key}`);
    sanitized[key] = trimmed.slice(0, maxFieldLength);
  }

  if (Object.keys(sanitized).length === 0) return undefined;

  const json = JSON.stringify(sanitized);
  if (json.length > maxJsonLength) {
    throw new Error("Context payload is too large");
  }
  return json;
}

export type BuildStoredHelpContextArgs = {
  includeDiagnostics: boolean;
  clientContextJson?: string;
  accountId?: string;
  email?: string;
  poolId?: string;
};

/** Merge server-verified identity with optional client diagnostics for storage. */
export function buildStoredHelpContext(
  args: BuildStoredHelpContextArgs,
  maxFieldLength: number,
  maxJsonLength: number,
): string | undefined {
  const stored: Record<string, string> = {};

  if (args.includeDiagnostics && args.clientContextJson) {
    const parsed = JSON.parse(args.clientContextJson) as Record<
      string,
      unknown
    >;
    for (const key of CLIENT_CONTEXT_KEYS) {
      const value = parsed[key];
      if (typeof value === "string" && value.trim().length > 0) {
        stored[key] = value.trim().slice(0, maxFieldLength);
      }
    }
  }

  if (args.accountId) {
    stored.accountId = args.accountId.slice(0, maxFieldLength);
  }
  if (args.email) {
    stored.email = args.email.trim().slice(0, maxFieldLength);
  }
  if (args.poolId) {
    stored.poolId = args.poolId.slice(0, maxFieldLength);
  }

  if (Object.keys(stored).length === 0) return undefined;

  for (const [key, value] of Object.entries(stored)) {
    if (!STORED_CONTEXT_KEYS.has(key)) {
      throw new Error(`Invalid stored context key: ${key}`);
    }
    assertTextSafeForHelp(value, `context.${key}`);
  }

  const json = JSON.stringify(stored);
  if (json.length > maxJsonLength) {
    throw new Error("Context payload is too large");
  }
  return json;
}

/** @deprecated Use sanitizeClientHelpContext — kept for tests importing old name. */
export function sanitizeHelpContext(
  context: Record<string, unknown> | undefined,
  maxFieldLength: number,
  maxJsonLength: number,
): string | undefined {
  return sanitizeClientHelpContext(context, maxFieldLength, maxJsonLength);
}
