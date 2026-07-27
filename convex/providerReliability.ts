import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import {
  env,
  internalAction,
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import {
  admitProviderRequest,
  API_SPORTS_RECOVERY_SCOPE_KEY,
  API_SPORTS_RELIABILITY_LIMITS,
  emptyProviderReliabilityState,
  effectiveProviderDailyLimit,
  effectiveProviderMinuteLimit,
  effectiveRoutineDailyLimit,
  normalizeProviderReliabilityState,
  reconcileProviderQuota,
  recordProviderFailure,
  recordProviderSuccess,
  retryDelayMs,
  type ProviderAdmissionReceipt,
  type ProviderReliabilityState,
  type ProviderTraffic,
} from "./lib/providerReliabilityPolicy";
import { requireProductionOperatorIdentity } from "./lib/operatorAuth";
import { runEffect } from "./effect/run";
import { ApiSportsProvider } from "./providers/apiSports";
import { createReliableApiSportsFetch } from "./effect/apiSports/reliableFetch";
import { selectSportsDataProvider } from "./providers/sportsData/config";
import { internal } from "./_generated/api";

const PROVIDER_KEY = "api-sports" as const;

const trafficValidator = v.union(
  v.literal("routine"),
  v.literal("protected"),
  v.literal("recovery_probe"),
);

const receiptValidator = v.object({
  dailyWindowStartedAtMs: v.number(),
  providerMinuteWindowStartedAtMs: v.number(),
  circuitGeneration: v.number(),
  probeToken: v.union(v.string(), v.null()),
});

function dailyResetUtcHour(): number {
  const configured = Number(env.API_SPORTS_DAILY_RESET_UTC_HOUR ?? 0);
  return Number.isSafeInteger(configured) &&
    configured >= 0 &&
    configured <= 23
    ? configured
    : 0;
}

function storedState(
  row: Doc<"providerReliabilityState">,
): ProviderReliabilityState {
  return {
    dailyWindowStartedAtMs: row.dailyWindowStartedAtMs,
    dailyResetAtMs: row.dailyResetAtMs,
    dailyUsed: row.dailyUsed,
    routineDailyUsed: row.routineDailyUsed,
    protectedDailyUsed: row.protectedDailyUsed,
    providerDailyLimit: row.providerDailyLimit ?? null,
    providerDailyRemaining: row.providerDailyRemaining ?? null,
    minuteAdmissionTimestampsMs: row.minuteAdmissionTimestampsMs,
    providerMinuteWindowStartedAtMs:
      row.providerMinuteWindowStartedAtMs,
    providerMinuteResetAtMs: row.providerMinuteResetAtMs,
    providerMinuteUsed: row.providerMinuteUsed,
    providerMinuteLimit: row.providerMinuteLimit ?? null,
    providerMinuteRemaining: row.providerMinuteRemaining ?? null,
    headerInconsistencyCount: row.headerInconsistencyCount,
    staleHeaderCount: row.staleHeaderCount,
    circuitStatus: row.circuitStatus,
    circuitGeneration: row.circuitGeneration,
    consecutiveFailures: row.consecutiveFailures,
    circuitOpenedAtMs: row.circuitOpenedAtMs ?? null,
    circuitOpenUntilMs: row.circuitOpenUntilMs ?? null,
    probeToken: row.probeToken ?? null,
    probeExpiresAtMs: row.probeExpiresAtMs ?? null,
    lastAttemptAtMs: row.lastAttemptAtMs ?? null,
    lastSuccessAtMs: row.lastSuccessAtMs ?? null,
    lastFailureAtMs: row.lastFailureAtMs ?? null,
    recoveredAtMs: row.recoveredAtMs ?? null,
  };
}

function persistedState(state: ProviderReliabilityState) {
  return {
    dailyWindowStartedAtMs: state.dailyWindowStartedAtMs,
    dailyResetAtMs: state.dailyResetAtMs,
    dailyUsed: state.dailyUsed,
    routineDailyUsed: state.routineDailyUsed,
    protectedDailyUsed: state.protectedDailyUsed,
    providerDailyLimit: state.providerDailyLimit ?? undefined,
    providerDailyRemaining: state.providerDailyRemaining ?? undefined,
    minuteAdmissionTimestampsMs: [
      ...state.minuteAdmissionTimestampsMs,
    ],
    providerMinuteWindowStartedAtMs:
      state.providerMinuteWindowStartedAtMs,
    providerMinuteResetAtMs: state.providerMinuteResetAtMs,
    providerMinuteUsed: state.providerMinuteUsed,
    providerMinuteLimit: state.providerMinuteLimit ?? undefined,
    providerMinuteRemaining: state.providerMinuteRemaining ?? undefined,
    headerInconsistencyCount: state.headerInconsistencyCount,
    staleHeaderCount: state.staleHeaderCount,
    circuitStatus: state.circuitStatus,
    circuitGeneration: state.circuitGeneration,
    consecutiveFailures: state.consecutiveFailures,
    circuitOpenedAtMs: state.circuitOpenedAtMs ?? undefined,
    circuitOpenUntilMs: state.circuitOpenUntilMs ?? undefined,
    probeToken: state.probeToken ?? undefined,
    probeExpiresAtMs: state.probeExpiresAtMs ?? undefined,
    lastAttemptAtMs: state.lastAttemptAtMs ?? undefined,
    lastSuccessAtMs: state.lastSuccessAtMs ?? undefined,
    lastFailureAtMs: state.lastFailureAtMs ?? undefined,
    recoveredAtMs: state.recoveredAtMs ?? undefined,
  };
}

async function loadState(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"providerReliabilityState"> | null> {
  return await ctx.db
    .query("providerReliabilityState")
    .withIndex("by_key", (q) => q.eq("key", PROVIDER_KEY))
    .unique();
}

async function saveState(
  ctx: MutationCtx,
  row: Doc<"providerReliabilityState"> | null,
  state: ProviderReliabilityState,
  nowMs: number,
  counters?: Partial<
    Pick<
      Doc<"providerReliabilityState">,
      | "deferredRoutineCount"
      | "rejectedRequestCount"
      | "circuitBlockedCount"
      | "lastDeferredAtMs"
      | "lastFailureReason"
    >
  >,
): Promise<Id<"providerReliabilityState">> {
  if (row) {
    await ctx.db.patch(row._id, {
      ...persistedState(state),
      ...counters,
      updatedAtMs: nowMs,
    });
    return row._id;
  }
  return await ctx.db.insert("providerReliabilityState", {
    key: PROVIDER_KEY,
    ...persistedState(state),
    deferredRoutineCount: counters?.deferredRoutineCount ?? 0,
    rejectedRequestCount: counters?.rejectedRequestCount ?? 0,
    circuitBlockedCount: counters?.circuitBlockedCount ?? 0,
    lastDeferredAtMs: counters?.lastDeferredAtMs,
    lastFailureReason: counters?.lastFailureReason,
    updatedAtMs: nowMs,
  });
}

function currentState(
  row: Doc<"providerReliabilityState"> | null,
  nowMs: number,
): ProviderReliabilityState {
  return normalizeProviderReliabilityState(
    row
      ? storedState(row)
      : emptyProviderReliabilityState(nowMs, dailyResetUtcHour()),
    nowMs,
    dailyResetUtcHour(),
  );
}

export const admitApiSportsRequest = internalMutation({
  args: {
    traffic: trafficValidator,
    surface: v.string(),
    nowMs: v.number(),
  },
  handler: async (ctx, args) => {
    const row = await loadState(ctx);
    const decision = admitProviderRequest({
      state: currentState(row, args.nowMs),
      traffic: args.traffic as ProviderTraffic,
      nowMs: args.nowMs,
      dailyResetUtcHour: dailyResetUtcHour(),
    });
    if (decision.ok) {
      await saveState(ctx, row, decision.state, args.nowMs);
      return decision;
    }
    const circuitBlocked =
      decision.reason === "circuit_open" ||
      decision.reason === "recovery_probe_required" ||
      decision.reason === "probe_in_flight";
    await saveState(ctx, row, decision.state, args.nowMs, {
      deferredRoutineCount:
        (row?.deferredRoutineCount ?? 0) +
        (args.traffic === "routine" ? 1 : 0),
      rejectedRequestCount: (row?.rejectedRequestCount ?? 0) + 1,
      circuitBlockedCount:
        (row?.circuitBlockedCount ?? 0) +
        (circuitBlocked ? 1 : 0),
      lastDeferredAtMs:
        args.traffic === "routine"
          ? args.nowMs
          : row?.lastDeferredAtMs,
    });
    return decision;
  },
});

export const reconcileApiSportsQuota = internalMutation({
  args: {
    receipt: receiptValidator,
    nowMs: v.number(),
    dailyLimit: v.union(v.number(), v.null()),
    dailyRemaining: v.union(v.number(), v.null()),
    minuteLimit: v.union(v.number(), v.null()),
    minuteRemaining: v.union(v.number(), v.null()),
  },
  handler: async (ctx, args) => {
    const row = await loadState(ctx);
    const state = reconcileProviderQuota({
      state: currentState(row, args.nowMs),
      receipt: args.receipt as ProviderAdmissionReceipt,
      nowMs: args.nowMs,
      dailyResetUtcHour: dailyResetUtcHour(),
      quota: {
        dailyLimit: args.dailyLimit,
        dailyRemaining: args.dailyRemaining,
        minuteLimit: args.minuteLimit,
        minuteRemaining: args.minuteRemaining,
      },
    });
    await saveState(ctx, row, state, args.nowMs);
    return {
      dailyUsed: state.dailyUsed,
      providerMinuteUsed: state.providerMinuteUsed,
      headerInconsistencyCount: state.headerInconsistencyCount,
      staleHeaderCount: state.staleHeaderCount,
      quotaRetryAtMs:
        state.providerDailyRemaining === 0 ||
        state.dailyUsed >= effectiveProviderDailyLimit(state)
          ? state.dailyResetAtMs
          : state.providerMinuteRemaining === 0 ||
              state.providerMinuteUsed >=
                effectiveProviderMinuteLimit(state)
            ? state.providerMinuteResetAtMs
            : args.nowMs + 60_000,
    };
  },
});

export const getWorkAttemptCount = internalQuery({
  args: { workItemId: v.id("syncWorkItems") },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.workItemId);
    return item?.attemptCount ?? 1;
  },
});

