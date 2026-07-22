/**
 * Operator Incidents — open/acknowledge/resolve + participant StatusBanner.
 * Recovery mutations require Production Operator + step-up + audit.
 * Never invents NFL results, reopens Pick Locks, or sets a Pool-wide
 * maintenance lock (scenarios 34–35, 42–44).
 */

import { v } from "convex/values";
import {
  internalMutation,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { AuthError, requireParticipant } from "./lib/auth";
import {
  incidentDedupeKey,
  participantBannerSummary,
  shouldOpenIncident,
  type IncidentTriggerInput,
  type IncidentType,
} from "./lib/incidents";
import { createLogger } from "./lib/log";
import { isProductionOperator } from "./lib/operator";
import { captureIncidentSignal } from "./lib/sentry";
import { resolveDeploymentKind } from "./lib/syncGate";
import { enqueueSentryDelivery } from "./sentry";

const log = createLogger("incidents");

const STEP_UP_TTL_MS = 5 * 60 * 1000;

class IncidentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IncidentError";
  }
}

type AuthCtx = QueryCtx | MutationCtx;

async function requireOperatorIdentity(ctx: AuthCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) {
    throw new AuthError("Unauthenticated");
  }
  const allowed = isProductionOperator(
    {
      tokenIdentifier: identity.tokenIdentifier,
      clerkUserId: identity.subject,
    },
    process.env as Record<string, string | undefined>,
  );
  if (!allowed) {
    throw new AuthError("Production Operator required");
  }
  return {
    tokenIdentifier: identity.tokenIdentifier,
    clerkUserId: identity.subject,
  };
}

function requireFreshStepUp(participant: Doc<"participants">, nowMs: number) {
  const at = participant.stepUpVerifiedAtMs;
  if (at === undefined || nowMs - at > STEP_UP_TTL_MS) {
    throw new IncidentError(
      "Step-up Verification required for Operator Incident recovery actions",
    );
  }
}

async function writeOperatorAudit(
  ctx: MutationCtx,
  args: {
    action: string;
    actorTokenIdentifier: string;
    actorClerkUserId: string;
    details?: Record<string, string | number | boolean | null>;
  },
) {
  await ctx.db.insert("operatorAuditEvents", {
    action: args.action,
    actorTokenIdentifier: args.actorTokenIdentifier,
    actorClerkUserId: args.actorClerkUserId,
    atMs: Date.now(),
    detailsJson: args.details ? JSON.stringify(args.details) : undefined,
  });
}

const OPEN_STATUSES = ["open", "acknowledged", "in_progress"] as const;

async function findOpenByDedupe(
  ctx: MutationCtx | QueryCtx,
  dedupeKey: string,
): Promise<Doc<"operatorIncidents"> | null> {
  for (const status of OPEN_STATUSES) {
    const row = await ctx.db
      .query("operatorIncidents")
      .withIndex("by_dedupeKey_and_status", (q) =>
        q.eq("dedupeKey", dedupeKey).eq("status", status),
      )
      .unique();
    if (row) return row;
  }
  return null;
}

const freshnessTrigger = v.object({
  kind: v.literal("freshness"),
  freshnessState: v.union(
    v.literal("fresh"),
    v.literal("late"),
    v.literal("stale"),
    v.literal("provider_exception"),
  ),
  activeGameWindow: v.boolean(),
});

const scoringDelayedTrigger = v.object({
  kind: v.literal("scoring_delayed"),
  verifiedResultAtMs: v.number(),
  latestRevisionAtMs: v.union(v.number(), v.null()),
  nowMs: v.number(),
});

const quarantineTrigger = v.object({
  kind: v.literal("quarantine_past_confirmation"),
  confirmationWindowEndsAtMs: v.number(),
  nowMs: v.number(),
  verificationBlocked: v.boolean(),
});

const capacityTrigger = v.object({
  kind: v.literal("convex_capacity"),
  utilizationRatio: v.number(),
  projectedOverage: v.boolean(),
});

const providerExceptionTrigger = v.object({
  kind: v.literal("provider_exception"),
});

const incidentTriggerValidator = v.union(
  freshnessTrigger,
  scoringDelayedTrigger,
  quarantineTrigger,
  capacityTrigger,
  providerExceptionTrigger,
);

async function openFromTrigger(
  ctx: MutationCtx,
  args: {
    trigger: IncidentTriggerInput;
    surface: string;
    scopeKey: string;
    summary?: string;
    nowMs: number;
  },
): Promise<
  | { opened: false; incidentId: null }
  | { opened: false; incidentId: Id<"operatorIncidents">; deduped: true }
  | { opened: true; incidentId: Id<"operatorIncidents">; deduped: false }
