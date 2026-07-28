/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { internal } from "./_generated/api";
import { API_SPORTS_RECOVERY_SCOPE_KEY } from "./lib/providerReliabilityPolicy";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function enableDispatcher(t: ReturnType<typeof convexTest>) {
  await t.mutation(internal.sync.ensureSyncGate, { enabled: true });
}

describe("provider-neutral sync dispatcher", () => {
  const previousDeploymentKind = process.env.DEPLOYMENT_KIND;

  beforeAll(() => {
    process.env.DEPLOYMENT_KIND = "development";
  });

  afterAll(() => {
    if (previousDeploymentKind === undefined) {
      delete process.env.DEPLOYMENT_KIND;
    } else {
      process.env.DEPLOYMENT_KIND = previousDeploymentKind;
    }
  });

  it("dispatches the recovery probe ahead of more than 200 routine rows", async () => {
    const t = convexTest(schema, modules);
    const nowMs = Date.now();
    await enableDispatcher(t);
    await t.run(async (ctx) => {
      for (let index = 0; index < 250; index += 1) {
        await ctx.db.insert("syncWorkItems", {
          surface: "schedule",
          scopeKey: `schedule:backlog:${index}`,
          priority: "routine",
          status: "due",
          dueAtMs: nowMs - 10_000,
          attemptCount: 0,
          purpose: "season_schedule",
        });
      }
      await ctx.db.insert("syncWorkItems", {
        surface: "operator",
        scopeKey: API_SPORTS_RECOVERY_SCOPE_KEY,
        priority: "operator",
        status: "due",
        dueAtMs: nowMs,
        attemptCount: 0,
        purpose: "provider_recovery_probe",
      });
    });

    const result = await t.mutation(
      internal.syncLive.dispatchSyncWork,
      { nowMs, maxClaims: 1 },
    );
    expect(result.claimed).toEqual([
      expect.objectContaining({
        scopeKey: API_SPORTS_RECOVERY_SCOPE_KEY,
        purpose: "provider_recovery_probe",
        priority: "operator",
      }),
    ]);
  });

  it("recovers an expired lease beyond 200 non-expired claims", async () => {
    const t = convexTest(schema, modules);
    const nowMs = Date.now();
    await enableDispatcher(t);
    await t.run(async (ctx) => {
      for (let index = 0; index < 201; index += 1) {
        await ctx.db.insert("syncWorkItems", {
          surface: "schedule",
          scopeKey: `schedule:leased:${index}`,
          priority: "routine",
          status: "claimed",
          dueAtMs: nowMs - 20_000,
          claimedAtMs: nowMs - 10_000,
          leaseExpiresAtMs: nowMs + 60_000,
          attemptCount: 1,
          purpose: "season_schedule",
        });
      }
      await ctx.db.insert("syncWorkItems", {
        surface: "schedule",
        scopeKey: "schedule:expired",
        priority: "routine",
        status: "claimed",
        dueAtMs: nowMs - 10_000,
        claimedAtMs: nowMs - 20_000,
        leaseExpiresAtMs: nowMs - 1,
        attemptCount: 1,
        purpose: "season_schedule",
      });
    });

    const result = await t.mutation(
      internal.syncLive.dispatchSyncWork,
      { nowMs, maxClaims: 1 },
    );
    expect(result.claimed[0]?.scopeKey).toBe("schedule:expired");
  });
});
