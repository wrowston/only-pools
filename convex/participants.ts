import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  AuthError,
  confirmAge,
  ensureParticipant,
  hasAvailableSeason,
  requireParticipant,
} from "./lib/auth";

/**
 * Create or refresh the Clerk-linked Participant after dual verification.
 */
export const ensureMyParticipant = mutation({
  args: {},
  handler: async (ctx) => {
    const participantId = await ensureParticipant(ctx);
    return { participantId };
  },
});

/**
 * Record age 18+ confirmation after the in-app gate (or Clerk custom field).
 * Requires verified email + phone from the JWT.
 */
export const confirmMyAge = mutation({
  args: {},
  handler: async (ctx) => {
    const participantId = await confirmAge(ctx);
    return { participantId };
  },
});

/**
 * My Pools home: membership list with next-action status + Create Pool gate.
 */
export const myPools = query({
  args: {},
  handler: async (ctx) => {
    const participant = await requireParticipant(ctx);
    const createPoolEnabled = await hasAvailableSeason(ctx);

    const membershipRows = await ctx.db
      .query("poolMemberships")
      .withIndex("by_participantId", (q) =>
        q.eq("participantId", participant._id),
      )
      .take(50);

    const memberships = [];
    for (const row of membershipRows) {
      if (row.status !== "active") continue;
      const pool = await ctx.db.get(row.poolId);
      if (!pool || (pool.status !== "active" && pool.status !== "completed")) {
        continue;
      }
      memberships.push({
        poolId: pool._id,
        name: pool.name,
        role: row.role,
        type: pool.type,
        startWeek: pool.startWeek,
        status: pool.status,
        nextAction: "open_week_board" as const,
      });
    }

    return {
      memberships,
      createPoolEnabled,
    };
  },
});

/**
 * Example deny-by-default surface for acceptance scenario 36.
 * Client-supplied participantId / role are accepted as args only to prove they
 * are ignored — authorization always derives from ctx.auth.
 */
export const privilegedParticipantSnapshot = query({
  args: {
    participantId: v.optional(v.id("participants")),
    role: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Intentionally ignore args.participantId and args.role.
    void args.participantId;
    void args.role;

    try {
      const participant = await requireParticipant(ctx);
      return {
        participantId: participant._id,
        displayName: participant.displayName,
        emailVerified: participant.emailVerified,
        phoneVerified: participant.phoneVerified,
        ageConfirmed: participant.ageConfirmed,
      };
    } catch (error) {
      if (error instanceof AuthError) {
        return null;
      }
      throw error;
    }
  },
});

/**
 * Mutation variant of deny-by-default: unauthorized callers get an error;
 * supplied role never elevates privileges.
 */
export const privilegedNoop = mutation({
  args: {
    role: v.optional(v.string()),
    participantId: v.optional(v.id("participants")),
  },
  handler: async (ctx, args) => {
    void args.role;
    void args.participantId;
    const participant = await requireParticipant(ctx);
    return { ok: true as const, participantId: participant._id };
  },
});
