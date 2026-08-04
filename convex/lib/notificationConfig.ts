/**
 * Product notification email config — separate from Help intake gating.
 * Production sends via Resend; non-prod always uses the in-memory sink.
 */

import { resolveDeploymentKind } from "./syncGate";

export const DEFAULT_NOTIFICATIONS_FROM_EMAIL =
  "Only Pools <notifications@tryonlypools.com>";
export const DEFAULT_NOTIFICATIONS_REPLY_TO = "will@tryonlypools.com";

export const POOL_UPDATE_DEBOUNCE_MS = 15 * 60 * 1000;
export const PICK_REMINDER_LEAD_MS = 24 * 60 * 60 * 1000;
export const NOTIFICATION_MAX_ATTEMPTS = 3;

export function getNotificationsFromEmail(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): string {
  return (
    env.NOTIFICATIONS_FROM_EMAIL?.trim() || DEFAULT_NOTIFICATIONS_FROM_EMAIL
  );
}

export function getNotificationsReplyTo(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): string {
  return env.NOTIFICATIONS_REPLY_TO?.trim() || DEFAULT_NOTIFICATIONS_REPLY_TO;
}

export function hasResendApiKey(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): boolean {
  return Boolean(env.RESEND_API_KEY?.trim());
}

/**
 * True only when this deployment may POST product notification mail to Resend.
 * Does not require Help mailbox / HELP_EMAIL_MODE.
 */
export function canDeliverProductEmail(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): boolean {
  const kind = resolveDeploymentKind(env);
  if (kind !== "production") return false;
  if (!hasResendApiKey(env)) return false;
  if (!getNotificationsFromEmail(env)) return false;
  return true;
}

/** Public site origin for deep links and settings footers. */
export function getNotificationSiteOrigin(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): string {
  const client = env.CLIENT_ORIGIN?.trim();
  if (client) return client.replace(/\/$/, "");
  const site = env.NEXT_PUBLIC_SITE_URL?.trim();
  if (site) return site.replace(/\/$/, "");
  return "https://tryonlypools.com";
}

export function notificationSettingsUrl(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): string {
  return `${getNotificationSiteOrigin(env)}/settings/notifications`;
}

export function poolUrl(
  poolId: string,
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): string {
  return `${getNotificationSiteOrigin(env)}/pools/${poolId}`;
}

export function poolStandingsUrl(
  poolId: string,
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): string {
  return `${getNotificationSiteOrigin(env)}/pools/${poolId}/standings`;
}
