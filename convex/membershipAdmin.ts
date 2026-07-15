import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { AuthError, requireParticipant } from "./lib/auth";
import { assertAbuseReportPayloadSafe } from "./lib/abuseReportSanitize";
import { isPoolArchived } from "./lib/poolArchive";
import { MAX_POOL_MEMBERS, MAX_MEMBERSHIPS_PER_SEASON } from "./lib/quotas";

const STEP_UP_TTL_MS = 5 * 60 * 1000;

/** Sanitized audit actions visible to current participants. */
const PARTICIPANT_VISIBLE_AUDIT_ACTIONS = new Set([
  "invite_created",
  "invite_retrieved",
  "invite_rotated",
  "invite_accepted",
  "ownership_transfer_offered",
  "ownership_transfer_cancelled",
  "ownership_transfer_accepted",
  "admin_promoted",
  "admin_demoted",
  "member_removed",
  "member_reinstated",
  "member_left",
  "pool_archived",
  "pool_restored",
]);

class MembershipAdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MembershipAdminError";
  }
}

type DbCtx = QueryCtx | MutationCtx;

function requireFreshStepUp(participant: Doc<"participants">, nowMs: number) {
  const at = participant.stepUpVerifiedAtMs;
  if (at === undefined || nowMs - at > STEP_UP_TTL_MS) {
    throw new MembershipAdminError(
      "Step-up Verification required for this administrative action",
    );
  }
}

async function writeAudit(
  ctx: MutationCtx,
  args: {
    poolId: Id<"pools">;
    actorParticipantId: Id<"participants">;
    action: string;
    metadata?: Record<string, string | number | boolean | null>;
  },
) {
  await ctx.db.insert("poolAuditEvents", {
    poolId: args.poolId,
    actorParticipantId: args.actorParticipantId,
    action: args.action,
    atMs: Date.now(),
    metadataJson: args.metadata ? JSON.stringify(args.metadata) : undefined,
  });
}

async function requireActiveMembership(
  ctx: DbCtx,
  poolId: Id<"pools">,
  participantId: Id<"participants">,
): Promise<Doc<"poolMemberships">> {
  const membership = await ctx.db
    .query("poolMemberships")
    .withIndex("by_poolId_and_participantId", (q) =>
      q.eq("poolId", poolId).eq("participantId", participantId),
    )
    .unique();
  if (!membership || membership.status !== "active") {
    throw new AuthError("Not a member of this Pool");
  }
  return membership;
}

async function requirePoolOwnerMembership(
  ctx: DbCtx,
  pool: Doc<"pools">,
  participantId: Id<"participants">,
): Promise<Doc<"poolMemberships">> {
  const membership = await requireActiveMembership(
    ctx,
    pool._id,
    participantId,
  );
  if (
    membership.role !== "owner" ||
    pool.ownerParticipantId !== participantId
  ) {
    throw new AuthError("Only the Pool Owner may perform this action");
  }
  return membership;
}

async function loadPendingOwnershipOffer(
  ctx: DbCtx,
  poolId: Id<"pools">,
): Promise<Doc<"ownershipTransferOffers"> | null> {
  const rows = await ctx.db
    .query("ownershipTransferOffers")
    .withIndex("by_poolId_and_status", (q) =>
      q.eq("poolId", poolId).eq("status", "pending"),
    )
    .take(2);
  return rows[0] ?? null;
}

function assertReason(reason: string, label: string) {
  const trimmed = reason.trim();
  if (trimmed.length < 3 || trimmed.length > 280) {
    throw new MembershipAdminError(
      `${label} requires a short reason (3–280 characters)`,
    );
  }
  return trimmed;
}

/**
 * Offer ownership to a current Pool Admin. Requires step-up. Current Owner
 * retains full authority until the Admin explicitly accepts.
 */
