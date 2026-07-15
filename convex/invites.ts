import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { AuthError, requireParticipant } from "./lib/auth";
import {
  generateInviteToken,
  hashInviteCredential,
  inviteUrlFromToken,
  parseInviteToken,
} from "./lib/inviteCrypto";
import {
  evaluateThrottle,
  INVITE_UNAVAILABLE,
} from "./lib/inviteThrottle";
import {
  earliestStartWeekKickoffMs,
  resolveAdmissionClosedAtMs,
} from "./lib/membershipCutoff";
import { isPoolArchived } from "./lib/poolArchive";
import {
  MAX_MEMBERSHIPS_PER_SEASON,
  MAX_POOL_MEMBERS,
} from "./lib/quotas";

const STEP_UP_TTL_MS = 5 * 60 * 1000;
const INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const CONTACT_VISIBILITY_DISCLOSURE =
  "By joining, you acknowledge that the Pool Owner and Pool Admins can view your verified email address and phone number while this Pool is Active, Completed, or Archived. There is no per-Pool opt-out.";

class InviteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InviteError";
  }
}

type DbCtx = QueryCtx | MutationCtx;

async function requirePoolMembership(
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

async function requireOwnerOrAdmin(
  ctx: DbCtx,
  poolId: Id<"pools">,
  participantId: Id<"participants">,
): Promise<Doc<"poolMemberships">> {
  const membership = await requirePoolMembership(ctx, poolId, participantId);
  if (membership.role !== "owner" && membership.role !== "admin") {
    throw new AuthError("Only the Pool Owner or Pool Admin may manage invites");
  }
  return membership;
}

function requireFreshStepUp(participant: Doc<"participants">, nowMs: number) {
  const at = participant.stepUpVerifiedAtMs;
  if (at === undefined || nowMs - at > STEP_UP_TTL_MS) {
    throw new InviteError(
      "Step-up Verification required to retrieve or rotate the Pool Invite",
    );
  }
}

async function loadActiveInvite(
  ctx: DbCtx,
  poolId: Id<"pools">,
): Promise<Doc<"poolInvites"> | null> {
  const rows = await ctx.db
    .query("poolInvites")
    .withIndex("by_poolId_and_status", (q) =>
      q.eq("poolId", poolId).eq("status", "active"),
    )
    .take(2);
  return rows[0] ?? null;
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

async function loadStartWeekGames(
  ctx: DbCtx,
  seasonId: Id<"poolSeasons">,
  startWeek: number,
) {
  return await ctx.db
    .query("nflGames")
    .withIndex("by_seasonId_and_week", (q) =>
      q.eq("seasonId", seasonId).eq("week", startWeek),
    )
    .take(64);
}

/**
 * Latch admissionClosedAtMs on the pool when Start Week earliest kickoff
 * has been reached. Returns true when admission is closed.
 * Writes the latch in-transaction — callers that refuse must return
 * successfully (not throw) so the latch commits.
 */
async function ensureAdmissionLatch(
  ctx: MutationCtx,
  pool: Doc<"pools">,
  nowMs: number,
): Promise<boolean> {
  if (pool.admissionClosedAtMs !== undefined) {
    return true;
  }
  const games = await loadStartWeekGames(ctx, pool.seasonId, pool.startWeek);
  const earliest = earliestStartWeekKickoffMs(games);
  const closedAt = resolveAdmissionClosedAtMs({
    nowMs,
    admissionClosedAtMs: undefined,
    earliestKickoffMs: earliest,
  });
  if (closedAt === null) {
    return false;
  }
  await ctx.db.patch(pool._id, { admissionClosedAtMs: closedAt });
  return true;
}

/** Read-only admission check for paths that throw (create/rotate). */
async function assertAdmissionOpen(
  ctx: MutationCtx,
  pool: Doc<"pools">,
  nowMs: number,
): Promise<void> {
  if (pool.admissionClosedAtMs !== undefined) {
    throw new InviteError("Membership admission is closed for this Pool");
  }
  const games = await loadStartWeekGames(ctx, pool.seasonId, pool.startWeek);
  const earliest = earliestStartWeekKickoffMs(games);
  if (
    resolveAdmissionClosedAtMs({
      nowMs,
      admissionClosedAtMs: undefined,
      earliestKickoffMs: earliest,
    }) !== null
  ) {
    throw new InviteError("Membership admission is closed for this Pool");
  }
}

async function recordFailedInviteAttempt(
  ctx: MutationCtx,
  tokenIdentifier: string,
  nowMs: number,
): Promise<never> {
  const existing = await ctx.db
    .query("inviteThrottle")
    .withIndex("by_key", (q) => q.eq("key", tokenIdentifier))
    .unique();

  const evaluation = evaluateThrottle(
    existing
      ? {
          attemptCount: existing.attemptCount,
          windowStartMs: existing.windowStartMs,
          blockedUntilMs: existing.blockedUntilMs,
        }
      : null,
    nowMs,
  );

  if (evaluation.blocked) {
    throw new InviteError(INVITE_UNAVAILABLE);
  }

  if (existing) {
    await ctx.db.patch(existing._id, {
      attemptCount: evaluation.next.attemptCount,
      windowStartMs: evaluation.next.windowStartMs,
      blockedUntilMs: evaluation.next.blockedUntilMs,
    });
  } else {
    await ctx.db.insert("inviteThrottle", {
      key: tokenIdentifier,
      attemptCount: evaluation.next.attemptCount,
      windowStartMs: evaluation.next.windowStartMs,
      blockedUntilMs: evaluation.next.blockedUntilMs,
    });
  }

  throw new InviteError(INVITE_UNAVAILABLE);
}

async function assertNotThrottled(
  ctx: MutationCtx,
  tokenIdentifier: string,
  nowMs: number,
) {
  const existing = await ctx.db
    .query("inviteThrottle")
    .withIndex("by_key", (q) => q.eq("key", tokenIdentifier))
    .unique();
  if (
    existing?.blockedUntilMs !== undefined &&
    existing.blockedUntilMs > nowMs
  ) {
    throw new InviteError(INVITE_UNAVAILABLE);
  }
}

/**
 * MVP Step-up Verification: records a short-lived marker on the Participant.
 * Production should use Clerk second factor; tests call this before retrieve/rotate.
 */
export const confirmStepUp = mutation({
  args: {},
  handler: async (ctx) => {
    const participant = await requireParticipant(ctx);
    const nowMs = Date.now();
    await ctx.db.patch(participant._id, { stepUpVerifiedAtMs: nowMs });
    return { stepUpVerifiedAtMs: nowMs, expiresAtMs: nowMs + STEP_UP_TTL_MS };
  },
});

/**
 * Create the Pool's ordinary invite if missing, or retrieve the existing
 * credential after step-up. Raw token is returned only here — never logged.
 */
export const createOrRetrieveInvite = mutation({
  args: { poolId: v.id("pools") },
  handler: async (ctx, args) => {
    const participant = await requireParticipant(ctx);
    const pool = await ctx.db.get(args.poolId);
    if (!pool || pool.status !== "active") {
      throw new InviteError("Pool not found");
    }
    if (isPoolArchived(pool)) {
      throw new InviteError(
        "Archived Pools accept no invitation changes — restore first",
      );
    }
    await requireOwnerOrAdmin(ctx, pool._id, participant._id);
    const nowMs = Date.now();
    requireFreshStepUp(participant, nowMs);

    await assertAdmissionOpen(ctx, pool, nowMs);

    const existing = await loadActiveInvite(ctx, pool._id);
    if (existing) {
      if (existing.expiresAtMs <= nowMs) {
        await ctx.db.patch(existing._id, { status: "expired" });
      } else {
        await writeAudit(ctx, {
          poolId: pool._id,
          actorParticipantId: participant._id,
          action: "invite_retrieved",
          metadata: { inviteId: existing._id },
        });
        return {
          url: inviteUrlFromToken(existing.credentialSecret),
          expiresAtMs: existing.expiresAtMs,
        };
      }
    }

    const rawToken = generateInviteToken();
    const credentialHash = await hashInviteCredential(rawToken);
    const expiresAtMs = nowMs + INVITE_TTL_MS;
    const inviteId = await ctx.db.insert("poolInvites", {
      poolId: pool._id,
      credentialHash,
      credentialSecret: rawToken,
      status: "active",
      expiresAtMs,
      createdByParticipantId: participant._id,
      createdAtMs: nowMs,
    });

    await writeAudit(ctx, {
      poolId: pool._id,
      actorParticipantId: participant._id,
      action: "invite_created",
      metadata: { inviteId },
    });

    return {
      url: inviteUrlFromToken(rawToken),
      expiresAtMs,
    };
  },
});

/**
 * Rotate the ordinary Pool Invite. Invalidates the prior credential immediately.
 */
export const rotateInvite = mutation({
  args: { poolId: v.id("pools") },
  handler: async (ctx, args) => {
    const participant = await requireParticipant(ctx);
    const pool = await ctx.db.get(args.poolId);
    if (!pool || pool.status !== "active") {
      throw new InviteError("Pool not found");
    }
    if (isPoolArchived(pool)) {
      throw new InviteError(
        "Archived Pools accept no invitation changes — restore first",
      );
    }
    await requireOwnerOrAdmin(ctx, pool._id, participant._id);
    const nowMs = Date.now();
    requireFreshStepUp(participant, nowMs);

    await assertAdmissionOpen(ctx, pool, nowMs);

    const existing = await loadActiveInvite(ctx, pool._id);
    if (existing) {
      await ctx.db.patch(existing._id, {
        status: "rotated",
        rotatedAtMs: nowMs,
      });
    }

    const rawToken = generateInviteToken();
    const credentialHash = await hashInviteCredential(rawToken);
    const expiresAtMs = nowMs + INVITE_TTL_MS;
    const inviteId = await ctx.db.insert("poolInvites", {
      poolId: pool._id,
      credentialHash,
      credentialSecret: rawToken,
      status: "active",
      expiresAtMs,
      createdByParticipantId: participant._id,
      createdAtMs: nowMs,
    });

    await writeAudit(ctx, {
      poolId: pool._id,
      actorParticipantId: participant._id,
      action: "invite_rotated",
      metadata: {
        inviteId,
        priorInviteId: existing?._id ?? null,
      },
    });

    return {
      url: inviteUrlFromToken(rawToken),
      expiresAtMs,
    };
  },
});

/**
 * Preview a Pool Invite without creating membership. Opening the URL alone
 * must not enroll — this query is the safe read path.
 * Invalid tokens return null (generic) rather than distinguishing reasons.
 */
export const previewInvite = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const participant = await requireParticipant(ctx);
    const rawToken = parseInviteToken(args.token);
    const credentialHash = await hashInviteCredential(rawToken);

    const invite = await ctx.db
      .query("poolInvites")
      .withIndex("by_credentialHash", (q) =>
        q.eq("credentialHash", credentialHash),
      )
      .unique();

    if (
      !invite ||
      invite.status !== "active" ||
      invite.expiresAtMs <= Date.now()
    ) {
      return null;
    }

    const pool = await ctx.db.get(invite.poolId);
    if (!pool || pool.status !== "active" || isPoolArchived(pool)) {
      return null;
    }

    const membership = await ctx.db
      .query("poolMemberships")
      .withIndex("by_poolId_and_participantId", (q) =>
        q.eq("poolId", pool._id).eq("participantId", participant._id),
      )
      .unique();

    const nowMs = Date.now();
    let admissionClosed = pool.admissionClosedAtMs !== undefined;
    if (!admissionClosed) {
      const games = await loadStartWeekGames(ctx, pool.seasonId, pool.startWeek);
      const earliest = earliestStartWeekKickoffMs(games);
      admissionClosed =
        resolveAdmissionClosedAtMs({
          nowMs,
          admissionClosedAtMs: undefined,
          earliestKickoffMs: earliest,
        }) !== null;
    }

    return {
      poolId: pool._id,
      poolName: pool.name,
      poolType: pool.type,
      startWeek: pool.startWeek,
      disclosureText: CONTACT_VISIBILITY_DISCLOSURE,
      alreadyMember: membership?.status === "active",
      admissionClosed,
    };
  },
});

