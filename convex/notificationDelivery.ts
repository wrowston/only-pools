import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import { runEffect } from "./effect/run";
import { sendEmail } from "./effect/resend/client";
import {
  canDeliverProductEmail,
  getNotificationsFromEmail,
  getNotificationsReplyTo,
  NOTIFICATION_MAX_ATTEMPTS,
} from "./lib/notificationConfig";
import { createLogger } from "./lib/log";
import { v } from "convex/values";

const log = createLogger("notificationDelivery");

const kindValidator = v.union(
  v.literal("pick_reminder"),
  v.literal("pool_description"),
  v.literal("pool_banner"),
  v.literal("weekly_summary"),
);

export async function enqueueNotificationDelivery(
  ctx: MutationCtx,
  args: {
    participantId: Id<"participants">;
    kind:
      | "pick_reminder"
      | "pool_description"
      | "pool_banner"
      | "weekly_summary";
    dedupeKey: string;
    toEmail: string;
    subject: string;
    bodyText: string;
    poolId?: Id<"pools">;
    week?: number;
    payloadSummary?: string;
    scheduledForMs?: number;
  },
): Promise<Id<"notificationDeliveries"> | null> {
  const existing = await ctx.db
    .query("notificationDeliveries")
    .withIndex("by_dedupeKey", (q) => q.eq("dedupeKey", args.dedupeKey))
    .unique();
  if (existing) {
    if (
      existing.status === "sent" ||
      existing.status === "pending" ||
      existing.status === "skipped"
    ) {
      return null;
    }
    // failed — allow retry by resetting to pending
    await ctx.db.patch(existing._id, {
      status: "pending",
      toEmail: args.toEmail,
      subject: args.subject,
      bodyText: args.bodyText,
      attemptCount: 0,
      nextAttemptAtMs: undefined,
      failureClass: undefined,
      payloadSummary: args.payloadSummary,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.notificationDelivery.deliverNotification,
      { deliveryId: existing._id },
    );
    return existing._id;
  }

  const deliveryId = await ctx.db.insert("notificationDeliveries", {
    participantId: args.participantId,
    kind: args.kind,
    dedupeKey: args.dedupeKey,
    toEmail: args.toEmail,
    subject: args.subject,
    bodyText: args.bodyText,
    status: "pending",
    attemptCount: 0,
    scheduledForMs: args.scheduledForMs,
    poolId: args.poolId,
    week: args.week,
    payloadSummary: args.payloadSummary,
  });

  await ctx.scheduler.runAfter(
    0,
    internal.notificationDelivery.deliverNotification,
    { deliveryId },
  );
  return deliveryId;
}

export const getDelivery = internalQuery({
  args: { deliveryId: v.id("notificationDeliveries") },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("notificationDeliveries"),
      participantId: v.id("participants"),
      kind: kindValidator,
      dedupeKey: v.string(),
      toEmail: v.string(),
      subject: v.string(),
      bodyText: v.string(),
      status: v.union(
        v.literal("pending"),
        v.literal("sent"),
        v.literal("failed"),
        v.literal("skipped"),
      ),
      attemptCount: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.deliveryId);
    if (!row) return null;
    return {
      _id: row._id,
      participantId: row.participantId,
      kind: row.kind,
      dedupeKey: row.dedupeKey,
      toEmail: row.toEmail,
      subject: row.subject,
      bodyText: row.bodyText,
      status: row.status,
      attemptCount: row.attemptCount,
    };
  },
});

export const markDeliveryResult = internalMutation({
  args: {
    deliveryId: v.id("notificationDeliveries"),
    status: v.union(
      v.literal("sent"),
      v.literal("failed"),
      v.literal("skipped"),
    ),
    providerMessageId: v.optional(v.string()),
    failureClass: v.optional(v.string()),
    scheduleRetry: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.deliveryId);
    if (!row) return null;
    const now = Date.now();
    const attemptCount = row.attemptCount + 1;
    if (args.status === "sent") {
      await ctx.db.patch(args.deliveryId, {
        status: "sent",
        attemptCount,
        sentAtMs: now,
        lastAttemptAtMs: now,
        providerMessageId: args.providerMessageId,
        failureClass: undefined,
        nextAttemptAtMs: undefined,
      });
      return null;
    }
    if (args.status === "skipped") {
      await ctx.db.patch(args.deliveryId, {
        status: "skipped",
        attemptCount,
        lastAttemptAtMs: now,
        failureClass: args.failureClass,
        nextAttemptAtMs: undefined,
      });
      return null;
    }
    const shouldRetry =
      args.scheduleRetry !== false &&
      attemptCount < NOTIFICATION_MAX_ATTEMPTS;
    const nextAttemptAtMs = shouldRetry
      ? now + attemptCount * 60_000
      : undefined;
    await ctx.db.patch(args.deliveryId, {
      status: shouldRetry ? "pending" : "failed",
      attemptCount,
      lastAttemptAtMs: now,
      failureClass: args.failureClass,
      nextAttemptAtMs,
    });
    if (shouldRetry && nextAttemptAtMs !== undefined) {
      await ctx.scheduler.runAfter(
        nextAttemptAtMs - now,
        internal.notificationDelivery.deliverNotification,
        { deliveryId: args.deliveryId },
      );
    }
    return null;
  },
});

export const deliverNotification = internalAction({
  args: { deliveryId: v.id("notificationDeliveries") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.runQuery(internal.notificationDelivery.getDelivery, {
      deliveryId: args.deliveryId,
    });
    if (!row) return null;
    if (row.status === "sent" || row.status === "skipped") return null;

    const env = process.env as Record<string, string | undefined>;
    const from = getNotificationsFromEmail(env);
    const replyTo = getNotificationsReplyTo(env);

    try {
      const result = await runEffect(
        sendEmail(
          {
            from,
            to: row.toEmail,
            subject: row.subject,
            text: row.bodyText,
            replyTo,
            idempotencyKey: row.dedupeKey,
          },
          env,
          { realDelivery: canDeliverProductEmail(env) },
        ),
      );
      await ctx.runMutation(internal.notificationDelivery.markDeliveryResult, {
        deliveryId: args.deliveryId,
        status: "sent",
        providerMessageId: result.id,
      });
      log.info("notification_sent", {
        deliveryId: args.deliveryId,
        kind: row.kind,
        usedSink: result.usedSink,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("notification_send_failed", {
        deliveryId: args.deliveryId,
        detail: message.slice(0, 200),
      });
      await ctx.runMutation(internal.notificationDelivery.markDeliveryResult, {
        deliveryId: args.deliveryId,
        status: "failed",
        failureClass: "send_error",
        scheduleRetry: true,
      });
    }
    return null;
  },
});
