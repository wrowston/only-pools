/**
 * Help intake deployment configuration — CORS origin, mailbox, Resend gating,
 * rate-limit secrets. Production fails closed without required config;
 * non-prod never sends real mail.
 */

import {
  HELP_TEST_RATE_LIMIT_SECRET,
} from "./helpConstants";
import { resolveDeploymentKind } from "./syncGate";

export type HelpSecurityConfig = {
  allowedOrigin: string | null;
  networkHashSecret: string | null;
  rateLimitReady: boolean;
};

export function getHelpAllowedOrigin(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): string | null {
  const explicit = env.HELP_ALLOWED_ORIGIN?.trim();
  if (explicit) return explicit;
  const client = env.CLIENT_ORIGIN?.trim();
  if (client) return client;
  const site = env.NEXT_PUBLIC_SITE_URL?.trim();
  if (site) return site;
  return null;
}

export function getSupportMailbox(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): string | undefined {
  return env.HELP_SUPPORT_MAILBOX?.trim() || undefined;
}

export function getFromEmail(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): string | undefined {
  return env.HELP_FROM_EMAIL?.trim() || undefined;
}

export function hasResendApiKey(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): boolean {
  return Boolean(env.RESEND_API_KEY?.trim());
}

export function isDoubleEmailMode(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): boolean {
  return env.HELP_EMAIL_MODE?.trim().toLowerCase() === "double";
}

/**
 * True only when this deployment may POST to the Resend API (production +
 * configured mailbox/from + API key, and not in deterministic double mode).
 */
export function canDeliverRealEmail(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): boolean {
  const kind = resolveDeploymentKind(env);
  if (kind !== "production") return false;
  if (isDoubleEmailMode(env)) return false;
  if (!hasResendApiKey(env)) return false;
  if (!getSupportMailbox(env) || !getFromEmail(env)) return false;
  return true;
}

export type HelpOperationalCheck =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Production HTTP intake requires mailbox, from address, and Resend key
 * (unless HELP_EMAIL_MODE=double for deterministic tests in prod-like envs).
 */
export function getHelpNetworkHashSecret(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): string | null {
  const explicit =
    env.HELP_NETWORK_HASH_SECRET?.trim() ||
    env.HELP_RATE_LIMIT_SECRET?.trim();
  if (explicit) return explicit;

  const kind = resolveDeploymentKind(env);
  if (kind === "production") {
    return null;
  }
  if (isDoubleEmailMode(env) || kind === "test") {
    return HELP_TEST_RATE_LIMIT_SECRET;
  }
  return HELP_TEST_RATE_LIMIT_SECRET;
}

export type HelpRateLimitCheck =
  | { ok: true; secret: string }
  | { ok: false; reason: string };

/**
 * Production requires a configured hash secret for network/account throttling.
 * Non-production may use the deterministic test secret.
 */
export function assertHelpRateLimitReady(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): HelpRateLimitCheck {
  const secret = getHelpNetworkHashSecret(env);
  if (!secret) {
    return {
      ok: false,
      reason: "HELP_NETWORK_HASH_SECRET is not configured",
    };
  }
  return { ok: true, secret };
}

export function resolveHelpSecurityConfig(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): HelpSecurityConfig {
  const rateLimit = assertHelpRateLimitReady(env);
  return {
    allowedOrigin: getHelpAllowedOrigin(env),
    networkHashSecret: rateLimit.ok ? rateLimit.secret : null,
    rateLimitReady: rateLimit.ok,
  };
}

export function assertHelpIntakeOperational(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): HelpOperationalCheck {
  const kind = resolveDeploymentKind(env);
  if (kind !== "production") {
    return { ok: true };
  }
  if (!getSupportMailbox(env)) {
    return { ok: false, reason: "HELP_SUPPORT_MAILBOX is not configured" };
  }
  if (!getFromEmail(env)) {
    return { ok: false, reason: "HELP_FROM_EMAIL is not configured" };
  }
  if (!hasResendApiKey(env) && !isDoubleEmailMode(env)) {
    return { ok: false, reason: "RESEND_API_KEY is not configured" };
  }
  const rateLimit = assertHelpRateLimitReady(env);
  if (!rateLimit.ok) {
    return { ok: false, reason: rateLimit.reason };
  }
  return { ok: true };
}

/**
 * Cross-origin intake is allowed only when Origin is absent (same-origin /
 * server-side tests) or matches the configured Only Pools origin exactly.
 */
export function isHelpOriginAllowed(
  allowedOrigin: string | null,
  requestOrigin: string | null,
): boolean {
  if (!requestOrigin) {
    return true;
  }
  if (!allowedOrigin) {
    return false;
  }
  return requestOrigin === allowedOrigin;
}

export function corsHeaders(
  allowedOrigin: string | null,
  requestOrigin: string | null,
): Record<string, string> {
  if (!allowedOrigin || !requestOrigin || requestOrigin !== allowedOrigin) {
    return {};
  }
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}