/**
 * Explicit accept creates exactly one membership. Requires disclosure ack.
 * Idempotent for an already-active membership.
 */
export const acceptInvite = mutation({
  args: {
    token: v.string(),
    acknowledgedContactVisibility: v.boolean(),
  },
  handler: async (ctx, args) => {
    const participant = await requireParticipant(ctx);
    const nowMs = Date.now();

    await assertNotThrottled(ctx, participant.tokenIdentifier, nowMs);

    if (!args.acknowledgedContactVisibility) {
      throw new InviteError(
        "Contact-visibility disclosure must be acknowledged before accepting",
      );
    }

    const rawToken = parseInviteToken(args.token);
    const credentialHash = await hashInviteCredential(rawToken);

    const invite = await ctx.db
      .query("poolInvites")
      .withIndex("by_credentialHash", (q) =>
        q.eq("credentialHash", credentialHash),
      )
      .unique();

    if (
      !invite ||
      invite.status !== "active" ||
      invite.expiresAtMs <= nowMs
    ) {
      await recordFailedInviteAttempt(ctx, participant.tokenIdentifier, nowMs);
    }

    // TypeScript: invite is defined after the throw-never above.
    const activeInvite = invite!;

    const pool = await ctx.db.get(activeInvite.poolId);
    if (!pool || pool.status !== "active" || isPoolArchived(pool)) {
      await recordFailedInviteAttempt(ctx, participant.tokenIdentifier, nowMs);
    }
    const activePool = pool!;

    if (await ensureAdmissionLatch(ctx, activePool, nowMs)) {
      // Latch must persist — do not throw (Convex rolls back writes on throw).
      return {
        poolId: activePool._id,
        role: "member" as const,
        created: false as const,
        refusedReason: "admission_closed" as const,
      };
    }

    const existingMembership = await ctx.db
      .query("poolMemberships")
      .withIndex("by_poolId_and_participantId", (q) =>
        q
          .eq("poolId", activePool._id)
          .eq("participantId", participant._id),
      )
      .unique();

    if (existingMembership?.status === "active") {
      return {
        poolId: activePool._id,
        role: existingMembership.role,
        created: false as const,
      };
    }

    // Removed members cannot rejoin via ordinary invite — Owner reinstate only.
    if (existingMembership?.status === "removed") {
      throw new InviteError(INVITE_UNAVAILABLE);
    }

    const memberCount = await ctx.db
      .query("poolMemberships")
      .withIndex("by_poolId", (q) => q.eq("poolId", activePool._id))
      .take(MAX_POOL_MEMBERS + 1);
    const activeCount = memberCount.filter((m) => m.status === "active").length;
    if (activeCount >= MAX_POOL_MEMBERS) {
      throw new InviteError("This Pool has reached its participant limit");
    }

    // ≤50 active memberships per season.
    const seasonMemberships = await ctx.db
      .query("poolMemberships")
      .withIndex("by_participantId", (q) =>
        q.eq("participantId", participant._id),
      )
      .take(MAX_MEMBERSHIPS_PER_SEASON + 20);
    let seasonActiveCount = 0;
    for (const row of seasonMemberships) {
      if (row.status !== "active") continue;
      const existingPool = await ctx.db.get(row.poolId);
      if (existingPool && existingPool.seasonId === activePool.seasonId) {
        seasonActiveCount += 1;
      }
    }
    if (seasonActiveCount >= MAX_MEMBERSHIPS_PER_SEASON) {
      throw new InviteError(
        `At most ${MAX_MEMBERSHIPS_PER_SEASON} Pool memberships per season`,
      );
    }

    // Voluntary leave before cutoff may reactivate the same membership.
    if (existingMembership?.status === "left") {
      await ctx.db.patch(existingMembership._id, {
        status: "active",
        role: "member",
        statusChangedAtMs: nowMs,
        statusReason: undefined,
      });

      await writeAudit(ctx, {
        poolId: activePool._id,
        actorParticipantId: participant._id,
        action: "invite_accepted",
        metadata: {
          inviteId: activeInvite._id,
          reactivated: true,
        },
      });

      return {
        poolId: activePool._id,
        role: "member" as const,
        created: false as const,
        reactivated: true as const,
      };
    }

    if (existingMembership) {
      throw new InviteError(INVITE_UNAVAILABLE);
    }

    await ctx.db.insert("poolMemberships", {
      poolId: activePool._id,
      participantId: participant._id,
      role: "member",
      status: "active",
    });

    await writeAudit(ctx, {
      poolId: activePool._id,
      actorParticipantId: participant._id,
      action: "invite_accepted",
      metadata: { inviteId: activeInvite._id },
    });

    return {
      poolId: activePool._id,
      role: "member" as const,
      created: true as const,
    };
  },
});

