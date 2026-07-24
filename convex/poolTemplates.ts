import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { AuthError, requireParticipant } from "./lib/auth";
import { markOwnerPoolCreated } from "./helpPrompt";
import {
  generateInviteToken,
  hashInviteCredential,
  parseInviteToken,
  returningInviteUrlFromToken,
} from "./lib/inviteCrypto";
import {
  earliestStartWeekKickoffMs,
  resolveAdmissionClosedAtMs,
} from "./lib/membershipCutoff";
import { mintOrdinaryPoolInvite } from "./lib/mintOrdinaryInvite";
import { assertValidStartWeekSlate } from "./lib/poolRules";
import { isPoolArchived } from "./lib/poolArchive";
import {
  MAX_MEMBERSHIPS_PER_SEASON,
  MAX_OWNED_POOLS,
  MAX_POOL_ENTRIES,
} from "./lib/quotas";
import {
  assertValidMaxEntriesPerUser,
  countActivePoolEntries,
  createPrimaryEntry,
  poolMaxEntriesPerUser,
  PoolEntryError,
} from "./lib/poolEntries";
import { CONTACT_VISIBILITY_DISCLOSURE } from "./lib/inviteDisclosure";

const INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const proposedRoleValidator = v.union(
  v.literal("member"),
  v.literal("admin"),
);

class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateError";
  }
}

type DbCtx = QueryCtx | MutationCtx;

async function requireAvailableSeason(
  ctx: DbCtx,
): Promise<Doc<"poolSeasons">> {
  const seasons = await ctx.db
    .query("poolSeasons")
    .withIndex("by_status", (q) => q.eq("status", "available"))
    .take(1);
  const season = seasons[0];
  if (!season) {
    throw new TemplateError("No Available Season — Create Pool is disabled");
  }
  return season;
}

async function loadWeekGames(
  ctx: DbCtx,
  seasonId: Id<"poolSeasons">,
  week: number,
) {
  return await ctx.db
    .query("nflGames")
    .withIndex("by_seasonId_and_week", (q) =>
      q.eq("seasonId", seasonId).eq("week", week),
    )
    .take(64);
}

function isStartWeekValid(
  games: Array<{ scheduledKickoffMs: number }>,
  nowMs: number,
): boolean {
  if (games.length === 0) return false;
  const earliest = Math.min(...games.map((g) => g.scheduledKickoffMs));
  return earliest > nowMs;
}

async function resolveValidStartWeek(
  ctx: DbCtx,
  seasonId: Id<"poolSeasons">,
  preferredWeek: number,
  nowMs: number,
): Promise<number> {
  const preferredGames = await loadWeekGames(ctx, seasonId, preferredWeek);
  if (isStartWeekValid(preferredGames, nowMs)) {
    return preferredWeek;
  }

  const allGames = await ctx.db
    .query("nflGames")
    .withIndex("by_seasonId", (q) => q.eq("seasonId", seasonId))
    .take(512);
  const byWeek = new Map<number, number>();
  for (const g of allGames) {
    const prev = byWeek.get(g.week);
    if (prev === undefined || g.scheduledKickoffMs < prev) {
      byWeek.set(g.week, g.scheduledKickoffMs);
    }
  }
  const candidates = [...byWeek.entries()]
    .filter(([, earliest]) => earliest > nowMs)
    .map(([week]) => week)
    .sort((a, b) => a - b);
  const first = candidates[0];
  if (first === undefined) {
    throw new TemplateError("No valid Start Week is available for this season");
  }
  return first;
}

