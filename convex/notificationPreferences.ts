import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireParticipant } from "./lib/auth";
import { resolveNotificationPreferences } from "./lib/notificationPrefs";

const prefsValidator = v.object({
  emailPickReminders: v.boolean(),
  emailPoolUpdates: v.boolean(),
  emailWeeklySummary: v.boolean(),
});

export const getMyNotificationPreferences = query({
  args: {},
  returns: prefsValidator,
  handler: async (ctx) => {
    const participant = await requireParticipant(ctx);
    return resolveNotificationPreferences(participant);
  },
});

export const updateMyNotificationPreferences = mutation({
  args: {
    emailPickReminders: v.optional(v.boolean()),
    emailPoolUpdates: v.optional(v.boolean()),
    emailWeeklySummary: v.optional(v.boolean()),
  },
  returns: prefsValidator,
  handler: async (ctx, args) => {
    const participant = await requireParticipant(ctx);
    const patch: {
      emailPickReminders?: boolean;
      emailPoolUpdates?: boolean;
      emailWeeklySummary?: boolean;
    } = {};
    if (args.emailPickReminders !== undefined) {
      patch.emailPickReminders = args.emailPickReminders;
    }
    if (args.emailPoolUpdates !== undefined) {
      patch.emailPoolUpdates = args.emailPoolUpdates;
    }
    if (args.emailWeeklySummary !== undefined) {
      patch.emailWeeklySummary = args.emailWeeklySummary;
    }
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(participant._id, patch);
    }
    const updated = (await ctx.db.get(participant._id)) ?? participant;
    return resolveNotificationPreferences(updated);
  },
});