export const offerOwnershipTransfer = mutation({
  args: {
    poolId: v.id("pools"),
    toParticipantId: v.id("participants"),
  },
  handler: async (ctx, args) => {
    const participant = await requireParticipant(ctx);
    const pool = await ctx.db.get(args.poolId);
    if (!pool) {
      throw new MembershipAdminError("Pool not found");
    }
    await requirePoolOwnerMembership(ctx, pool, participant._id);
    const nowMs = Date.now();
    requireFreshStepUp(participant, nowMs);

    if (args.toParticipantId === participant._id) {
      throw new MembershipAdminError(
        "Cannot offer ownership transfer to yourself",
      );
    }

    const target = await requireActiveMembership(
      ctx,
      pool._id,
      args.toParticipantId,
    );
    if (target.role !== "admin") {
      throw new MembershipAdminError(
        "Ownership may only be offered to a current Pool Admin",
      );
    }

    const existing = await loadPendingOwnershipOffer(ctx, pool._id);
    if (existing) {
      throw new MembershipAdminError(
        "A pending ownership transfer offer already exists",
      );
    }

    const offerId = await ctx.db.insert("ownershipTransferOffers", {
      poolId: pool._id,
      fromParticipantId: participant._id,
      toParticipantId: args.toParticipantId,
      status: "pending",
      createdAtMs: nowMs,
    });

    await writeAudit(ctx, {
      poolId: pool._id,
      actorParticipantId: participant._id,
      action: "ownership_transfer_offered",
      metadata: {
        offerId,
        toParticipantId: args.toParticipantId,
        priorRole: "owner",
        resultingRole: "pending_accept",
      },
    });

    return { offerId, status: "pending" as const };
  },
});

/**
 * Target Admin explicitly accepts — roles swap atomically.
 */
export const acceptOwnershipTransfer = mutation({
  args: { offerId: v.id("ownershipTransferOffers") },
  handler: async (ctx, args) => {
    const participant = await requireParticipant(ctx);
    const offer = await ctx.db.get(args.offerId);
    if (!offer || offer.status !== "pending") {
      throw new MembershipAdminError("Ownership transfer offer not found");
    }
    if (offer.toParticipantId !== participant._id) {
      throw new AuthError(
        "Only the offered Pool Admin may accept ownership transfer",
      );
    }

    const pool = await ctx.db.get(offer.poolId);
    if (!pool) {
      throw new MembershipAdminError("Pool not found");
    }
    if (pool.ownerParticipantId !== offer.fromParticipantId) {
      throw new MembershipAdminError(
        "Ownership transfer offer is no longer valid",
      );
    }

    const nowMs = Date.now();
    const fromMembership = await requireActiveMembership(
      ctx,
      pool._id,
      offer.fromParticipantId,
    );
    const toMembership = await requireActiveMembership(
      ctx,
      pool._id,
      offer.toParticipantId,
    );
    if (toMembership.role !== "admin") {
      throw new MembershipAdminError(
        "Recipient must still be a current Pool Admin",
      );
    }

    // Atomic swap within this mutation transaction.
    await ctx.db.patch(pool._id, {
      ownerParticipantId: offer.toParticipantId,
    });
    await ctx.db.patch(toMembership._id, { role: "owner" });
    await ctx.db.patch(fromMembership._id, { role: "admin" });
    await ctx.db.patch(offer._id, {
      status: "accepted",
      resolvedAtMs: nowMs,
    });

    await writeAudit(ctx, {
      poolId: pool._id,
      actorParticipantId: participant._id,
      action: "ownership_transfer_accepted",
      metadata: {
        offerId: offer._id,
        priorOwnerParticipantId: offer.fromParticipantId,
        newOwnerParticipantId: offer.toParticipantId,
        priorRole: "admin",
        resultingRole: "owner",
      },
    });

    return {
      poolId: pool._id,
      ownerParticipantId: offer.toParticipantId,
    };
  },
});

export const cancelOwnershipTransfer = mutation({
  args: { offerId: v.id("ownershipTransferOffers") },
  handler: async (ctx, args) => {
    const participant = await requireParticipant(ctx);
    const offer = await ctx.db.get(args.offerId);
    if (!offer || offer.status !== "pending") {
      throw new MembershipAdminError("Ownership transfer offer not found");
    }
    const pool = await ctx.db.get(offer.poolId);
    if (!pool) {
      throw new MembershipAdminError("Pool not found");
    }
    await requirePoolOwnerMembership(ctx, pool, participant._id);

    const nowMs = Date.now();
    await ctx.db.patch(offer._id, {
      status: "cancelled",
      resolvedAtMs: nowMs,
    });

    await writeAudit(ctx, {
      poolId: pool._id,
      actorParticipantId: participant._id,
      action: "ownership_transfer_cancelled",
      metadata: {
        offerId: offer._id,
        toParticipantId: offer.toParticipantId,
      },
    });

    return { offerId: offer._id, status: "cancelled" as const };
  },
});