function isEligibleTemplateSource(
  pool: Doc<"pools">,
  availableSeasonId: Id<"poolSeasons">,
): boolean {
  return (
    pool.seasonId !== availableSeasonId || pool.status === "completed"
  );
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

async function assertOwnedPoolQuotas(
  ctx: MutationCtx,
  participantId: Id<"participants">,
  seasonId: Id<"poolSeasons">,
) {
  const owned = await ctx.db
    .query("pools")
    .withIndex("by_ownerParticipantId", (q) =>
      q.eq("ownerParticipantId", participantId),
    )
    .take(MAX_OWNED_POOLS + 1);
  if (owned.length >= MAX_OWNED_POOLS) {
    throw new TemplateError(
      `Pool Owner may create at most ${MAX_OWNED_POOLS} Pools`,
    );
  }

  const seasonMemberships = await ctx.db
    .query("poolMemberships")
    .withIndex("by_participantId", (q) => q.eq("participantId", participantId))
    .take(MAX_MEMBERSHIPS_PER_SEASON + 20);
  let seasonActiveCount = 0;
  for (const row of seasonMemberships) {
    if (row.status !== "active") continue;
    const existingPool = await ctx.db.get(row.poolId);
    if (existingPool && existingPool.seasonId === seasonId) {
      seasonActiveCount += 1;
    }
  }
  if (seasonActiveCount >= MAX_MEMBERSHIPS_PER_SEASON) {
    throw new TemplateError(
      `At most ${MAX_MEMBERSHIPS_PER_SEASON} Pool memberships per season`,
    );
  }
}

/**
 * Pools the caller owns that may be used as a Pool Template (prior season
 * or Completed). Never includes competitive history — setup + former people only.
 */
export const listMyTemplates = query({
  args: {},
  handler: async (ctx) => {
    const participant = await requireParticipant(ctx);
    const available = await ctx.db
      .query("poolSeasons")
      .withIndex("by_status", (q) => q.eq("status", "available"))
      .take(1);
    const availableSeason = available[0];
    if (!availableSeason) {
      return [];
    }

    const owned = await ctx.db
      .query("pools")
      .withIndex("by_ownerParticipantId", (q) =>
        q.eq("ownerParticipantId", participant._id),
      )
      .take(MAX_OWNED_POOLS);

    const templates = [];
    for (const pool of owned) {
      if (!isEligibleTemplateSource(pool, availableSeason._id)) {
        continue;
      }
      const season = await ctx.db.get(pool.seasonId);
      const memberships = await ctx.db
        .query("poolMemberships")
        .withIndex("by_poolId", (q) => q.eq("poolId", pool._id))
        .take(MAX_POOL_ENTRIES);

      const formerParticipants = [];
      for (const row of memberships) {
        if (row.participantId === participant._id) continue;
        const person = await ctx.db.get(row.participantId);
        if (!person) continue;
        formerParticipants.push({
          participantId: person._id,
          displayName: person.displayName,
          formerRole: row.role === "owner" ? ("member" as const) : row.role,
        });
      }

      templates.push({
        poolId: pool._id,
        name: pool.name,
        type: pool.type,
        pickLockMode: pool.pickLockMode,
        startWeek: pool.startWeek,
        maxEntriesPerUser: poolMaxEntriesPerUser(pool),
        seasonLabel: season?.label ?? null,
        status: pool.status,
        formerParticipants,
      });
    }

    return templates;
  },
});

/**
 * Create an Active Pool from a prior-season Pool Template.
 * Prefills name / type / Pick Lock mode / valid Start Week preference.
 * Never copies memberships, picks, standings, audit, or other history.
 * Optional Returning Participant Invites are pending until explicit accept.
 */
export const createPoolFromTemplate = mutation({
  args: {
    sourcePoolId: v.id("pools"),
    name: v.optional(v.string()),
    startWeek: v.optional(v.number()),
    pickLockMode: v.optional(
      v.union(v.literal("gameKickoff"), v.literal("weeklyCutoff")),
    ),
    maxEntriesPerUser: v.optional(v.number()),
    returningInvites: v.optional(
      v.array(
        v.object({
          participantId: v.id("participants"),
          proposedRole: proposedRoleValidator,
        }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const participant = await requireParticipant(ctx);
    const availableSeason = await requireAvailableSeason(ctx);
    const source = await ctx.db.get(args.sourcePoolId);
    if (!source) {
      throw new TemplateError("Pool Template source not found");
    }
    if (source.ownerParticipantId !== participant._id) {
      throw new AuthError(
        "Only the Pool Owner may create a Pool from this template",
      );
    }
    if (!isEligibleTemplateSource(source, availableSeason._id)) {
      throw new TemplateError(
        "Pool is not eligible as a Pool Template (prior season or Completed required)",
      );
    }

    await assertOwnedPoolQuotas(ctx, participant._id, availableSeason._id);

    const nowMs = Date.now();
    const name =
      args.name !== undefined ? args.name.trim() : source.name.trim();
    if (name.length === 0) {
      throw new TemplateError("Pool name is required");
    }

    const pickLockMode = args.pickLockMode ?? source.pickLockMode;
    const maxEntriesPerUser =
      args.maxEntriesPerUser ?? poolMaxEntriesPerUser(source);
    try {
      assertValidMaxEntriesPerUser(maxEntriesPerUser);
    } catch (err) {
      if (err instanceof PoolEntryError) throw new TemplateError(err.message);
      throw err;
    }
    const startWeek =
      args.startWeek !== undefined
        ? args.startWeek
        : await resolveValidStartWeek(
            ctx,
            availableSeason._id,
            source.startWeek,
            nowMs,
          );

    if (startWeek < 1 || startWeek > 18) {
      throw new TemplateError("Start Week must be a regular-season week 1–18");
    }
    const games = await loadWeekGames(ctx, availableSeason._id, startWeek);
    assertValidStartWeekSlate({ games, nowMs });

    const poolId = await ctx.db.insert("pools", {
      name,
      type: source.type,
      seasonId: availableSeason._id,
      startWeek,
      pickLockMode,
      status: "active",
      rulesFrozen: false,
      archived: false,
      ownerParticipantId: participant._id,
      createdAtMs: nowMs,
      maxEntriesPerUser,
    });

    const membershipId = await ctx.db.insert("poolMemberships", {
      poolId,
      participantId: participant._id,
      role: "owner",
      status: "active",
    });
    await createPrimaryEntry(ctx, {
      poolId,
      participantId: participant._id,
      membershipId,
      nowMs,
    });

    const returningInvites: Array<{
      inviteId: Id<"returningParticipantInvites">;
      participantId: Id<"participants">;
      proposedRole: "member" | "admin";
      url: string;
      status: "pending";
      expiresAtMs: number;
    }> = [];

    const inviteArgs = args.returningInvites ?? [];
    if (inviteArgs.length > 0) {
      const sourceMemberships = await ctx.db
        .query("poolMemberships")
        .withIndex("by_poolId", (q) => q.eq("poolId", source._id))
        .take(MAX_POOL_ENTRIES);
      const formerIds = new Set(
        sourceMemberships.map((m) => m.participantId as string),
      );

      for (const invite of inviteArgs) {
        if (invite.participantId === participant._id) {
          throw new TemplateError(
            "Cannot create a Returning Participant Invite for the Pool Owner",
          );
        }
        if (!formerIds.has(invite.participantId)) {
          throw new TemplateError(
            "Returning Participant Invite target must be a former participant of the template Pool",
          );
        }
        if (invite.proposedRole === "admin") {
          // Creator is the Pool Owner of the new Pool. Only the Owner may
          // propose Admin via Returning Participant Invites (deny-by-default
          // if this path is ever reused by non-owners).
          const ownerMembership = await ctx.db
            .query("poolMemberships")
            .withIndex("by_poolId_and_participantId", (q) =>
              q.eq("poolId", poolId).eq("participantId", participant._id),
            )
            .unique();
          if (ownerMembership?.role !== "owner") {
            throw new AuthError(
              "Only the Pool Owner may propose Pool Admin via a Returning Participant Invite",
            );
          }
        }

        const rawToken = generateInviteToken();
        const credentialHash = await hashInviteCredential(rawToken);
        const expiresAtMs = nowMs + INVITE_TTL_MS;
        const inviteId = await ctx.db.insert("returningParticipantInvites", {
          poolId,
          sourcePoolId: source._id,
          targetParticipantId: invite.participantId,
          proposedRole: invite.proposedRole,
          credentialHash,
          credentialSecret: rawToken,
          status: "pending",
          expiresAtMs,
          createdByParticipantId: participant._id,
          createdAtMs: nowMs,
        });

        await writeAudit(ctx, {
          poolId,
          actorParticipantId: participant._id,
          action: "returning_invite_created",
          metadata: {
            inviteId,
            targetParticipantId: invite.participantId,
            proposedRole: invite.proposedRole,
          },
        });

        returningInvites.push({
          inviteId,
          participantId: invite.participantId,
          proposedRole: invite.proposedRole,
          url: returningInviteUrlFromToken(rawToken),
          status: "pending",
          expiresAtMs,
        });
      }
    }

    const invite = await mintOrdinaryPoolInvite(ctx, {
      poolId,
      createdByParticipantId: participant._id,
      nowMs,
    });

    await markOwnerPoolCreated(ctx, participant._id, nowMs);

    return {
      poolId,
      status: "active" as const,
      startWeek,
      seasonId: availableSeason._id,
      type: source.type,
      pickLockMode,
      name,
      inviteUrl: invite.url,
      expiresAtMs: invite.expiresAtMs,
      returningInvites,
    };
  },
});

/**
 * Preview a Returning Participant Invite without enrolling.
 * Invalid / wrong-person tokens return null (generic deny-by-default).
 */
export const previewReturningInvite = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const participant = await requireParticipant(ctx);
    const rawToken = parseInviteToken(args.token);
    const credentialHash = await hashInviteCredential(rawToken);

    const invite = await ctx.db
      .query("returningParticipantInvites")
      .withIndex("by_credentialHash", (q) =>
        q.eq("credentialHash", credentialHash),
      )
      .unique();

    if (
      !invite ||
      invite.status !== "pending" ||
      invite.expiresAtMs <= Date.now()
    ) {
      return null;
    }

    // Person-specific: wrong recipient sees nothing useful.
    if (invite.targetParticipantId !== participant._id) {
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
      const games = await loadWeekGames(ctx, pool.seasonId, pool.startWeek);
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
      proposedRole: invite.proposedRole,
      disclosureText: CONTACT_VISIBILITY_DISCLOSURE,
      alreadyMember: membership?.status === "active",
      admissionClosed,
    };
  },
});

/**
 * Explicit accept enrolls as Member or Admin per proposal.
 * Single-use: pending → accepted. Idempotent if already active with that role.
 */
export const acceptReturningInvite = mutation({
  args: {
    token: v.string(),
    acknowledgedContactVisibility: v.boolean(),
  },
  handler: async (ctx, args) => {
    const participant = await requireParticipant(ctx);
    const nowMs = Date.now();

    if (!args.acknowledgedContactVisibility) {
      throw new TemplateError(
        "Contact-visibility disclosure must be acknowledged before accepting",
      );
    }

    const rawToken = parseInviteToken(args.token);
    const credentialHash = await hashInviteCredential(rawToken);

    const invite = await ctx.db
      .query("returningParticipantInvites")
      .withIndex("by_credentialHash", (q) =>
        q.eq("credentialHash", credentialHash),
      )
      .unique();

    if (!invite || invite.expiresAtMs <= nowMs) {
      throw new TemplateError("Returning Participant Invite unavailable");
    }

    if (invite.targetParticipantId !== participant._id) {
      throw new TemplateError(
        "Returning Participant Invite is not intended for this Participant",
      );
    }

    const pool = await ctx.db.get(invite.poolId);
    if (!pool || pool.status !== "active" || isPoolArchived(pool)) {
      throw new TemplateError("Returning Participant Invite unavailable");
    }

    // Latch admission closed without throwing (so write commits).
    if (pool.admissionClosedAtMs === undefined) {
      const games = await loadWeekGames(ctx, pool.seasonId, pool.startWeek);
      const earliest = earliestStartWeekKickoffMs(games);
      const closedAt = resolveAdmissionClosedAtMs({
        nowMs,
        admissionClosedAtMs: undefined,
        earliestKickoffMs: earliest,
      });
      if (closedAt !== null) {
        await ctx.db.patch(pool._id, { admissionClosedAtMs: closedAt });
        return {
          poolId: pool._id,
          role: invite.proposedRole,
          created: false as const,
          refusedReason: "admission_closed" as const,
        };
      }
    } else {
      return {
        poolId: pool._id,
        role: invite.proposedRole,
        created: false as const,
        refusedReason: "admission_closed" as const,
      };
    }

    const existingMembership = await ctx.db
      .query("poolMemberships")
      .withIndex("by_poolId_and_participantId", (q) =>
        q.eq("poolId", pool._id).eq("participantId", participant._id),
      )
      .unique();

    if (existingMembership?.status === "active") {
      if (invite.status === "pending") {
        await ctx.db.patch(invite._id, {
          status: "accepted",
          acceptedAtMs: nowMs,
        });
      }
      return {
        poolId: pool._id,
        role: existingMembership.role,
        created: false as const,
      };
    }

    if (existingMembership?.status === "removed") {
      throw new TemplateError("Returning Participant Invite unavailable");
    }

    if (invite.status !== "pending" && invite.status !== "accepted") {
      throw new TemplateError("Returning Participant Invite unavailable");
    }

    // Single-use: already accepted without membership is unavailable.
    if (invite.status === "accepted" && !existingMembership) {
      throw new TemplateError("Returning Participant Invite unavailable");
    }

    const activeEntryCount = await countActivePoolEntries(ctx, pool._id);
    if (activeEntryCount >= MAX_POOL_ENTRIES) {
      throw new TemplateError(
        `This Pool has reached its entry limit (${MAX_POOL_ENTRIES})`,
      );
    }

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
      if (existingPool && existingPool.seasonId === pool.seasonId) {
        seasonActiveCount += 1;
      }
    }
    if (seasonActiveCount >= MAX_MEMBERSHIPS_PER_SEASON) {
      throw new TemplateError(
        `At most ${MAX_MEMBERSHIPS_PER_SEASON} Pool memberships per season`,
      );
    }

    const role = invite.proposedRole;

    let membershipId: Id<"poolMemberships">;
    if (existingMembership?.status === "left") {
      await ctx.db.patch(existingMembership._id, {
        status: "active",
        role,
        statusChangedAtMs: nowMs,
        statusReason: undefined,
      });
      membershipId = existingMembership._id;
    } else if (!existingMembership) {
      membershipId = await ctx.db.insert("poolMemberships", {
        poolId: pool._id,
        participantId: participant._id,
        role,
        status: "active",
      });
    } else {
      throw new TemplateError("Returning Participant Invite unavailable");
    }

    await createPrimaryEntry(ctx, {
      poolId: pool._id,
      participantId: participant._id,
      membershipId,
      nowMs,
    });

    await ctx.db.patch(invite._id, {
      status: "accepted",
      acceptedAtMs: nowMs,
    });

    await writeAudit(ctx, {
      poolId: pool._id,
      actorParticipantId: participant._id,
      action: "returning_invite_accepted",
      metadata: {
        inviteId: invite._id,
        proposedRole: role,
      },
    });

    return {
      poolId: pool._id,
      role,
      created: true as const,
    };
  },
});