> {
  const decision = shouldOpenIncident(args.trigger);
  if (!decision.open || decision.type === null) {
    return { opened: false as const, incidentId: null };
  }

  const dedupeKey = incidentDedupeKey(
    decision.type,
    args.surface,
    args.scopeKey,
  );
  const existing = await findOpenByDedupe(ctx, dedupeKey);
  if (existing) {
    log.info("incident_deduped", {
      incidentId: existing._id,
      type: decision.type,
      surface: args.surface,
      scopeKey: args.scopeKey,
      triggerKind: args.trigger.kind,
    });
    return {
      opened: false as const,
      incidentId: existing._id,
      deduped: true as const,
    };
  }

  const summary = args.summary ?? participantBannerSummary(decision.type);
  const incidentId = await ctx.db.insert("operatorIncidents", {
    type: decision.type,
    status: "open",
    surface: args.surface,
    scopeKey: args.scopeKey,
    dedupeKey,
    participantVisible: decision.participantVisible,
    summary,
    openedAtMs: args.nowMs,
    maintenanceLock: false,
  });

  log.warn("incident_opened", {
    incidentId,
    type: decision.type,
    surface: args.surface,
    scopeKey: args.scopeKey,
    participantVisible: decision.participantVisible,
    triggerKind: args.trigger.kind,
  });

  await enqueueSentryDelivery(
    ctx,
    captureIncidentSignal({
      signal: "opened",
      incidentType: decision.type,
      dedupeKey,
      summary,
    }),
  );

  return { opened: true as const, incidentId, deduped: false as const };
}

/**
 * Evaluate a trigger and open (or dedupe) an Operator Incident.
 * Always sets maintenanceLock: false — picking continues during repair.
 */
export const evaluateAndOpenIncident = internalMutation({
  args: {
    trigger: incidentTriggerValidator,
    surface: v.string(),
    scopeKey: v.string(),
    summary: v.optional(v.string()),
    nowMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await openFromTrigger(ctx, {
      trigger: args.trigger as IncidentTriggerInput,
      surface: args.surface,
      scopeKey: args.scopeKey,
      summary: args.summary,
      nowMs: args.nowMs ?? Date.now(),
    });
  },
});

/**
 * Auto-resolve open incidents for a dedupe key when the condition clears.
 */
export const autoResolveIncident = internalMutation({
  args: {
    type: v.union(
      v.literal("provider_exception"),
      v.literal("stale_in_window"),
      v.literal("scoring_delayed"),
      v.literal("quarantine_past_confirmation"),
      v.literal("convex_capacity"),
    ),
    surface: v.string(),
    scopeKey: v.string(),
    nowMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const nowMs = args.nowMs ?? Date.now();
    const dedupeKey = incidentDedupeKey(args.type, args.surface, args.scopeKey);
    const existing = await findOpenByDedupe(ctx, dedupeKey);
    if (!existing) return { resolved: false as const };

    await ctx.db.patch(existing._id, {
      status: "resolved",
      resolvedAtMs: nowMs,
      resolvedAutomatically: true,
    });

    log.info("incident_auto_resolved", {
      incidentId: existing._id,
      type: args.type,
      surface: args.surface,
      scopeKey: args.scopeKey,
    });

    await enqueueSentryDelivery(
      ctx,
      captureIncidentSignal({
        signal: "resolved",
        incidentType: args.type,
        dedupeKey,
        summary: existing.summary,
      }),
    );

    return { resolved: true as const, incidentId: existing._id };
  },
});

/**
 * Participant StatusBanner — at most one top banner for open participant-visible
 * incidents. Healthy → null (no last-updated chrome).
 */
export const getParticipantStatusBanner = query({
  args: {},
  handler: async (ctx) => {
    // Prefer most recent open → acknowledged → in_progress among visible.
    const candidates: Doc<"operatorIncidents">[] = [];
    for (const status of OPEN_STATUSES) {
      const rows = await ctx.db
        .query("operatorIncidents")
        .withIndex("by_participantVisible_and_status", (q) =>
          q.eq("participantVisible", true).eq("status", status),
        )
        .take(20);
      candidates.push(...rows);
    }

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => b.openedAtMs - a.openedAtMs);
    const top = candidates[0]!;
    return {
      incidentId: top._id,
      type: top.type,
      status: top.status,
      summary: top.summary,
      openedAtMs: top.openedAtMs,
      /** Always false — no Pool-wide maintenance lock during repair. */
      maintenanceLock: false as const,
    };
  },
});

