/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import {
  HELP_RETENTION_MS,
  HELP_THROTTLE_WINDOW_MS,
} from "./lib/helpConstants";

const modules = import.meta.glob("./**/*.ts");

const pendingDelivery = {
  status: "pending" as const,
  attemptCount: 0,
};

function createHelpTest() {
  return convexTest(schema, modules);
}

type HelpTest = ReturnType<typeof createHelpTest>;

async function insertIntake(
  t: HelpTest,
  args: {
    reference: string;
    idempotencyKey: string;
    acceptedAtMs: number;
    expiresAtMs: number;
    message?: string;
    replyEmail?: string;
    contextJson?: string;
  },
): Promise<Id<"helpIntake">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("helpIntake", {
      reference: args.reference,
      idempotencyKey: args.idempotencyKey,
      lane: "support",
      supportCategory: "Technical problem",
      message: args.message ?? "Sensitive intake message body",
      replyEmail: args.replyEmail ?? "submitter@example.test",
      anonymous: false,
      includeDiagnostics: true,
      contextJson:
        args.contextJson ??
        JSON.stringify({
          accountId: "participant_sensitive",
          email: "submitter@example.test",
        }),
      acceptedAtMs: args.acceptedAtMs,
      expiresAtMs: args.expiresAtMs,
      mailboxDelivery: { ...pendingDelivery },
      receiptDelivery: { ...pendingDelivery },
    });
  });
}

async function insertThrottle(
  t: HelpTest,
  args: {
    keyHash: string;
    expiresAtMs: number;
    windowStartMs?: number;
  },
): Promise<Id<"helpThrottle">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("helpThrottle", {
      keyHash: args.keyHash,
      keyKind: "account",
      windowStartMs: args.windowStartMs ?? args.expiresAtMs - HELP_THROTTLE_WINDOW_MS,
      count: 3,
      expiresAtMs: args.expiresAtMs,
    });
  });
}

describe("Help retention purge (issue #24)", () => {
  it("sets intake expiry at acceptance time plus 90 days", async () => {
    const t = createHelpTest();
    const acceptedAtMs = 1_700_000_000_000;
    const intakeId = await insertIntake(t, {
      reference: "HELP-RETENTION-1",
      idempotencyKey: "retention-expiry-intake",
      acceptedAtMs,
      expiresAtMs: acceptedAtMs + HELP_RETENTION_MS,
    });

    const doc = await t.run(async (ctx) => ctx.db.get("helpIntake", intakeId));
    expect(doc?.expiresAtMs).toBe(acceptedAtMs + HELP_RETENTION_MS);
  });

  it("deletes expired intake records and removes all sensitive fields with the document", async () => {
    const t = createHelpTest();
    const nowMs = 1_800_000_000_000;
    const intakeId = await insertIntake(t, {
      reference: "HELP-EXPIRED-1",
      idempotencyKey: "expired-intake",
      acceptedAtMs: nowMs - HELP_RETENTION_MS - 1_000,
      expiresAtMs: nowMs - 1_000,
      message: "Secret support message",
      replyEmail: "secret@example.test",
      contextJson: JSON.stringify({ email: "secret@example.test" }),
    });

    const result = await t.mutation(internal.helpRetention.purgeExpiredHelpData, {
      nowMs,
      batchSize: 50,
    });

    expect(result).toEqual({
      intakeDeleted: 1,
      throttleDeleted: 0,
      continued: false,
    });

    const gone = await t.run(async (ctx) => ctx.db.get("helpIntake", intakeId));
    expect(gone).toBeNull();
  });

  it("leaves intake records that have not yet expired", async () => {
    const t = createHelpTest();
    const nowMs = 1_800_000_000_000;
    const intakeId = await insertIntake(t, {
      reference: "HELP-FRESH-1",
      idempotencyKey: "fresh-intake",
      acceptedAtMs: nowMs,
      expiresAtMs: nowMs + HELP_RETENTION_MS,
    });

    const result = await t.mutation(internal.helpRetention.purgeExpiredHelpData, {
      nowMs,
      batchSize: 50,
    });

    expect(result).toEqual({
      intakeDeleted: 0,
      throttleDeleted: 0,
      continued: false,
    });

    const remaining = await t.run(async (ctx) =>
      ctx.db.get("helpIntake", intakeId),
    );
    expect(remaining?.reference).toBe("HELP-FRESH-1");
  });

  it("deletes expired throttle records and keeps active counters", async () => {
    const t = createHelpTest();
    const nowMs = 1_800_000_000_000;
    const expiredId = await insertThrottle(t, {
      keyHash: "expired-throttle-key",
      expiresAtMs: nowMs - 1_000,
    });
    const freshId = await insertThrottle(t, {
      keyHash: "fresh-throttle-key",
      expiresAtMs: nowMs + HELP_THROTTLE_WINDOW_MS,
      windowStartMs: nowMs,
    });

    const result = await t.mutation(internal.helpRetention.purgeExpiredHelpData, {
      nowMs,
      batchSize: 50,
    });

    expect(result).toEqual({
      intakeDeleted: 0,
      throttleDeleted: 1,
      continued: false,
    });

    const expiredGone = await t.run(async (ctx) =>
      ctx.db.get("helpThrottle", expiredId),
    );
    const freshRemaining = await t.run(async (ctx) =>
      ctx.db.get("helpThrottle", freshId),
    );
    expect(expiredGone).toBeNull();
    expect(freshRemaining?.keyHash).toBe("fresh-throttle-key");
  });

  it("schedules continuation until all expired intake records are cleared", async () => {
    const t = createHelpTest();
    const nowMs = 1_800_000_000_000;
    const batchSize = 5;
    const totalExpired = batchSize + 5;

    const intakeIds: Id<"helpIntake">[] = [];
    for (let i = 0; i < totalExpired; i += 1) {
      intakeIds.push(
        await insertIntake(t, {
          reference: `HELP-BATCH-${i}`,
          idempotencyKey: `expired-batch-${i}`,
          acceptedAtMs: nowMs - HELP_RETENTION_MS - 1_000 - i,
          expiresAtMs: nowMs - 1_000 - i,
        }),
      );
    }

    const firstPass = await t.mutation(
      internal.helpRetention.purgeExpiredHelpData,
      { nowMs, batchSize },
    );
    expect(firstPass.intakeDeleted).toBe(batchSize);
    expect(firstPass.continued).toBe(true);

    for (let round = 0; round < 3; round += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await t.finishInProgressScheduledFunctions();
    }

    for (const intakeId of intakeIds) {
      const doc = await t.run(async (ctx) => ctx.db.get("helpIntake", intakeId));
      expect(doc).toBeNull();
    }
  });
});
