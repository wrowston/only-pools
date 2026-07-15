import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { AuthError, requireParticipant } from "./lib/auth";
import {
  canClaimProviderFetch,
  type SyncSurface,
} from "./lib/syncGate";

const SYNC_GATE_KEY = "deployment" as const;

const surfaceValidator = v.union(
  v.literal("schedule"),
  v.literal("live"),
  v.literal("confirmation"),
  v.literal("bootstrap"),
);

async function loadSyncGate(
  ctx: QueryCtx | MutationCtx,
): Promise<{ enabled: boolean }> {
  const gate = await ctx.db
    .query("syncGate")
    .withIndex("by_key", (q) => q.eq("key", SYNC_GATE_KEY))
    .unique();
  // Before any bootstrap, treat as OFF (Dev default / fail-closed for fetch).
  return gate ?? { enabled: false };
}

/**
 * Attempt a provider fetch claim. When Sync Gate is OFF, the claim is denied
 * and recorded — locks and ordinary queries are unaffected.
 */
export const claimProviderFetch = mutation({
  args: {
    surface: surfaceValidator,
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) {
      throw new AuthError("Unauthenticated");
    }

    const gate = await loadSyncGate(ctx);
    const decision = canClaimProviderFetch(gate, args.surface as SyncSurface);
    const claimedAtMs = Date.now();

    if (!decision.ok) {
      await ctx.db.insert("providerFetchClaims", {
        surface: args.surface,
        status: "denied",
        reason: decision.reason,
        claimedAtMs,
      });
      return { ok: false as const, reason: decision.reason };
    }

    await ctx.db.insert("providerFetchClaims", {
      surface: args.surface,
      status: "claimed",
      claimedAtMs,
    });
    return { ok: true as const, surface: args.surface };
  },
});

export const ensureSyncGate = internalMutation({
  args: {
    enabled: v.boolean(),
    actorTokenIdentifier: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const nowMs = Date.now();
    const existing = await ctx.db
      .query("syncGate")
      .withIndex("by_key", (q) => q.eq("key", SYNC_GATE_KEY))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        enabled: args.enabled,
        updatedAtMs: nowMs,
        updatedByTokenIdentifier: args.actorTokenIdentifier,
      });
      return existing._id;
    }
    return await ctx.db.insert("syncGate", {
      key: SYNC_GATE_KEY,
      enabled: args.enabled,
      updatedAtMs: nowMs,
      updatedByTokenIdentifier: args.actorTokenIdentifier,
    });
  },
});

/**
 * Ordinary query that continues to work when Sync Gate is OFF
 * (acceptance scenario 50 — locks/queries continue).
 */
export const listNflTeamSummaries = query({
  args: {},
  handler: async (ctx) => {
    await requireParticipant(ctx);
    const teams = await ctx.db.query("nflTeams").take(100);
    return teams.map((t) => ({
      id: t._id,
      name: t.name,
      abbreviation: t.abbreviation,
    }));
  },
});

export const getSyncGateState = query({
  args: {},
  handler: async (ctx) => {
    await requireParticipant(ctx);
    const gate = await loadSyncGate(ctx);
    return { enabled: gate.enabled };
  },
});
