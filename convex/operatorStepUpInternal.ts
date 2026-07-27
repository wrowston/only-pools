import { v } from "convex/values";

import { internalMutation } from "./_generated/server";

export const recordVerifiedOperatorStepUp = internalMutation({
  args: {
    tokenIdentifier: v.string(),
    clerkUserId: v.string(),
    sessionId: v.string(),
    verifiedAtMs: v.number(),
  },
  handler: async (ctx, args) => {
    const participant = await ctx.db
      .query("participants")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", args.tokenIdentifier),
      )
      .unique();
    if (
      !participant ||
      participant.clerkUserId !== args.clerkUserId
    ) {
      throw new Error(
        "Production Operator Participant identity does not match the verified Clerk session",
      );
    }
    await ctx.db.patch(participant._id, {
      operatorStepUpVerifiedAtMs: args.verifiedAtMs,
      operatorStepUpSessionId: args.sessionId,
    });
    return {
      operatorStepUpVerifiedAtMs: args.verifiedAtMs,
      sessionId: args.sessionId,
    };
  },
});