async function upsertRecoveryWork(
  ctx: MutationCtx,
  dueAtMs: number,
): Promise<void> {
  const existing = await ctx.db
    .query("syncWorkItems")
    .withIndex("by_scopeKey", (q) =>
      q.eq("scopeKey", API_SPORTS_RECOVERY_SCOPE_KEY),
    )
    .unique();
  if (existing) {
    await ctx.db.patch(existing._id, {
      status: "due",
      dueAtMs,
      claimedAtMs: undefined,
      leaseExpiresAtMs: undefined,
      deferredReason: undefined,
      deferredAtMs: undefined,
      isProviderDeferred: undefined,
    });
    return;
  }
  await ctx.db.insert("syncWorkItems", {
    surface: "operator",
    scopeKey: API_SPORTS_RECOVERY_SCOPE_KEY,
    priority: "operator",
    status: "due",
    dueAtMs,
    attemptCount: 0,
    purpose: "provider_recovery_probe",
  });
}

export const recordApiSportsOutcome = internalMutation({
  args: {
    success: v.boolean(),
    surface: v.string(),
    nowMs: v.number(),
    attempt: v.number(),
    randomUnit: v.number(),
    receipt: v.optional(receiptValidator),
    failureReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await loadState(ctx);
    const before = currentState(row, args.nowMs);
    const state = args.success
      ? recordProviderSuccess(
          before,
          args.nowMs,
          args.receipt as ProviderAdmissionReceipt | undefined,
        )
      : recordProviderFailure(
          before,
          args.nowMs,
          args.receipt as ProviderAdmissionReceipt | undefined,
        );
    await saveState(ctx, row, state, args.nowMs, {
      lastFailureReason: args.success
        ? row?.lastFailureReason
        : args.failureReason ?? "provider_failure",
    });

    const retryAtMs =
      args.nowMs +
      retryDelayMs({
        attempt: args.attempt,
        randomUnit: args.randomUnit,
      });
    if (!args.success && state.circuitStatus === "open") {
      await upsertRecoveryWork(
        ctx,
        state.circuitOpenUntilMs ?? retryAtMs,
      );
    }
    if (
      args.success &&
      before.circuitStatus === "half_open" &&
      state.circuitStatus === "closed"
    ) {
      const recovery = await ctx.db
        .query("syncWorkItems")
        .withIndex("by_scopeKey", (q) =>
          q.eq("scopeKey", API_SPORTS_RECOVERY_SCOPE_KEY),
        )
        .unique();
      if (recovery) {
        await ctx.db.patch(recovery._id, {
          status: "done",
          claimedAtMs: undefined,
          leaseExpiresAtMs: undefined,
        });
      }
    }
    return {
      retryAtMs,
      circuitStatus: state.circuitStatus,
      circuitGeneration: state.circuitGeneration,
      circuitOpenUntilMs: state.circuitOpenUntilMs,
      outcomeApplied: state !== before,
    };
  },
});