/**
 * Promote an active Member to Pool Admin. Owner + step-up. Not while archived.
 */
export const promoteAdmin = mutation({
  args: {
    poolId: v.id("pools"),
    participantId: v.id("participants"),
  },
  handler: async (ctx, args) => {
    const actor = await requireParticipant(ctx);
    const pool = await ctx.db.get(args.poolId);
    if (!pool) {
      throw new MembershipAdminError("Pool not found");
    }
    if (isPoolArchived(pool)) {
      throw new MembershipAdminError(
        "Restore the Archived Pool before changing roles",
      );
    }
    await requirePoolOwnerMembership(ctx, pool, actor._id);
    const nowMs = Date.now();
    requireFreshStepUp(actor, nowMs);

    const target = await requireActiveMembership(
      ctx,
      pool._id,
      args.participantId,
    );
    if (target.role !== "member") {
      throw new MembershipAdminError("Only a Pool Member may be promoted");
    }

    await ctx.db.patch(target._id, { role: "admin" });
    await writeAudit(ctx, {
      poolId: pool._id,
      actorParticipantId: actor._id,
      action: "admin_promoted",
      metadata: {
        affectedParticipantId: args.participantId,
        priorRole: "member",
        resultingRole: "admin",
      },
    });

    return { participantId: args.participantId, role: "admin" as const };
  },
});

/**
 * Demote a Pool Admin to Member. Owner + step-up. Not while archived.
 */
export const demoteAdmin = mutation({
  args: {
    poolId: v.id("pools"),
    participantId: v.id("participants"),
  },
  handler: async (ctx, args) => {
    const actor = await requireParticipant(ctx);
    const pool = await ctx.db.get(args.poolId);
    if (!pool) {
      throw new MembershipAdminError("Pool not found");
    }
    if (isPoolArchived(pool)) {
      throw new MembershipAdminError(
        "Restore the Archived Pool before changing roles",
      );
    }
    await requirePoolOwnerMembership(ctx, pool, actor._id);
    const nowMs = Date.now();
    requireFreshStepUp(actor, nowMs);

    if (args.participantId === actor._id) {
      throw new MembershipAdminError("Cannot demote yourself");
    }

    const target = await requireActiveMembership(
      ctx,
      pool._id,
      args.participantId,
    );
    if (target.role !== "admin") {
      throw new MembershipAdminError("Only a Pool Admin may be demoted");
    }

    const pending = await loadPendingOwnershipOffer(ctx, pool._id);
    if (pending && pending.toParticipantId === args.participantId) {
      await ctx.db.patch(pending._id, {
        status: "cancelled",
        resolvedAtMs: nowMs,
      });
    }

    await ctx.db.patch(target._id, { role: "member" });
    await writeAudit(ctx, {
      poolId: pool._id,
      actorParticipantId: actor._id,
      action: "admin_demoted",
      metadata: {
        affectedParticipantId: args.participantId,
        priorRole: "admin",
        resultingRole: "member",
      },
    });

    return { participantId: args.participantId, role: "member" as const };
  },
});

/**
 * Remove a participant. Owner may remove Admins/Members; Admin may remove
 * Members only. Preserves picks/standings; ends access + contact visibility.
 */