/**
 * Operator incident list — allowlisted Production Operator only; no step-up.
 */
export const listOperatorIncidents = query({
  args: {
    includeResolved: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireOperatorIdentity(ctx);
    const includeResolved = args.includeResolved ?? false;

    const open: Doc<"operatorIncidents">[] = [];
    for (const status of OPEN_STATUSES) {
      const rows = await ctx.db
        .query("operatorIncidents")
        .withIndex("by_status_and_openedAtMs", (q) => q.eq("status", status))
        .take(100);
      open.push(...rows);
    }

    if (!includeResolved) {
      return open.sort((a, b) => b.openedAtMs - a.openedAtMs);
    }

    const resolved = await ctx.db
      .query("operatorIncidents")
      .withIndex("by_status_and_openedAtMs", (q) => q.eq("status", "resolved"))
      .take(100);
    return [...open, ...resolved].sort((a, b) => b.openedAtMs - a.openedAtMs);
  },
});

/** Whether the caller is the allowlisted Production Operator (for UI chrome). */
export const amIProductionOperator = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) return { isOperator: false };
    return {
      isOperator: isProductionOperator(
        {
          tokenIdentifier: identity.tokenIdentifier,
          clerkUserId: identity.subject,
        },
        process.env as Record<string, string | undefined>,
      ),
      deploymentKind: resolveDeploymentKind(
        process.env as Record<string, string | undefined>,
      ),
    };
  },
});

export const acknowledgeIncident = mutation({
  args: {
    incidentId: v.id("operatorIncidents"),
    nowMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperatorIdentity(ctx);
    const participant = await requireParticipant(ctx);
    const nowMs = args.nowMs ?? Date.now();
    requireFreshStepUp(participant, nowMs);

    const incident = await ctx.db.get(args.incidentId);
    if (!incident || incident.status === "resolved") {
      throw new IncidentError("Operator Incident not found or already resolved");
    }

    await ctx.db.patch(incident._id, {
      status: "acknowledged",
      acknowledgedAtMs: nowMs,
    });

    await writeOperatorAudit(ctx, {
      action: "incident_acknowledged",
      actorTokenIdentifier: operator.tokenIdentifier,
      actorClerkUserId: operator.clerkUserId,
      details: {
        incidentId: incident._id,
        type: incident.type,
        dedupeKey: incident.dedupeKey,
      },
    });

    await enqueueSentryDelivery(
      ctx,
      captureIncidentSignal({
        signal: "escalated",
        incidentType: incident.type,
        dedupeKey: incident.dedupeKey,
        summary: "acknowledged",
      }),
    );

    log.info("incident_acknowledged", {
      incidentId: incident._id,
      type: incident.type,
      actorClerkUserId: operator.clerkUserId,
    });

    return { status: "acknowledged" as const };
  },
});

export const resolveIncident = mutation({
  args: {
    incidentId: v.id("operatorIncidents"),
    resolutionNote: v.optional(v.string()),
    nowMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperatorIdentity(ctx);
    const participant = await requireParticipant(ctx);
    const nowMs = args.nowMs ?? Date.now();
    requireFreshStepUp(participant, nowMs);

    const incident = await ctx.db.get(args.incidentId);
    if (!incident || incident.status === "resolved") {
      throw new IncidentError("Operator Incident not found or already resolved");
    }

    await ctx.db.patch(incident._id, {
      status: "resolved",
      resolvedAtMs: nowMs,
      resolutionNote: args.resolutionNote,
      resolvedAutomatically: false,
    });

    await writeOperatorAudit(ctx, {
      action: "incident_resolved",
      actorTokenIdentifier: operator.tokenIdentifier,
      actorClerkUserId: operator.clerkUserId,
      details: {
        incidentId: incident._id,
        type: incident.type,
        note: args.resolutionNote ?? null,
      },
    });

    await enqueueSentryDelivery(
      ctx,
      captureIncidentSignal({
        signal: "resolved",
        incidentType: incident.type,
        dedupeKey: incident.dedupeKey,
        summary: args.resolutionNote,
      }),
    );

    log.info("incident_resolved", {
      incidentId: incident._id,
      type: incident.type,
      actorClerkUserId: operator.clerkUserId,
      hasNote: Boolean(args.resolutionNote),
    });

    return { status: "resolved" as const };
  },
});