export const runApiSportsRecoveryProbe = internalAction({
  args: { workItemId: v.id("syncWorkItems") },
  handler: async (ctx, args) => {
    const attempt: number = await ctx.runQuery(
      internal.providerReliability.getWorkAttemptCount,
      { workItemId: args.workItemId },
    );
    const reliable = createReliableApiSportsFetch({
      ctx,
      surface: "operator",
      traffic: "recovery_probe",
      jitterKey: String(args.workItemId),
    });
    try {
      const provider = selectSportsDataProvider({
        config: {
          provider: env.SPORTS_DATA_PROVIDER,
          apiSportsKey: env.API_SPORTS_KEY,
        },
        providers: {
          "api-sports": ({ apiKey }) =>
            new ApiSportsProvider({
              apiKey,
              requestFence: reliable.fence,
            }),
        },
      });
      await runEffect(provider.getHealth());
      await reliable.recordOutcome({
        success: true,
        attempt,
        nowMs: Date.now(),
      });
      await ctx.runMutation(internal.syncLive.completeSyncWork, {
        workItemId: args.workItemId,
      });
      return { ok: true as const };
    } catch (error) {
      const nowMs = Date.now();
      const outcome = await reliable.recordOutcome({
        success: false,
        attempt,
        nowMs,
        error,
        failureReason: "provider_recovery_probe_failed",
      });
      await ctx.runMutation(internal.syncLive.requeueFailedWork, {
        workItemId: args.workItemId,
        dueAtMs: Math.max(
          outcome.retryAtMs,
          "circuitOpenUntilMs" in outcome
            ? outcome.circuitOpenUntilMs ?? outcome.retryAtMs
            : outcome.retryAtMs,
        ),
        deferredReason: outcome.deferredReason,
      });
      return { ok: false as const, reason: "recovery_probe_failed" };
    }
  },
});

