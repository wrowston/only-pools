import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import {
  AuthError,
  ensureParticipant,
  hasAvailableSeason,
  requireParticipant,
} from "./lib/auth";
import {
  buildMembershipStatus,
  loadEarliestKickoffByWeek,
  resolveBoardWeek,
} from "./lib/myPoolsStatus";

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
 * Dev diagnostic: which verification claims Convex sees on the Clerk JWT.
 * Does not return secrets — only keys + booleans + whether email/phone present.
 */
export const debugAuthClaims = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) {
      return { authenticated: false as const };
    }
    const record = identity as Record<string, unknown>;
    return {
      authenticated: true as const,
      subject: identity.subject,
      emailPresent: typeof identity.email === "string",
      phonePresent:
        typeof identity.phoneNumber === "string" ||
        typeof record.phone_number === "string",
      emailVerified: identity.emailVerified ?? record.email_verified ?? null,
      phoneNumberVerified:
        identity.phoneNumberVerified ?? record.phone_number_verified ?? null,
      claimKeys: Object.keys(record).sort(),
    };
  },
});

/**
 * My Pools home: membership list with next-action status + Create Pool gate.
 * Archived Pools are excluded from the normal list unless includeArchived.
 */
export const myPools = query({
  args: {
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    let participant;
    try {
      participant = await requireParticipant(ctx);
    } catch (error) {
      if (error instanceof AuthError) {
        // Avoid crashing the client query subscription; UI shows the message.
        return {
          memberships: [],
          archivedCount: 0,
          createPoolEnabled: false,
          authError: error.message,
        };
      }
      throw error;
    }
    const createPoolEnabled = await hasAvailableSeason(ctx);
    const includeArchived = args.includeArchived === true;

    const membershipRows = await ctx.db
      .query("poolMemberships")
      .withIndex("by_participantId", (q) =>
        q.eq("participantId", participant._id),
      )
      .take(80);

    const nowMs = Date.now();
    const kickoffBySeason = new Map<
      Id<"poolSeasons">,
      Map<number, number>
    >();

    const memberships = [];
    const archivedMemberships = [];
    for (const row of membershipRows) {
      if (row.status !== "active") continue;
      const pool = await ctx.db.get(row.poolId);
      if (!pool || (pool.status !== "active" && pool.status !== "completed")) {
        continue;
      }

      let earliestByWeek = kickoffBySeason.get(pool.seasonId);
      if (!earliestByWeek) {
        earliestByWeek = await loadEarliestKickoffByWeek(ctx, pool.seasonId);
        kickoffBySeason.set(pool.seasonId, earliestByWeek);
      }
      const boardWeek = resolveBoardWeek({
        startWeek: pool.startWeek,
        earliestKickoffByWeek: earliestByWeek,
        nowMs,
      });
      const status = await buildMembershipStatus(ctx, {
        pool,
        participantId: participant._id,
        boardWeek,
      });

      const entry = {
        poolId: pool._id,
        name: pool.name,
        role: row.role,
        type: pool.type,
        startWeek: pool.startWeek,
        status: pool.status,
        archived: pool.archived === true,
        boardWeek: status.boardWeek,
        pickStatus: status.pickStatus,
        standing: status.standing,
        nextAction: status.nextAction,
      };
      if (pool.archived === true) {
        archivedMemberships.push(entry);
        if (includeArchived) {
          memberships.push(entry);
        }
      } else {
        memberships.push(entry);
      }
    }

    return {
      memberships,
      archivedCount: archivedMemberships.length,
      createPoolEnabled,
      authError: null as string | null,
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
