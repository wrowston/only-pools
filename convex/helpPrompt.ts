import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireParticipant } from "./lib/auth";
import type { MutationCtx, QueryCtx } from "./_generated/server";

export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_PROMPT_DISPLAYS = 2;

const promptStateReturnValidator = v.object({
  canShow: v.boolean(),
  displayCount: v.number(),
  snoozeUntilMs: v.union(v.number(), v.null()),
  retired: v.boolean(),
  eligible: v.boolean(),
});

type PromptCtx = QueryCtx | MutationCtx;

async function loadPromptState(
  ctx: PromptCtx,
  participantId: Id<"participants">,
): Promise<Doc<"feedbackPromptState"> | null> {
  return await ctx.db
    .query("feedbackPromptState")
    .withIndex("by_participantId", (q) => q.eq("participantId", participantId))
    .unique();
}

async function ensurePromptState(
  ctx: MutationCtx,
  participantId: Id<"participants">,
  nowMs: number,
): Promise<Doc<"feedbackPromptState">> {
  const existing = await loadPromptState(ctx, participantId);
  if (existing) return existing;

  const id = await ctx.db.insert("feedbackPromptState", {
    participantId,
    displayCount: 0,
    retired: false,
    updatedAtMs: nowMs,
  });
  const created = await ctx.db.get(id);
  if (!created) {
    throw new Error("Failed to create feedback prompt state");
  }
  return created;
}

function isEligible(state: Doc<"feedbackPromptState">): boolean {
  return (
    state.ownerEligibleAtMs !== undefined ||
    state.memberEligibleAtMs !== undefined
  );
}

export function computeCanShowPrompt(
  state: Doc<"feedbackPromptState">,
  nowMs: number,
): boolean {
  if (!isEligible(state)) return false;
  if (state.retired) return false;
  if (state.displayCount >= MAX_PROMPT_DISPLAYS) return false;
  if (state.snoozeUntilMs !== undefined && nowMs < state.snoozeUntilMs) {
    return false;
  }
  return true;
}

async function participantOwnsPool(
  ctx: PromptCtx,
  participantId: Id<"participants">,
): Promise<boolean> {
  const owned = await ctx.db
    .query("pools")
    .withIndex("by_ownerParticipantId", (q) =>
      q.eq("ownerParticipantId", participantId),
    )
    .first();
  return owned !== null;
}

/** Owner milestone step 1: Participant created a Pool. */
export async function markOwnerPoolCreated(
  ctx: MutationCtx,
  participantId: Id<"participants">,
  nowMs: number,
): Promise<void> {
  const state = await ensurePromptState(ctx, participantId, nowMs);
  if (state.ownerCreatedPoolAtMs !== undefined) return;

  await ctx.db.patch(state._id, {
    ownerCreatedPoolAtMs: nowMs,
    updatedAtMs: nowMs,
  });
}

/** Owner milestone step 2: shared Pool Invite after creating a Pool. */
export async function markOwnerInviteShared(
  ctx: MutationCtx,
  participantId: Id<"participants">,
  nowMs: number,
): Promise<void> {
  const state = await ensurePromptState(ctx, participantId, nowMs);
  if (state.ownerEligibleAtMs !== undefined) return;

  const hasCreatedPool =
    state.ownerCreatedPoolAtMs !== undefined ||
    (await participantOwnsPool(ctx, participantId));
  if (!hasCreatedPool) return;

  await ctx.db.patch(state._id, {
    ownerEligibleAtMs: nowMs,
    updatedAtMs: nowMs,
  });
}

async function countValidSurvivorPicks(
  ctx: MutationCtx,
  participantId: Id<"participants">,
): Promise<number> {
  let count = 0;
  const memberships = await ctx.db
    .query("poolMemberships")
    .withIndex("by_participantId", (q) => q.eq("participantId", participantId))
    .take(50);

  for (const membership of memberships) {
    for await (const pick of ctx.db
      .query("survivorPicks")
      .withIndex("by_poolId_and_participantId", (q) =>
        q.eq("poolId", membership.poolId).eq("participantId", participantId),
      )) {
      if (pick.nflTeamId !== undefined) count += 1;
    }
  }
  return count;
}

