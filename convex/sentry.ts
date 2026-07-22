/**
 * Deliver Convex-originated Sentry captures via the Store API.
 * Mutations schedule this action through `enqueueSentryDelivery`.
 */

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { createLogger } from "./lib/log";
import type { SentryCapture, SentryLevel } from "./lib/sentry";

const log = createLogger("sentry");

const levelValidator = v.union(
  v.literal("info"),
  v.literal("warning"),
  v.literal("error"),
  v.literal("fatal"),
);

type ParsedDsn = {
  publicKey: string;
  host: string;
  projectId: string;
  protocol: string;
};

function parseDsn(dsn: string): ParsedDsn | null {
  try {
    const url = new URL(dsn);
    const publicKey = url.username;
    const projectId = url.pathname.replace(/^\//, "").split("/")[0];
    if (!publicKey || !projectId || !url.host) return null;
    return {
      publicKey,
      host: url.host,
      projectId,
      protocol: url.protocol.replace(":", "") || "https",
    };
  } catch {
    return null;
  }
}

function eventId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function postStoreEvent(args: {
  dsn: string;
  message: string;
  level: SentryLevel;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  atMs: number;
}): Promise<void> {
  const parsed = parseDsn(args.dsn);
  if (!parsed) return;

  const storeUrl = `${parsed.protocol}://${parsed.host}/api/${parsed.projectId}/store/`;
  const body = {
    event_id: eventId(),
    timestamp: args.atMs / 1000,
    platform: "javascript",
    logger: "convex",
    level: args.level,
    message: args.message,
    tags: args.tags,
    extra: args.extra,
    environment:
      process.env.SENTRY_ENVIRONMENT?.trim() ||
      process.env.DEPLOYMENT_KIND?.trim() ||
      "production",
  };

  const response = await fetch(storeUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Sentry-Auth": [
        "Sentry sentry_version=7",
        `sentry_client=only-pools-convex/1.0`,
        `sentry_key=${parsed.publicKey}`,
      ].join(", "),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    log.error("sentry_store_failed", {
      status: response.status,
      bodyPreview: text.slice(0, 200),
      level: args.level,
    });
  } else {
    log.info("sentry_store_delivered", {
      level: args.level,
      pagesProduction: true,
    });
  }
}

/**
 * Schedule delivery to Sentry when the capture is eligible to page production.
 * No-op in Dev/Preview or when DSN is unset (keeps mutations offline-safe).
 */
export async function enqueueSentryDelivery(
  ctx: Pick<MutationCtx, "scheduler">,
  record: SentryCapture,
): Promise<void> {
  if (!record.pagesProduction) return;

  const extraJson =
    record.extra === undefined ? undefined : JSON.stringify(record.extra);

  await ctx.scheduler.runAfter(0, internal.sentry.deliverCapture, {
    message: record.message,
    level: record.level,
    tags: record.tags,
    extraJson,
    atMs: record.atMs,
  });
}

export const deliverCapture = internalAction({
  args: {
    message: v.string(),
    level: levelValidator,
    tags: v.optional(v.record(v.string(), v.string())),
    extraJson: v.optional(v.string()),
    atMs: v.number(),
  },
  handler: async (_ctx, args) => {
    const dsn =
      process.env.SENTRY_DSN?.trim() ||
      process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();
    if (!dsn) return;

    let extra: Record<string, unknown> | undefined;
    if (args.extraJson !== undefined) {
      try {
        const parsed: unknown = JSON.parse(args.extraJson);
        if (
          parsed !== null &&
          typeof parsed === "object" &&
          !Array.isArray(parsed)
        ) {
          extra = parsed as Record<string, unknown>;
        }
      } catch {
        extra = { raw: args.extraJson };
      }
    }

    await postStoreEvent({
      dsn,
      message: args.message,
      level: args.level,
      tags: args.tags,
      extra,
      atMs: args.atMs,
    });
  },
});