export const getOperatorProviderReliability = query({
  args: {},
  handler: async (ctx) => {
    await requireProductionOperatorIdentity(ctx, env);
    const [row, recovery, dueWork] = await Promise.all([
      loadState(ctx),
      ctx.db
        .query("syncWorkItems")
        .withIndex("by_scopeKey", (q) =>
          q.eq("scopeKey", API_SPORTS_RECOVERY_SCOPE_KEY),
        )
        .unique(),
      ctx.db
        .query("syncWorkItems")
        .withIndex(
          "by_status_and_isProviderDeferred_and_dueAtMs",
          (q) =>
            q
              .eq("status", "due")
              .eq("isProviderDeferred", true),
        )
        .take(20),
    ]);
    const observedNowMs = Date.now();
    const state = row
      ? observedNowMs >= row.updatedAtMs
        ? currentState(row, observedNowMs)
        : storedState(row)
      : emptyProviderReliabilityState(
          observedNowMs,
          dailyResetUtcHour(),
        );
    return {
      quota: {
        dailyLimit: API_SPORTS_RELIABILITY_LIMITS.daily,
        effectiveDailyLimit: effectiveProviderDailyLimit(state),
        dailyUsed: state.dailyUsed,
        dailyResetAtMs: state.dailyResetAtMs,
        protectedReserve:
          API_SPORTS_RELIABILITY_LIMITS.protectedDaily,
        protectedReserveRemaining: Math.max(
          0,
          effectiveProviderDailyLimit(state) -
            Math.max(
              state.dailyUsed,
              effectiveRoutineDailyLimit(state),
            ),
        ),
        routineUsed: state.routineDailyUsed,
        protectedUsed: state.protectedDailyUsed,
        minuteLimit: API_SPORTS_RELIABILITY_LIMITS.minute,
        rollingMinuteUsed:
          state.minuteAdmissionTimestampsMs.length,
        providerDailyRemaining: state.providerDailyRemaining,
        providerDailyLimit: state.providerDailyLimit,
        providerMinuteRemaining: state.providerMinuteRemaining,
        providerMinuteLimit: state.providerMinuteLimit,
        headerInconsistencyCount: state.headerInconsistencyCount,
        staleHeaderCount: state.staleHeaderCount,
      },
      circuit: {
        status: state.circuitStatus,
        generation: state.circuitGeneration,
        consecutiveFailures: state.consecutiveFailures,
        openedAtMs: state.circuitOpenedAtMs,
        openUntilMs: state.circuitOpenUntilMs,
        lastSuccessAtMs: state.lastSuccessAtMs,
        lastFailureAtMs: state.lastFailureAtMs,
        recoveredAtMs: state.recoveredAtMs,
        probeExpiresAtMs: state.probeExpiresAtMs,
      },
      deferred: {
        routineCount: row?.deferredRoutineCount ?? 0,
        rejectedCount: row?.rejectedRequestCount ?? 0,
        circuitBlockedCount: row?.circuitBlockedCount ?? 0,
        lastDeferredAtMs: row?.lastDeferredAtMs ?? null,
        active: dueWork.map((item) => ({
            surface: item.surface,
            reason: item.deferredReason ?? "provider_deferred",
            dueAtMs: item.dueAtMs,
          })),
      },
      recovery: recovery
        ? {
            status: recovery.status,
            dueAtMs: recovery.dueAtMs,
            attemptCount: recovery.attemptCount,
          }
        : {
            status: "idle" as const,
            dueAtMs: null,
            attemptCount: 0,
          },
    };
  },
});
