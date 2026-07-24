/**
 * Help intake deployment configuration — CORS origin, mailbox, Resend gating.
 * Production fails closed without required config; non-prod never sends real mail.
 */

import { resolveDeploymentKind } from "./syncGate";

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
  return { ok: true };
}

export function corsHeaders(
  origin: string | null,
  requestOrigin: string | null,
): Record<string, string> {
  const allowed = origin ?? requestOrigin;
  if (!allowed) {
    return {};
  }
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}
