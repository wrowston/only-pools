import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  type MutationCtx,
} from "./_generated/server";
import { formatPickReminderEmail } from "./lib/notificationBodies";
import { PICK_REMINDER_LEAD_MS } from "./lib/notificationConfig";
import {
  hasVerifiedEmail,
  prefersEmailPickReminders,
} from "./lib/notificationPrefs";
import { isPoolArchived } from "./lib/poolArchive";
import { listActiveEntriesForParticipant } from "./lib/poolEntries";
import { enqueueNotificationDelivery } from "./notificationDelivery";

async function earliestKickoffForSeasonWeek(
  ctx: MutationCtx,
  seasonId: Id<"poolSeasons">,
  week: number,
): Promise<number | null> {
  const games = await ctx.db
    .query("nflGames")
    .withIndex("by_seasonId_and_week", (q) =>
      q.eq("seasonId", seasonId).eq("week", week),
    )
    .collect();
  if (games.length === 0) return null;
  return Math.min(...games.map((g) => g.scheduledKickoffMs));
}

async function incompleteEntryNumbers(args: {
  ctx: MutationCtx;
  pool: Doc<"pools">;
  participantId: Id<"participants">;
  week: number;
}): Promise<number[]> {
  const entries = await listActiveEntriesForParticipant(
    args.ctx,
    args.pool._id,
    args.participantId,
  );
  const incomplete: number[] = [];

  for (const entry of entries) {
    if (args.pool.type === "survivor") {
      const standing = await args.ctx.db
        .query("seasonStandings")
        .withIndex("by_poolId_and_entryId", (q) =>
          q.eq("poolId", args.pool._id).eq("entryId", entry._id),
        )
        .unique();
      const eligibility = standing?.eligibility ?? "alive";
      if (eligibility === "eliminated" || eligibility === "winner") {
        continue;
      }
      const pick = await args.ctx.db
        .query("survivorPicks")
        .withIndex("by_poolId_and_entryId_and_week", (q) =>
          q
            .eq("poolId", args.pool._id)
            .eq("entryId", entry._id)
            .eq("week", args.week),
        )
        .unique();
      if (!pick || pick.provenance !== "authored") {
        incomplete.push(entry.entryNumber);
      }
    } else {
      const set = await args.ctx.db
        .query("confidencePickSets")
        .withIndex("by_poolId_and_entryId_and_week", (q) =>
          q
            .eq("poolId", args.pool._id)
            .eq("entryId", entry._id)
            .eq("week", args.week),
        )
        .unique();
      if (!set || set.origin === "untouched") {
        incomplete.push(entry.entryNumber);
        continue;
      }
      const picks = await args.ctx.db
        .query("confidencePicks")
        .withIndex("by_pickSetId", (q) => q.eq("pickSetId", set._id))
        .take(64);
      // Authored but partial sheets still need reminders for blank games.
      if (
        picks.length === 0 ||
        picks.some((p) => p.pickedTeamId === undefined)
      ) {
        incomplete.push(entry.entryNumber);
      }
    }
  }

  return incomplete.sort((a, b) => a - b);
}

/**
 * Ensure a pick-reminder job exists for this pool/week at firstKickoff - 24h.
 * Reschedules when kickoff moves; never double-sends (delivery dedupe).
 */
