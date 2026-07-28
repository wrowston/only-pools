/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { api, internal } from "./_generated/api";
import { API_SPORTS_RELIABILITY_LIMITS } from "./lib/providerReliabilityPolicy";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const NOW_MS = Date.UTC(2026, 8, 14, 20, 15);

function identity(subject: string) {
  return {
    subject,
    issuer: "https://auth.example.test",
    tokenIdentifier: `https://auth.example.test|${subject}`,
    name: subject,
    email: `${subject}@example.test`,
    emailVerified: true,
  };
}

describe("durable API-Sports reliability fence", () => {
  const previousOperator =
    process.env.PRODUCTION_OPERATOR_CLERK_USER_ID;
  const previousReset =
    process.env.API_SPORTS_DAILY_RESET_UTC_HOUR;

  beforeEach(() => {
    process.env.PRODUCTION_OPERATOR_CLERK_USER_ID = "operator";
    process.env.API_SPORTS_DAILY_RESET_UTC_HOUR = "6";
  });

  afterEach(() => {
    if (previousOperator === undefined) {
      delete process.env.PRODUCTION_OPERATOR_CLERK_USER_ID;
    } else {
      process.env.PRODUCTION_OPERATOR_CLERK_USER_ID = previousOperator;
    }
    if (previousReset === undefined) {
      delete process.env.API_SPORTS_DAILY_RESET_UTC_HOUR;
    } else {
      process.env.API_SPORTS_DAILY_RESET_UTC_HOUR = previousReset;
    }
  });

  it("atomically defers routine work at the reserve while admitting protected work", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("providerReliabilityState", {
        key: "api-sports",
        dailyWindowStartedAtMs: Date.UTC(2026, 8, 14, 6),
        dailyResetAtMs: Date.UTC(2026, 8, 15, 6),
        dailyUsed: 6_000,
        routineDailyUsed: 6_000,
        protectedDailyUsed: 0,
        providerDailyLimit: 7_500,
        minuteAdmissionTimestampsMs: [],
        providerMinuteWindowStartedAtMs: Date.UTC(2026, 8, 14, 20, 15),
        providerMinuteResetAtMs: Date.UTC(2026, 8, 14, 20, 16),
        providerMinuteUsed: 0,
        providerMinuteLimit: 50,
        headerInconsistencyCount: 0,
        staleHeaderCount: 0,
        circuitStatus: "closed",
        circuitGeneration: 0,
        consecutiveFailures: 0,
        deferredRoutineCount: 0,
        rejectedRequestCount: 0,
        circuitBlockedCount: 0,
        updatedAtMs: NOW_MS,
      });
    });
    expect(
      await t.mutation(
        internal.providerReliability.admitApiSportsRequest,
        {
          traffic: "routine",
          surface: "schedule",
          nowMs: NOW_MS,
        },
      ),
    ).toMatchObject({
      ok: false,
      reason: "protected_reserve",
      retryAtMs: Date.UTC(2026, 8, 15, 6),
    });
    expect(
      await t.mutation(
        internal.providerReliability.admitApiSportsRequest,
        {
          traffic: "protected",
          surface: "live",
          nowMs: NOW_MS,
        },
      ),
    ).toMatchObject({ ok: true });
    const state = await t.run(async (ctx) =>
      ctx.db
        .query("providerReliabilityState")
        .withIndex("by_key", (q) => q.eq("key", "api-sports"))
        .unique(),
    );
    expect(state).toMatchObject({
      dailyUsed: 6_001,
      protectedDailyUsed: 1,
      deferredRoutineCount: 1,
      rejectedRequestCount: 1,
    });
  });

  it("serializes concurrent minute admissions at the conservative ceiling", async () => {
    const t = convexTest(schema, modules);
    const results = await Promise.all(
      Array.from({ length: 60 }, () =>
        t.mutation(
          internal.providerReliability.admitApiSportsRequest,
          {
            traffic: "protected" as const,
            surface: "live",
            nowMs: NOW_MS,
          },
        ),
      ),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(
      API_SPORTS_RELIABILITY_LIMITS.minute,
    );
    expect(
      results.filter(
        (result) =>
          !result.ok && result.reason === "minute_exhausted",
      ),
    ).toHaveLength(10);
  });

  it("opens a durable circuit, schedules one recovery probe, and closes it after provider success", async () => {
    const t = convexTest(schema, modules);
    for (let attempt = 1; attempt <= 5; attempt++) {
      await t.mutation(
        internal.providerReliability.recordApiSportsOutcome,
        {
          success: false,
          surface: "live",
          nowMs: NOW_MS + attempt,
          attempt,
          randomUnit: 0.5,
          failureReason: "transport_failure",
        },
      );
    }
    const opened = await t.run(async (ctx) => ({
      state: await ctx.db
        .query("providerReliabilityState")
        .withIndex("by_key", (q) => q.eq("key", "api-sports"))
        .unique(),
      recovery: await ctx.db
        .query("syncWorkItems")
        .withIndex("by_scopeKey", (q) =>
          q.eq("scopeKey", "provider-recovery:api-sports"),
        )
        .unique(),
    }));
    expect(opened.state).toMatchObject({
      circuitStatus: "open",
      consecutiveFailures: 5,
      circuitOpenUntilMs: NOW_MS + 5 + 5 * 60_000,
    });
    expect(opened.recovery).toMatchObject({
      surface: "operator",
      priority: "operator",
      status: "due",
      dueAtMs: NOW_MS + 5 + 5 * 60_000,
      purpose: "provider_recovery_probe",
    });
    expect(
      await t.mutation(
        internal.providerReliability.admitApiSportsRequest,
        {
          traffic: "protected",
          surface: "live",
          nowMs: NOW_MS + 10_000,
        },
      ),
    ).toMatchObject({ ok: false, reason: "circuit_open" });
    const probeAdmission = await t.mutation(
        internal.providerReliability.admitApiSportsRequest,
        {
          traffic: "recovery_probe",
          surface: "operator",
          nowMs: NOW_MS + 5 + 5 * 60_000,
        },
      );
    expect(probeAdmission).toMatchObject({ ok: true });
    if (!probeAdmission.ok) throw new Error("probe should be admitted");
    await t.mutation(
      internal.providerReliability.recordApiSportsOutcome,
      {
        success: true,
        surface: "operator",
        nowMs: NOW_MS + 5 + 5 * 60_000 + 1,
        attempt: 1,
        randomUnit: 0.5,
        receipt: probeAdmission.receipt,
      },
    );
    const recovered = await t.run(async (ctx) => ({
      state: await ctx.db
        .query("providerReliabilityState")
        .withIndex("by_key", (q) => q.eq("key", "api-sports"))
        .unique(),
      recovery: await ctx.db
        .query("syncWorkItems")
        .withIndex("by_scopeKey", (q) =>
          q.eq("scopeKey", "provider-recovery:api-sports"),
        )
        .unique(),
    }));
    expect(recovered.state).toMatchObject({
      circuitStatus: "closed",
      consecutiveFailures: 0,
      recoveredAtMs: NOW_MS + 5 + 5 * 60_000 + 1,
    });
    expect(recovered.recovery?.status).toBe("done");
  });

  it("exposes quota, circuit, deferral, and recovery only to the Production Operator", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(
      internal.providerReliability.admitApiSportsRequest,
      {
        traffic: "protected",
        surface: "live",
        nowMs: NOW_MS,
      },
    );
    const asOwner = t.withIdentity(identity("owner"));
    await expect(
      asOwner.query(
        api.providerReliability.getOperatorProviderReliability,
        {},
      ),
    ).rejects.toThrow(/Production Operator/i);
    const asOperator = t.withIdentity(identity("operator"));
    await expect(
      asOperator.query(
        api.providerReliability.getOperatorProviderReliability,
        {},
      ),
    ).resolves.toMatchObject({
      quota: {
        dailyLimit: 7_500,
        protectedReserve: 1_500,
        minuteLimit: 50,
        dailyUsed: 1,
      },
      circuit: { status: "closed" },
      deferred: { routineCount: 0 },
      recovery: { status: "idle" },
    });
  });
});
