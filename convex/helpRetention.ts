import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import { internalMutation } from "./_generated/server";

const DEFAULT_BATCH_SIZE = 50;

export type PurgeExpiredHelpDataResult = {
  intakeDeleted: number;
  throttleDeleted: number;
  continued: boolean;
};

export async function purgeExpiredHelpDataInternal(
  ctx: MutationCtx,
  args: { nowMs: number; batchSize?: number },
): Promise<PurgeExpiredHelpDataResult> {
  const batchSize = args.batchSize ?? DEFAULT_BATCH_SIZE;
  const nowMs = args.nowMs;

  const expiredIntake = await ctx.db
    .query("helpIntake")
    .withIndex("by_expiresAtMs", (q) => q.lt("expiresAtMs", nowMs))
    .take(batchSize);

  for (const doc of expiredIntake) {
    await ctx.db.delete("helpIntake", doc._id);
  }

  const expiredThrottle = await ctx.db
    .query("helpThrottle")
    .withIndex("by_expiresAtMs", (q) => q.lt("expiresAtMs", nowMs))
    .take(batchSize);

  for (const doc of expiredThrottle) {
    await ctx.db.delete("helpThrottle", doc._id);
  }

  const intakeDeleted = expiredIntake.length;
  const throttleDeleted = expiredThrottle.length;
  const continued =
    intakeDeleted === batchSize || throttleDeleted === batchSize;

  if (continued) {
    await ctx.scheduler.runAfter(
      0,
      internal.helpRetention.purgeExpiredHelpData,
      { nowMs, batchSize },
    );
  }

  return { intakeDeleted, throttleDeleted, continued };
}

export const purgeExpiredHelpData = internalMutation({
  args: {
    nowMs: v.number(),
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    intakeDeleted: v.number(),
    throttleDeleted: v.number(),
    continued: v.boolean(),
  }),
  handler: async (ctx, args) => {
    return await purgeExpiredHelpDataInternal(ctx, args);
  },
});

export const purgeExpiredHelpDataCron = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await purgeExpiredHelpDataInternal(ctx, { nowMs: Date.now() });
    return null;
  },
});