/**
 * Audited priority resync — merges into sync work; never edits authoritative
 * inputs, reopens Pick Locks, or invents results.
 */
export const requestAuditedResync = mutation({
  args: {
    incidentId: v.id("operatorIncidents"),
    reason: v.string(),
    surface: v.union(
      v.literal("schedule"),
      v.literal("live"),
      v.literal("confirmation"),
      v.literal("correction"),
    ),
    scopeKey: v.string(),
    seasonId: v.optional(v.id("poolSeasons")),
    gameId: v.optional(v.id("nflGames")),
    nowMs: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    workItemId: Id<"syncWorkItems">;
    maintenanceLock: false;
    reopenedLocks: false;
    editedAuthoritativeInputs: false;
  }> => {
    const operator = await requireOperatorIdentity(ctx);
    const participant = await requireParticipant(ctx);
    const nowMs = args.nowMs ?? Date.now();
    requireFreshStepUp(participant, nowMs);

    if (!args.reason.trim()) {
      throw new IncidentError("A reason is required for audited resync");
    }

    const incident = await ctx.db.get(args.incidentId);
    if (!incident || incident.status === "resolved") {
      throw new IncidentError("Operator Incident not found or already resolved");
    }

    // Mark in progress; never flip maintenanceLock.
    await ctx.db.patch(incident._id, {
      status: "in_progress",
      maintenanceLock: false,
    });

    const workItemId: Id<"syncWorkItems"> = await ctx.runMutation(
      internal.syncLive.enqueueSyncWork,
      {
        surface: args.surface,
        scopeKey: args.scopeKey,
        priority: "operator",
        dueAtMs: nowMs,
        seasonId: args.seasonId,
        gameId: args.gameId,
        purpose: `operator_resync:${args.reason.trim().slice(0, 200)}`,
      },
    );

    await writeOperatorAudit(ctx, {
      action: "audited_resync_requested",
      actorTokenIdentifier: operator.tokenIdentifier,
      actorClerkUserId: operator.clerkUserId,
      details: {
        incidentId: incident._id,
        workItemId,
        surface: args.surface,
        scopeKey: args.scopeKey,
        reason: args.reason.trim().slice(0, 500),
        // Explicit: recovery never reopens locks or edits NFL facts.
        reopenedLocks: false,
        editedAuthoritativeInputs: false,
      },
    });

    log.info("audited_resync_requested", {
      incidentId: incident._id,
      workItemId,
      surface: args.surface,
      scopeKey: args.scopeKey,
      actorClerkUserId: operator.clerkUserId,
    });

    return {
      workItemId,
      maintenanceLock: false as const,
      reopenedLocks: false as const,
      editedAuthoritativeInputs: false as const,
    };
  },
});

/**
 * Audited scoring replay — re-applies last official inputs for a Pool Week.
 * Cannot invent results or reopen Pick Locks (scenario 34).
 */
export const requestAuditedReplay = mutation({
  args: {
    incidentId: v.id("operatorIncidents"),
    reason: v.string(),
    poolId: v.id("pools"),
    week: v.number(),
    nowMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperatorIdentity(ctx);
    const participant = await requireParticipant(ctx);
    const nowMs = args.nowMs ?? Date.now();
    requireFreshStepUp(participant, nowMs);

    if (!args.reason.trim()) {
      throw new IncidentError("A reason is required for audited replay");
    }

    const incident = await ctx.db.get(args.incidentId);
    if (!incident || incident.status === "resolved") {
      throw new IncidentError("Operator Incident not found or already resolved");
    }

    const pool = await ctx.db.get(args.poolId);
    if (!pool) {
      throw new IncidentError("Pool not found");
    }

    await ctx.db.patch(incident._id, {
      status: "in_progress",
      maintenanceLock: false,
    });

    // Schedule deterministic replay of existing Verified Results — no invented
    // scores. Pool roles cannot call this path.
    if (pool.type === "survivor") {
      await ctx.scheduler.runAfter(
        0,
        internal.survivorScoring.applySurvivorScoringRevision,
        {
          poolId: args.poolId,
          week: args.week,
          nowMs,
        },
      );
    } else {
      await ctx.scheduler.runAfter(
        0,
        internal.confidenceScoring.applyConfidenceScoringRevision,
        {
          poolId: args.poolId,
          week: args.week,
          nowMs,
        },
      );
    }

    await writeOperatorAudit(ctx, {
      action: "audited_replay_requested",
      actorTokenIdentifier: operator.tokenIdentifier,
      actorClerkUserId: operator.clerkUserId,
      details: {
        incidentId: incident._id,
        poolId: args.poolId,
        week: args.week,
        poolType: pool.type,
        reason: args.reason.trim().slice(0, 500),
        reopenedLocks: false,
        editedAuthoritativeInputs: false,
      },
    });

    log.info("audited_replay_requested", {
      incidentId: incident._id,
      poolId: args.poolId,
      week: args.week,
      poolType: pool.type,
      actorClerkUserId: operator.clerkUserId,
    });

    return {
      scheduled: true as const,
      maintenanceLock: false as const,
      reopenedLocks: false as const,
      editedAuthoritativeInputs: false as const,
    };
  },
});

