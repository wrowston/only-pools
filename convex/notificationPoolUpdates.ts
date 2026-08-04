import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalMutation,
  type MutationCtx,
} from "./_generated/server";
import { formatPoolUpdateEmail } from "./lib/notificationBodies";
import {
  POOL_UPDATE_DEBOUNCE_MS,
} from "./lib/notificationConfig";
import {
  hasVerifiedEmail,
  prefersEmailPoolUpdates,
} from "./lib/notificationPrefs";
import { isPoolArchived } from "./lib/poolArchive";
import { enqueueNotificationDelivery } from "./notificationDelivery";

/**
 * Book a 15-minute debounced pool description/banner notification flush.
 * Called from Owner/Admin update mutations after a successful write.
 */
export async function schedulePoolUpdateNotification(
  ctx: MutationCtx,
  args: {
    poolId: Id<"pools">;
    field: "description" | "banner";
    latestText: string;
    editorParticipantId: Id<"participants">;
    nowMs?: number;
  },
): Promise<void> {
  const nowMs = args.nowMs ?? Date.now();
  const flushAtMs = nowMs + POOL_UPDATE_DEBOUNCE_MS;

  const existing = await ctx.db
    .query("notificationDebounces")
    .withIndex("by_poolId_and_field", (q) =>
      q.eq("poolId", args.poolId).eq("field", args.field),
    )
    .unique();

  if (existing?.scheduledJobId) {
    try {
      await ctx.scheduler.cancel(existing.scheduledJobId);
    } catch {
      // Job may already have started/finished — flush is still guarded by flushAtMs.
    }
  }

  const debounceId = existing
    ? existing._id
    : await ctx.db.insert("notificationDebounces", {
        poolId: args.poolId,
        field: args.field,
        flushAtMs,
        latestText: args.latestText,
        editorParticipantId: args.editorParticipantId,
      });

  if (existing) {
    await ctx.db.patch(existing._id, {
      flushAtMs,
      latestText: args.latestText,
      editorParticipantId: args.editorParticipantId,
      scheduledJobId: undefined,
    });
  }

  const jobId = await ctx.scheduler.runAfter(
    POOL_UPDATE_DEBOUNCE_MS,
    internal.notificationPoolUpdates.flushPoolUpdateDebounce,
    {
      debounceId,
      expectedFlushAtMs: flushAtMs,
    },
  );
  await ctx.db.patch(debounceId, { scheduledJobId: jobId });
}

export const flushPoolUpdateDebounce = internalMutation({
  args: {
    debounceId: v.id("notificationDebounces"),
    expectedFlushAtMs: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.debounceId);
    if (!row) return null;
    // Stale job after reschedule — no-op.
    if (row.flushAtMs !== args.expectedFlushAtMs) return null;

    const pool = await ctx.db.get(row.poolId);
    if (!pool || pool.status !== "active" || isPoolArchived(pool)) {
      await ctx.db.delete(row._id);
      return null;
    }

    const memberships = await ctx.db
      .query("poolMemberships")
      .withIndex("by_poolId", (q) => q.eq("poolId", pool._id))
      .collect();
    const active = memberships.filter((m) => m.status === "active");

    // Floor window to 15m for stable dedupe keys across the coalesce window.
    const windowStartMs =
      Math.floor(row.flushAtMs / POOL_UPDATE_DEBOUNCE_MS) *
      POOL_UPDATE_DEBOUNCE_MS;
    const kind =
      row.field === "description" ? "pool_description" : "pool_banner";
    const { subject, bodyText, bodyHtml } = formatPoolUpdateEmail({
      poolName: pool.name,
      poolId: pool._id,
      field: row.field,
      latestText: row.latestText,
    });

    for (const membership of active) {
      const participant = await ctx.db.get(membership.participantId);
      if (!participant || !hasVerifiedEmail(participant)) continue;
      if (!prefersEmailPoolUpdates(participant)) continue;

      await enqueueNotificationDelivery(ctx, {
        participantId: participant._id,
        kind,
        dedupeKey: `${kind}:${pool._id}:${windowStartMs}:${participant._id}`,
        toEmail: participant.email!,
        subject,
        bodyText,
        bodyHtml,
        poolId: pool._id,
        payloadSummary: row.latestText.slice(0, 200),
      });
    }

    await ctx.db.delete(row._id);
    return null;
  },
});