async function participantHasPriorCompleteConfidenceSet(
  ctx: MutationCtx,
  participantId: Id<"participants">,
  excludePickSetId: Id<"confidencePickSets">,
): Promise<boolean> {
  const memberships = await ctx.db
    .query("poolMemberships")
    .withIndex("by_participantId", (q) => q.eq("participantId", participantId))
    .take(50);

  for (const membership of memberships) {
    for (let week = 1; week <= 18; week += 1) {
      const pickSet = await ctx.db
        .query("confidencePickSets")
        .withIndex("by_poolId_and_participantId_and_week", (q) =>
          q
            .eq("poolId", membership.poolId)
            .eq("participantId", participantId)
            .eq("week", week),
        )
        .unique();
      if (!pickSet || pickSet._id === excludePickSetId) continue;
      const sheet = await ctx.db
        .query("confidencePickSheets")
        .withIndex("by_poolId_and_week", (q) =>
          q.eq("poolId", pickSet.poolId).eq("week", pickSet.week),
        )
        .unique();
      if (!sheet) continue;

      const picks = await ctx.db
        .query("confidencePicks")
        .withIndex("by_pickSetId", (q) => q.eq("pickSetId", pickSet._id))
        .collect();
      if (
        isConfidencePickSetComplete(pickSet, picks, sheet.gameIds.length)
      ) {
        return true;
      }
    }
  }
  return false;
}

function isConfidencePickSetComplete(
  pickSet: Doc<"confidencePickSets">,
  picks: Doc<"confidencePicks">[],
  requiredGameCount: number,
): boolean {
  if (requiredGameCount === 0) return false;
  if (pickSet.tiebreakerPrediction === undefined) return false;
  const withWinner = picks.filter((p) => p.pickedTeamId !== undefined);
  return withWinner.length === requiredGameCount;
}

export async function maybeMarkSurvivorPlayingMilestone(
  ctx: MutationCtx,
  participantId: Id<"participants">,
  nowMs: number,
): Promise<void> {
  const state = await loadPromptState(ctx, participantId);
  if (state?.memberEligibleAtMs !== undefined) return;

  const validPickCount = await countValidSurvivorPicks(ctx, participantId);
  if (validPickCount < 1) return;

  await markMemberPlayingMilestone(ctx, participantId, nowMs);
}

/** Member milestone: first valid Survivor Pick or complete Confidence Pick Set. */
export async function markMemberPlayingMilestone(
  ctx: MutationCtx,
  participantId: Id<"participants">,
  nowMs: number,
): Promise<void> {
  const state = await ensurePromptState(ctx, participantId, nowMs);
  if (state.memberEligibleAtMs !== undefined) return;

  await ctx.db.patch(state._id, {
    memberEligibleAtMs: nowMs,
    updatedAtMs: nowMs,
  });
}

export async function maybeMarkConfidencePlayingMilestone(
  ctx: MutationCtx,
  participantId: Id<"participants">,
  poolId: Id<"pools">,
  week: number,
  nowMs: number,
): Promise<void> {
  const state = await loadPromptState(ctx, participantId);
  if (state?.memberEligibleAtMs !== undefined) return;

  const pickSet = await ctx.db
    .query("confidencePickSets")
    .withIndex("by_poolId_and_participantId_and_week", (q) =>
      q.eq("poolId", poolId).eq("participantId", participantId).eq("week", week),
    )
    .unique();
  if (!pickSet) return;

  const sheet = await ctx.db
    .query("confidencePickSheets")
    .withIndex("by_poolId_and_week", (q) => q.eq("poolId", poolId).eq("week", week))
    .unique();
  if (!sheet) return;

  const picks = await ctx.db
    .query("confidencePicks")
    .withIndex("by_pickSetId", (q) => q.eq("pickSetId", pickSet._id))
    .collect();

  if (!isConfidencePickSetComplete(pickSet, picks, sheet.gameIds.length)) {
    return;
  }

  const hadPrior = await participantHasPriorCompleteConfidenceSet(
    ctx,
    participantId,
    pickSet._id,
  );
  if (hadPrior) return;

  await markMemberPlayingMilestone(ctx, participantId, nowMs);
}

export const markOwnerPoolCreatedInternal = internalMutation({
  args: {
    participantId: v.id("participants"),
    nowMs: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await markOwnerPoolCreated(ctx, args.participantId, args.nowMs);
    return null;
  },
});