/** Test / evaluator helper: open from a typed trigger without going through sync. */
export const openIncidentForTest = internalMutation({
  args: {
    type: v.union(
      v.literal("provider_exception"),
      v.literal("stale_in_window"),
      v.literal("scoring_delayed"),
      v.literal("quarantine_past_confirmation"),
      v.literal("convex_capacity"),
    ),
    surface: v.string(),
    scopeKey: v.string(),
    participantVisible: v.boolean(),
    summary: v.optional(v.string()),
    nowMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const nowMs = args.nowMs ?? Date.now();
    const type = args.type as IncidentType;
    const dedupeKey = incidentDedupeKey(type, args.surface, args.scopeKey);
    const existing = await findOpenByDedupe(ctx, dedupeKey);
    if (existing) return existing._id;

    const summary = args.summary ?? participantBannerSummary(type);
    const id = await ctx.db.insert("operatorIncidents", {
      type,
      status: "open",
      surface: args.surface,
      scopeKey: args.scopeKey,
      dedupeKey,
      participantVisible: args.participantVisible,
      summary,
      openedAtMs: nowMs,
      maintenanceLock: false,
    });

    await enqueueSentryDelivery(
      ctx,
      captureIncidentSignal({
        signal: "opened",
        incidentType: type,
        dedupeKey,
        summary,
      }),
    );

    return id;
  },
});

/**
 * After the scoring-delay threshold, open an incident if a Verified Result still
 * lacks a Scoring Revision for affected Pool Weeks.
 */
export const checkScoringDelayForGame = internalMutation({
  args: {
    gameId: v.id("nflGames"),
    verifiedAtMs: v.number(),
    nowMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const nowMs = args.nowMs ?? Date.now();
    const game = await ctx.db.get(args.gameId);
    if (!game || game.resultAuthority !== "verified") {
      return { opened: 0 };
    }

    const pools = await ctx.db
      .query("pools")
      .withIndex("by_seasonId", (q) => q.eq("seasonId", game.seasonId))
      .take(200);

    let opened = 0;
    for (const pool of pools) {
      if (game.week < pool.startWeek) continue;
      const weekRow = await ctx.db
        .query("poolWeeks")
        .withIndex("by_poolId_and_week", (q) =>
          q.eq("poolId", pool._id).eq("week", game.week),
        )
        .unique();
      const latestRevisionAtMs =
        weekRow?.currentScoringRevisionId !== undefined
          ? ((await ctx.db.get(weekRow.currentScoringRevisionId))
              ?.publishedAtMs ?? null)
          : null;

      const result = await openFromTrigger(ctx, {
        trigger: {
          kind: "scoring_delayed",
          verifiedResultAtMs: args.verifiedAtMs,
          latestRevisionAtMs,
          nowMs,
        },
        surface: "scoring",
        scopeKey: `pool:${pool._id}:week:${game.week}`,
        nowMs,
      });
      if (result.opened) opened += 1;
    }
    return { opened };
  },
});

/**
 * Open a quarantine incident when verification remains blocked past confirmation.
 */
export const checkQuarantinePastConfirmation = internalMutation({
  args: {
    gameId: v.id("nflGames"),
    confirmationWindowEndsAtMs: v.number(),
    verificationBlocked: v.boolean(),
    nowMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const nowMs = args.nowMs ?? Date.now();
    return await openFromTrigger(ctx, {
      trigger: {
        kind: "quarantine_past_confirmation",
        confirmationWindowEndsAtMs: args.confirmationWindowEndsAtMs,
        nowMs,
        verificationBlocked: args.verificationBlocked,
      },
      surface: "confirmation",
      scopeKey: `game:${args.gameId}`,
      nowMs,
    });
  },
});
