import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * MVP schema for ticket 01 — Participant identity + Available Season stub.
 * Pool memberships / pools arrive in later tickets; My Pools returns [].
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
   * Pool Season rows. Create Pool stays disabled until at least one has
   * status "available" (set by Season Bootstrap in a later ticket).
   */
  poolSeasons: defineTable({
    label: v.string(),
    status: v.union(v.literal("bootstrapping"), v.literal("available")),
  }).index("by_status", ["status"]),
});
