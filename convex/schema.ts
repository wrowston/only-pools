import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const nflGameLifecycle = v.union(
  v.literal("scheduled"),
  v.literal("in_progress"),
  v.literal("interrupted"),
  v.literal("postponed"),
  v.literal("canceled"),
  v.literal("terminal"),
  v.literal("unknown"),
);

const poolType = v.union(v.literal("survivor"), v.literal("confidence"));
const pickLockMode = v.union(
  v.literal("gameKickoff"),
  v.literal("weeklyCutoff"),
);
const membershipRole = v.union(
  v.literal("owner"),
  v.literal("admin"),
  v.literal("member"),
);

/**
 * MVP schema through ticket 03 — Participant identity, Season Bootstrap,
 * NFL Teams / Games, Sync Gate, Active Pools, and Pool Memberships.
 */
export default defineSchema({
  participants: defineTable({
    /** Canonical Clerk-linked identity key: issuer|subject via tokenIdentifier. */
    tokenIdentifier: v.string(),
    /** Clerk `sub` for dashboard / ops convenience. Never trust client-supplied ids. */
    clerkUserId: v.string(),
    displayName: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    emailVerified: v.boolean(),
    phoneVerified: v.boolean(),
    ageConfirmed: v.boolean(),
    /** Stub for Suspended Participant; enforced in auth helpers. */
    suspended: v.boolean(),
    avatarUrl: v.optional(v.string()),
    /**
     * Clerk session id (`sid`) from the last fully verified establish.
     * Same session → mid-session contact lapse does not interrupt access.
     * New session → email + phone must both be verified again.
     */
    lastClerkSessionId: v.optional(v.string()),
  })
    .index("by_tokenIdentifier", ["tokenIdentifier"])
    .index("by_clerkUserId", ["clerkUserId"]),

  /**
   * Pool Season rows. Create Pool stays disabled until status is "available"
   * (Season Bootstrap succeeded with a usable Start Week slate).
   */
  poolSeasons: defineTable({
    label: v.string(),
    year: v.number(),
    status: v.union(v.literal("bootstrapping"), v.literal("available")),
    usableStartWeek: v.optional(v.number()),
    bootstrappedAtMs: v.optional(v.number()),
  })
    .index("by_status", ["status"])
    .index("by_label", ["label"]),

  /** Provider-independent NFL Team identity. SportsDB ids are aliases only. */
  nflTeams: defineTable({
    stableKey: v.string(),
    name: v.string(),
    abbreviation: v.string(),
    sportsDbTeamId: v.string(),
  })
    .index("by_stableKey", ["stableKey"])
    .index("by_sportsDbTeamId", ["sportsDbTeamId"]),

  /** Provider-independent NFL Game identity for a Pool Season. */
  nflGames: defineTable({
    stableKey: v.string(),
    seasonId: v.id("poolSeasons"),
    seasonLabel: v.string(),
    week: v.number(),
    homeTeamId: v.id("nflTeams"),
    awayTeamId: v.id("nflTeams"),
    scheduledKickoffMs: v.number(),
    lifecycle: nflGameLifecycle,
    homeScore: v.union(v.number(), v.null()),
    awayScore: v.union(v.number(), v.null()),
    sportsDbEventId: v.string(),
  })
    .index("by_stableKey", ["stableKey"])
    .index("by_seasonId_and_week", ["seasonId", "week"])
    .index("by_sportsDbEventId", ["sportsDbEventId"])
    .index("by_seasonId", ["seasonId"]),

  /**
   * Active Pool competitive container. Pool Type and Pool Season are immutable
   * after create; Start Week / Pick Lock mode freeze via rulesFrozen.
   */
  pools: defineTable({
    name: v.string(),
    type: poolType,
    seasonId: v.id("poolSeasons"),
    startWeek: v.number(),
    pickLockMode: pickLockMode,
    status: v.literal("active"),
    /** True after first accepted competitive edit or first Pick Lock. */
    rulesFrozen: v.boolean(),
    ownerParticipantId: v.id("participants"),
    createdAtMs: v.number(),
  })
    .index("by_ownerParticipantId", ["ownerParticipantId"])
    .index("by_seasonId", ["seasonId"]),

  /** One membership document per (pool, participant). */
  poolMemberships: defineTable({
    poolId: v.id("pools"),
    participantId: v.id("participants"),
    role: membershipRole,
    status: v.literal("active"),
  })
    .index("by_participantId", ["participantId"])
    .index("by_poolId", ["poolId"])
    .index("by_poolId_and_participantId", ["poolId", "participantId"]),

  /**
   * Deployment Sync Gate singleton (key = "deployment").
   * Dev defaults OFF; Production defaults ON after Season Bootstrap.
   */
  syncGate: defineTable({
    key: v.literal("deployment"),
    enabled: v.boolean(),
    updatedAtMs: v.number(),
    updatedByTokenIdentifier: v.optional(v.string()),
  }).index("by_key", ["key"]),

  /** Minimal Production Operator audit trail (Season Bootstrap, Sync Gate). */
  operatorAuditEvents: defineTable({
    action: v.string(),
    actorTokenIdentifier: v.string(),
    actorClerkUserId: v.string(),
    atMs: v.number(),
    detailsJson: v.optional(v.string()),
  }).index("by_atMs", ["atMs"]),

  /**
   * Stub queue of provider fetch claim attempts — demonstrates Sync Gate
   * blocking new claims while ordinary queries continue.
   */
  providerFetchClaims: defineTable({
    surface: v.string(),
    status: v.union(v.literal("claimed"), v.literal("denied")),
    reason: v.optional(v.string()),
    claimedAtMs: v.number(),
  }).index("by_claimedAtMs", ["claimedAtMs"]),
});