export const markOwnerInviteSharedInternal = internalMutation({
  args: {
    participantId: v.id("participants"),
    nowMs: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await markOwnerInviteShared(ctx, args.participantId, args.nowMs);
    return null;
  },
});

export const markMemberPlayingMilestoneInternal = internalMutation({
  args: {
    participantId: v.id("participants"),
    nowMs: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await markMemberPlayingMilestone(ctx, args.participantId, args.nowMs);
    return null;
  },
});

export const getPromptState = query({
  args: { nowMs: v.number() },
  returns: promptStateReturnValidator,
  handler: async (ctx, args) => {
    const participant = await requireParticipant(ctx);
    const state = await loadPromptState(ctx, participant._id);

    if (!state) {
      return {
        canShow: false,
        displayCount: 0,
        snoozeUntilMs: null,
        retired: false,
        eligible: false,
      };
    }

    return {
      canShow: computeCanShowPrompt(state, args.nowMs),
      displayCount: state.displayCount,
      snoozeUntilMs: state.snoozeUntilMs ?? null,
      retired: state.retired,
      eligible: isEligible(state),
    };
  },
});

export const recordPromptShown = mutation({
  args: { nowMs: v.number() },
  returns: promptStateReturnValidator,
  handler: async (ctx, args) => {
    const participant = await requireParticipant(ctx);
    const state = await ensurePromptState(ctx, participant._id, args.nowMs);

    if (!computeCanShowPrompt(state, args.nowMs)) {
      return {
        canShow: false,
        displayCount: state.displayCount,
        snoozeUntilMs: state.snoozeUntilMs ?? null,
        retired: state.retired,
        eligible: isEligible(state),
      };
    }

    const nextDisplayCount = state.displayCount + 1;
    const nextRetired =
      state.retired || nextDisplayCount >= MAX_PROMPT_DISPLAYS;

    await ctx.db.patch(state._id, {
      displayCount: nextDisplayCount,
      retired: nextRetired,
      updatedAtMs: args.nowMs,
    });

    const updated = await ctx.db.get(state._id);
    if (!updated) {
      throw new Error("Failed to update feedback prompt state");
    }

    return {
      canShow: computeCanShowPrompt(updated, args.nowMs),
      displayCount: updated.displayCount,
      snoozeUntilMs: updated.snoozeUntilMs ?? null,
      retired: updated.retired,
      eligible: isEligible(updated),
    };
  },
});

export const snoozePrompt = mutation({
  args: { nowMs: v.number() },
  returns: promptStateReturnValidator,
  handler: async (ctx, args) => {
    const participant = await requireParticipant(ctx);
    const state = await ensurePromptState(ctx, participant._id, args.nowMs);

    const nextRetired =
      state.retired || state.displayCount >= MAX_PROMPT_DISPLAYS;
    const patch: {
      snoozeUntilMs?: number;
      retired: boolean;
      updatedAtMs: number;
    } = {
      retired: nextRetired,
      updatedAtMs: args.nowMs,
    };

    if (!nextRetired) {
      patch.snoozeUntilMs = args.nowMs + SEVEN_DAYS_MS;
    }

    await ctx.db.patch(state._id, patch);

    const updated = await ctx.db.get(state._id);
    if (!updated) {
      throw new Error("Failed to update feedback prompt state");
    }

    return {
      canShow: computeCanShowPrompt(updated, args.nowMs),
      displayCount: updated.displayCount,
      snoozeUntilMs: updated.snoozeUntilMs ?? null,
      retired: updated.retired,
      eligible: isEligible(updated),
    };
  },
});

export const retirePrompt = mutation({
  args: { nowMs: v.number() },
  returns: promptStateReturnValidator,
  handler: async (ctx, args) => {
    const participant = await requireParticipant(ctx);
    const state = await ensurePromptState(ctx, participant._id, args.nowMs);

    await ctx.db.patch(state._id, {
      retired: true,
      updatedAtMs: args.nowMs,
    });

    const updated = await ctx.db.get(state._id);
    if (!updated) {
      throw new Error("Failed to update feedback prompt state");
    }

    return {
      canShow: false,
      displayCount: updated.displayCount,
      snoozeUntilMs: updated.snoozeUntilMs ?? null,
      retired: updated.retired,
      eligible: isEligible(updated),
    };
  },
});