/**
 * Pool panel membership list with role-appropriate contact visibility.
 * Owner/Admin see email/phone; Members see displayName/avatar only.
 */
export const listPoolMembers = query({
  args: { poolId: v.id("pools") },
  handler: async (ctx, args) => {
    const participant = await requireParticipant(ctx);
    const pool = await ctx.db.get(args.poolId);
    if (!pool) {
      throw new InviteError("Pool not found");
    }

    const callerMembership = await requirePoolMembership(
      ctx,
      pool._id,
      participant._id,
    );
    const canSeeContacts =
      callerMembership.role === "owner" || callerMembership.role === "admin";

    const memberships = await ctx.db
      .query("poolMemberships")
      .withIndex("by_poolId", (q) => q.eq("poolId", pool._id))
      .take(MAX_POOL_MEMBERS);

    const members = [];
    for (const row of memberships) {
      const person = await ctx.db.get(row.participantId);
      if (!person) continue;
      const isActive = row.status === "active";
      members.push({
        participantId: person._id,
        displayName: person.displayName,
        avatarUrl: person.avatarUrl ?? null,
        role: row.role,
        status: row.status,
        ...(canSeeContacts && isActive
          ? {
              email: person.email ?? null,
              phone: person.phone ?? null,
            }
          : {}),
      });
    }

    members.sort((a, b) => {
      const statusRank = { active: 0, removed: 1, left: 2 } as const;
      const sa = statusRank[a.status as keyof typeof statusRank] ?? 3;
      const sb = statusRank[b.status as keyof typeof statusRank] ?? 3;
      if (sa !== sb) return sa - sb;
      const rank = { owner: 0, admin: 1, member: 2 } as const;
      const ra = rank[a.role as keyof typeof rank] ?? 3;
      const rb = rank[b.role as keyof typeof rank] ?? 3;
      if (ra !== rb) return ra - rb;
      return a.displayName.localeCompare(b.displayName);
    });

    return {
      poolId: pool._id,
      poolName: pool.name,
      callerRole: callerMembership.role,
      canManageInvites: canSeeContacts,
      admissionClosed: pool.admissionClosedAtMs !== undefined,
      archived: isPoolArchived(pool),
      members,
    };
  },
});

/**
 * Invite metadata for the Pool panel (no raw credential without step-up retrieve).
 */
export const getInviteStatus = query({
  args: { poolId: v.id("pools") },
  handler: async (ctx, args) => {
    const participant = await requireParticipant(ctx);
    const pool = await ctx.db.get(args.poolId);
    if (!pool) {
      throw new InviteError("Pool not found");
    }
    await requireOwnerOrAdmin(ctx, pool._id, participant._id);

    const invite = await loadActiveInvite(ctx, pool._id);
    const nowMs = Date.now();
    const stepUpFresh =
      participant.stepUpVerifiedAtMs !== undefined &&
      nowMs - participant.stepUpVerifiedAtMs <= STEP_UP_TTL_MS;

    return {
      hasActiveInvite: invite !== null && invite.expiresAtMs > nowMs,
      expiresAtMs: invite?.expiresAtMs ?? null,
      admissionClosed: pool.admissionClosedAtMs !== undefined,
      stepUpFresh,
    };
  },
});