export async function ensurePickReminderScheduled(
  ctx: MutationCtx,
  args: {
    poolId: Id<"pools">;
    week: number;
    firstKickoffMs: number;
    nowMs?: number;
  },
): Promise<void> {
  const nowMs = args.nowMs ?? Date.now();
  // Picks are no longer "due soon" once the slate has started.
  if (args.firstKickoffMs <= nowMs) {
    return;
  }
  const fireAtMs = args.firstKickoffMs - PICK_REMINDER_LEAD_MS;

  const existing = await ctx.db
    .query("notificationPickReminderJobs")
    .withIndex("by_poolId_and_week", (q) =>
      q.eq("poolId", args.poolId).eq("week", args.week),
    )
    .unique();

  if (
    existing &&
    existing.firstKickoffMs === args.firstKickoffMs &&
    existing.scheduledJobId
  ) {
    return;
  }

  if (existing?.scheduledJobId) {
    try {
      await ctx.scheduler.cancel(existing.scheduledJobId);
    } catch {
      // already started/finished
    }
  }

  const delayMs = Math.max(0, fireAtMs - nowMs);
  const jobRowId =
    existing?._id ??
    (await ctx.db.insert("notificationPickReminderJobs", {
      poolId: args.poolId,
      week: args.week,
      firstKickoffMs: args.firstKickoffMs,
      fireAtMs,
    }));

  if (existing) {
    await ctx.db.patch(existing._id, {
      firstKickoffMs: args.firstKickoffMs,
      fireAtMs,
      scheduledJobId: undefined,
    });
  }

  const scheduledJobId = await ctx.scheduler.runAfter(
    delayMs,
    internal.notificationPickReminders.firePickRemindersForPoolWeek,
    {
      poolId: args.poolId,
      week: args.week,
      firstKickoffMs: args.firstKickoffMs,
    },
  );
  await ctx.db.patch(jobRowId, { scheduledJobId });
}

export const firePickRemindersForPoolWeek = internalMutation({
  args: {
    poolId: v.id("pools"),
    week: v.number(),
    firstKickoffMs: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const pool = await ctx.db.get(args.poolId);
    if (!pool || pool.status !== "active" || isPoolArchived(pool)) {
      return null;
    }
    // Late or rescheduled jobs must not send after kickoff.
    if (args.firstKickoffMs <= Date.now()) {
      return null;
    }

    const memberships = await ctx.db
      .query("poolMemberships")
      .withIndex("by_poolId", (q) => q.eq("poolId", pool._id))
      .collect();

    for (const membership of memberships) {
      if (membership.status !== "active") continue;
      const participant = await ctx.db.get(membership.participantId);
      if (!participant || !hasVerifiedEmail(participant)) continue;
      if (!prefersEmailPickReminders(participant)) continue;

      const incomplete = await incompleteEntryNumbers({
        ctx,
        pool,
        participantId: participant._id,
        week: args.week,
      });
      if (incomplete.length === 0) continue;

      const { subject, bodyText } = formatPickReminderEmail({
        poolName: pool.name,
        poolId: pool._id,
        week: args.week,
        incompleteEntryNumbers: incomplete,
        firstKickoffMs: args.firstKickoffMs,
      });

      await enqueueNotificationDelivery(ctx, {
        participantId: participant._id,
        kind: "pick_reminder",
        dedupeKey: `pick_reminder:${pool._id}:${args.week}:${participant._id}`,
        toEmail: participant.email!,
        subject,
        bodyText,
        poolId: pool._id,
        week: args.week,
        scheduledForMs: args.firstKickoffMs - PICK_REMINDER_LEAD_MS,
        payloadSummary: `entries=${incomplete.join(",")}`,
      });
    }
    return null;
  },
});

/**
 * Hourly/cron: schedule reminders for active pools for weeks whose first
 * kickoff is still in the future (including within the lead window, which
 * fires immediately via ensurePickReminderScheduled).
 */
export const ensureUpcomingPickReminders = internalMutation({
  args: { nowMs: v.optional(v.number()) },
  returns: v.object({ scheduled: v.number() }),
  handler: async (ctx, args) => {
    const nowMs = args.nowMs ?? Date.now();
    const pools = await ctx.db.query("pools").collect();
    let scheduled = 0;

    for (const pool of pools) {
      if (pool.status !== "active" || isPoolArchived(pool)) continue;
      const finalWeek = pool.finalWeek ?? 18;
      for (let week = pool.startWeek; week <= finalWeek; week++) {
        const firstKickoffMs = await earliestKickoffForSeasonWeek(
          ctx,
          pool.seasonId,
          week,
        );
        if (firstKickoffMs === null) continue;
        // Slate already started — do not schedule a late "picks due soon".
        if (firstKickoffMs <= nowMs) continue;

        await ensurePickReminderScheduled(ctx, {
          poolId: pool._id,
          week,
          firstKickoffMs,
          nowMs,
        });
        scheduled += 1;
      }
    }

    return { scheduled };
  },
});