export const removeMember = mutation({
  args: {
    poolId: v.id("pools"),
    participantId: v.id("participants"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireParticipant(ctx);
    const pool = await ctx.db.get(args.poolId);
    if (!pool) {
      throw new MembershipAdminError("Pool not found");
    }
    if (pool.status === "completed") {
      throw new MembershipAdminError(
        "Completed Pools do not permit membership removal",
      );
    }
    if (isPoolArchived(pool)) {
      throw new MembershipAdminError(
        "Restore the Archived Pool before changing membership",
      );
    }

    const actorMembership = await requireActiveMembership(
      ctx,
      pool._id,
      actor._id,
    );
    if (actorMembership.role !== "owner" && actorMembership.role !== "admin") {
      throw new AuthError("Only the Pool Owner or Pool Admin may remove Members");
    }

    const reason = assertReason(args.reason, "Removal");
    if (args.participantId === actor._id) {
      throw new MembershipAdminError("Use leavePool to leave voluntarily");
    }

    const target = await requireActiveMembership(
      ctx,
      pool._id,
      args.participantId,
    );
    if (target.role === "owner") {
      throw new MembershipAdminError(
        "The Pool Owner cannot be removed — transfer ownership first",
      );
    }
    if (target.role === "admin" && actorMembership.role !== "owner") {
      throw new AuthError("Only the Pool Owner may remove a Pool Admin");
    }

    const nowMs = Date.now();
    const priorRole = target.role;
    await ctx.db.patch(target._id, {
      status: "removed",
      role: "member",
      statusReason: reason,
      statusChangedAtMs: nowMs,
    });

    const pending = await loadPendingOwnershipOffer(ctx, pool._id);
    if (pending && pending.toParticipantId === args.participantId) {
      await ctx.db.patch(pending._id, {
        status: "cancelled",
        resolvedAtMs: nowMs,
      });
    }

    await writeAudit(ctx, {
      poolId: pool._id,
      actorParticipantId: actor._id,
      action: "member_removed",
      metadata: {
        affectedParticipantId: args.participantId,
        priorRole,
        resultingStatus: "removed",
        reason,
      },
    });

    return {
      participantId: args.participantId,
      status: "removed" as const,
    };
  },
});

/**
 * Owner-only reinstatement at Member authority. Audited.
 */
export const reinstateMember = mutation({
  args: {
    poolId: v.id("pools"),
    participantId: v.id("participants"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireParticipant(ctx);
    const pool = await ctx.db.get(args.poolId);
    if (!pool) {
      throw new MembershipAdminError("Pool not found");
    }
    if (isPoolArchived(pool)) {
      throw new MembershipAdminError(
        "Restore the Archived Pool before changing membership",
      );
    }
    await requirePoolOwnerMembership(ctx, pool, actor._id);

    const reason = assertReason(args.reason, "Reinstatement");
    const target = await ctx.db
      .query("poolMemberships")
      .withIndex("by_poolId_and_participantId", (q) =>
        q.eq("poolId", pool._id).eq("participantId", args.participantId),
      )
      .unique();
    if (!target || target.status !== "removed") {
      throw new MembershipAdminError(
        "Only a removed membership may be reinstated",
      );
    }

    const activeCount = (
      await ctx.db
        .query("poolMemberships")
        .withIndex("by_poolId", (q) => q.eq("poolId", pool._id))
        .take(MAX_POOL_MEMBERS + 1)
    ).filter((m) => m.status === "active").length;
    if (activeCount >= MAX_POOL_MEMBERS) {
      throw new MembershipAdminError("This Pool has reached its participant limit");
    }

    const seasonMemberships = await ctx.db
      .query("poolMemberships")
      .withIndex("by_participantId", (q) =>
        q.eq("participantId", args.participantId),
      )
      .take(MAX_MEMBERSHIPS_PER_SEASON + 20);
    let seasonActiveCount = 0;
    for (const row of seasonMemberships) {
      if (row.status !== "active") continue;
      const existingPool = await ctx.db.get(row.poolId);
      if (existingPool && existingPool.seasonId === pool.seasonId) {
        seasonActiveCount += 1;
      }
    }
    if (seasonActiveCount >= MAX_MEMBERSHIPS_PER_SEASON) {
      throw new MembershipAdminError(
        `At most ${MAX_MEMBERSHIPS_PER_SEASON} Pool memberships per season`,
      );
    }

    const nowMs = Date.now();
    await ctx.db.patch(target._id, {
      status: "active",
      role: "member",
      statusReason: reason,
      statusChangedAtMs: nowMs,
    });

    await writeAudit(ctx, {
      poolId: pool._id,
      actorParticipantId: actor._id,
      action: "member_reinstated",
      metadata: {
        affectedParticipantId: args.participantId,
        priorStatus: "removed",
        resultingRole: "member",
        reason,
      },
    });

    return {
      participantId: args.participantId,
      role: "member" as const,
      status: "active" as const,
    };
  },
});

/**
 * Voluntary leave. Sole Owner cannot leave while owning.
 */
export const leavePool = mutation({
  args: { poolId: v.id("pools") },
  handler: async (ctx, args) => {
    const participant = await requireParticipant(ctx);
    const pool = await ctx.db.get(args.poolId);
    if (!pool) {
      throw new MembershipAdminError("Pool not found");
    }
    if (pool.status === "completed") {
      throw new MembershipAdminError(
        "Completed Pools do not permit voluntary departure",
      );
    }
    if (isPoolArchived(pool)) {
      throw new MembershipAdminError(
        "Restore the Archived Pool before leaving",
      );
    }

    const membership = await requireActiveMembership(
      ctx,
      pool._id,
      participant._id,
    );
    if (
      membership.role === "owner" ||
      pool.ownerParticipantId === participant._id
    ) {
      throw new MembershipAdminError(
        "The Pool Owner cannot leave while owning — transfer ownership first",
      );
    }

    // Close voluntary leave once Start Week is successfully scored.
    const startWeek = await ctx.db
      .query("poolWeeks")
      .withIndex("by_poolId_and_week", (q) =>
        q.eq("poolId", pool._id).eq("week", pool.startWeek),
      )
      .unique();
    if (startWeek?.settled === true) {
      throw new MembershipAdminError(
        "Voluntary departure is closed after the Start Week is scored",
      );
    }

    const nowMs = Date.now();
    const priorRole = membership.role;
    await ctx.db.patch(membership._id, {
      status: "left",
      role: "member",
      statusChangedAtMs: nowMs,
    });

    const pending = await loadPendingOwnershipOffer(ctx, pool._id);
    if (pending && pending.toParticipantId === participant._id) {
      await ctx.db.patch(pending._id, {
        status: "cancelled",
        resolvedAtMs: nowMs,
      });
    }

    await writeAudit(ctx, {
      poolId: pool._id,
      actorParticipantId: participant._id,
      action: "member_left",
      metadata: {
        affectedParticipantId: participant._id,
        priorRole,
        resultingStatus: "left",
      },
    });

    return { poolId: pool._id, status: "left" as const };
  },
});

/**
 * Archive — reversible read-only overlay. Owner + step-up.
 * Does not pause locks/sync/scoring or change lifecycle status.
 */
export const archivePool = mutation({
  args: { poolId: v.id("pools") },
  handler: async (ctx, args) => {
    const participant = await requireParticipant(ctx);
    const pool = await ctx.db.get(args.poolId);
    if (!pool) {
      throw new MembershipAdminError("Pool not found");
    }
    await requirePoolOwnerMembership(ctx, pool, participant._id);
    const nowMs = Date.now();
    requireFreshStepUp(participant, nowMs);

    if (isPoolArchived(pool)) {
      return { poolId: pool._id, archived: true as const };
    }

    await ctx.db.patch(pool._id, {
      archived: true,
      archivedAtMs: nowMs,
    });

    await writeAudit(ctx, {
      poolId: pool._id,
      actorParticipantId: participant._id,
      action: "pool_archived",
      metadata: {
        priorArchived: false,
        resultingArchived: true,
        lifecycleStatus: pool.status,
      },
    });

    return { poolId: pool._id, archived: true as const };
  },
});

export const restorePool = mutation({
  args: { poolId: v.id("pools") },
  handler: async (ctx, args) => {
    const participant = await requireParticipant(ctx);
    const pool = await ctx.db.get(args.poolId);
    if (!pool) {
      throw new MembershipAdminError("Pool not found");
    }
    await requirePoolOwnerMembership(ctx, pool, participant._id);
    const nowMs = Date.now();
    requireFreshStepUp(participant, nowMs);

    if (!isPoolArchived(pool)) {
      return { poolId: pool._id, archived: false as const };
    }

    await ctx.db.patch(pool._id, {
      archived: false,
      archivedAtMs: undefined,
    });

    await writeAudit(ctx, {
      poolId: pool._id,
      actorParticipantId: participant._id,
      action: "pool_restored",
      metadata: {
        priorArchived: true,
        resultingArchived: false,
        lifecycleStatus: pool.status,
      },
    });

    return { poolId: pool._id, archived: false as const };
  },
});

/**
 * Sanitized Pool Audit Events for current active participants.
 * Never includes raw invite credentials or contact fields.
 */
export const listPoolAuditEvents = query({
  args: {
    poolId: v.id("pools"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const participant = await requireParticipant(ctx);
    const pool = await ctx.db.get(args.poolId);
    if (!pool) {
      throw new MembershipAdminError("Pool not found");
    }
    await requireActiveMembership(ctx, pool._id, participant._id);

    const limit = Math.min(Math.max(args.limit ?? 50, 1), 100);
    const rows = await ctx.db
      .query("poolAuditEvents")
      .withIndex("by_poolId_and_atMs", (q) => q.eq("poolId", pool._id))
      .order("desc")
      .take(limit * 3);

    const events = [];
    for (const row of rows) {
      if (!PARTICIPANT_VISIBLE_AUDIT_ACTIONS.has(row.action)) continue;
      let metadata: Record<string, unknown> | null = null;
      if (row.metadataJson) {
        try {
          metadata = JSON.parse(row.metadataJson) as Record<string, unknown>;
        } catch {
          metadata = null;
        }
      }
      // Strip any accidental secret-looking keys.
      if (metadata) {
        const {
          credentialSecret: _s,
          token: _t,
          inviteUrl: _u,
          url: _url,
          ...safe
        } = metadata as Record<string, unknown>;
        void _s;
        void _t;
        void _u;
        void _url;
        metadata = safe;
      }
      events.push({
        action: row.action,
        actorParticipantId: row.actorParticipantId,
        atMs: row.atMs,
        metadata,
      });
      if (events.length >= limit) break;
    }

    return { poolId: pool._id, events };
  },
});

/**
 * Private Abuse Report intake. No automatic penalty. Never stores Hidden
 * Picks or raw invite credentials.
 */
export const createAbuseReport = mutation({
  args: {
    reason: v.string(),
    description: v.optional(v.string()),
    poolId: v.optional(v.id("pools")),
  },
  handler: async (ctx, args) => {
    const participant = await requireParticipant(ctx);
    const reason = args.reason.trim();
    if (reason.length < 3 || reason.length > 280) {
      throw new MembershipAdminError(
        "Abuse Report reason must be 3–280 characters",
      );
    }
    const description = args.description?.trim();
    if (description !== undefined && description.length > 2000) {
      throw new MembershipAdminError(
        "Abuse Report description must be at most 2000 characters",
      );
    }

    assertAbuseReportPayloadSafe({ reason, description });

    if (args.poolId) {
      const pool = await ctx.db.get(args.poolId);
      if (!pool) {
        throw new MembershipAdminError("Pool not found");
      }
    }

    const reportId = await ctx.db.insert("abuseReports", {
      reporterParticipantId: participant._id,
      poolId: args.poolId,
      reason,
      description,
      createdAtMs: Date.now(),
    });

    return {
      reportId,
      accepted: true as const,
      automaticPenalty: false as const,
    };
  },
});

/**
 * Pending ownership offer for the current participant (as Owner or recipient).
 */
export const getOwnershipTransferStatus = query({
  args: { poolId: v.id("pools") },
  handler: async (ctx, args) => {
    const participant = await requireParticipant(ctx);
    const pool = await ctx.db.get(args.poolId);
    if (!pool) {
      throw new MembershipAdminError("Pool not found");
    }
    await requireActiveMembership(ctx, pool._id, participant._id);

    const offer = await loadPendingOwnershipOffer(ctx, pool._id);
    if (!offer) {
      return { pending: null };
    }

    const isParty =
      offer.fromParticipantId === participant._id ||
      offer.toParticipantId === participant._id;
    if (!isParty && pool.ownerParticipantId !== participant._id) {
      return { pending: null };
    }

    return {
      pending: {
        offerId: offer._id,
        fromParticipantId: offer.fromParticipantId,
        toParticipantId: offer.toParticipantId,
        createdAtMs: offer.createdAtMs,
        canAccept: offer.toParticipantId === participant._id,
        canCancel: offer.fromParticipantId === participant._id,
      },
    };
  },
});
