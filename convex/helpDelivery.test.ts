/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { HELP_DELIVERY_MAX_ATTEMPTS } from "./lib/helpDeliveryPolicy";
import {
  HELP_TEST_RATE_LIMIT_SECRET,
  MIN_HELP_FORM_COMPLETION_MS,
} from "./lib/helpConstants";
import { resendSink } from "./lib/resendSink";
import { sentrySink } from "./lib/sentry";

const modules = import.meta.glob("./**/*.ts");

function createHelpTest() {
  return convexTest(schema, modules);
}

type HelpTest = ReturnType<typeof createHelpTest>;

function validTimingFields() {
  const completedAtMs = Date.now();
  return {
    startedAtMs: completedAtMs - MIN_HELP_FORM_COMPLETION_MS - 500,
    completedAtMs,
  };
}

function supportPayload(overrides: Record<string, unknown> = {}) {
  return {
    lane: "support",
    idempotencyKey: crypto.randomUUID(),
    replyEmail: "submitter@example.test",
    category: "Technical problem",
    message: "The picks page fails to load after refresh.",
    honeypot: "",
    includeDiagnostics: false,
    context: { pagePath: "/help" },
    ...validTimingFields(),
    ...overrides,
  };
}

function feedbackPayload(overrides: Record<string, unknown> = {}) {
  return {
    lane: "feedback",
    idempotencyKey: crypto.randomUUID(),
    sentiment: "negative",
    feedbackType: "problem",
    message: "The week board feels cramped on mobile.",
    honeypot: "",
    includeDiagnostics: false,
    context: { pagePath: "/help" },
    ...validTimingFields(),
    ...overrides,
  };
}

function applyHelpTestEnv() {
  process.env.DEPLOYMENT_KIND = "test";
  process.env.HELP_ALLOWED_ORIGIN = "http://localhost:3000";
  process.env.HELP_SUPPORT_MAILBOX = "support@example.test";
  process.env.HELP_FROM_EMAIL = "Only Pools <noreply@example.test>";
  process.env.HELP_EMAIL_MODE = "double";
  delete process.env.RESEND_API_KEY;
  delete process.env.HELP_NETWORK_HASH_SECRET;
  delete process.env.SENTRY_DSN;
}

describe("Help delivery durability (issue #23)", () => {
  const prevEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of [
      "DEPLOYMENT_KIND",
      "HELP_ALLOWED_ORIGIN",
      "HELP_SUPPORT_MAILBOX",
      "HELP_FROM_EMAIL",
      "HELP_EMAIL_MODE",
      "RESEND_API_KEY",
      "HELP_NETWORK_HASH_SECRET",
      "SENTRY_DSN",
    ]) {
      prevEnv[key] = process.env[key];
    }
    applyHelpTestEnv();
    resendSink.reset();
    sentrySink.reset();
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(prevEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resendSink.reset();
    sentrySink.reset();
  });

  async function acceptSupport(
    t: HelpTest,
    overrides: Record<string, unknown> = {},
  ) {
    const response = await t.fetch("/help/intake", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify(supportPayload(overrides)),
    });
    expect(response.status).toBe(200);
    return (await response.json()) as {
      reference: string;
    };
  }

  async function finishDelivery(t: HelpTest) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }

  async function runDueDelivery(
    t: HelpTest,
    intakeId: Id<"helpIntake">,
  ) {
    await t.run(async (ctx) => {
      const doc = await ctx.db.get("helpIntake", intakeId);
      if (!doc) return;
      const nowMs = Date.now();
      const patch: Record<string, unknown> = {};
      if (
        doc.mailboxDelivery.nextAttemptAtMs !== undefined &&
        doc.mailboxDelivery.nextAttemptAtMs > nowMs
      ) {
        patch.mailboxDelivery = {
          ...doc.mailboxDelivery,
          nextAttemptAtMs: nowMs - 1,
        };
      }
      if (
        doc.receiptDelivery.nextAttemptAtMs !== undefined &&
        doc.receiptDelivery.nextAttemptAtMs > nowMs
      ) {
        patch.receiptDelivery = {
          ...doc.receiptDelivery,
          nextAttemptAtMs: nowMs - 1,
        };
      }
      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(intakeId, patch);
      }
    });
    await t.action(internal.helpDelivery.deliverIntake, { intakeId });
    await finishDelivery(t);
  }

  async function getIntakeByReference(
    t: HelpTest,
    reference: string,
  ) {
    return await t.run(async (ctx) => {
      return await ctx.db
        .query("helpIntake")
        .withIndex("by_reference", (q) => q.eq("reference", reference))
        .unique();
    });
  }

  it("delivers mailbox and receipt on full success", async () => {
    const t = createHelpTest();
    const json = await acceptSupport(t, { idempotencyKey: "del-full-success" });
    await finishDelivery(t);

    const stored = await getIntakeByReference(t, json.reference);
    expect(stored!.mailboxDelivery.status).toBe("sent");
    expect(stored!.receiptDelivery.status).toBe("sent");
    expect(stored!.mailboxDelivery.providerMessageId).toBeTruthy();
    expect(stored!.receiptDelivery.providerMessageId).toBeTruthy();
    expect(resendSink.emails).toHaveLength(2);

    const mailbox = resendSink.emails.find((e) =>
      e.subject.startsWith("[Support]"),
    );
    expect(mailbox?.to).toBe("support@example.test");
    expect(mailbox?.replyTo).toBe("submitter@example.test");
    expect(mailbox?.subject).toContain(json.reference);
  });

  it("shows partial success when mailbox succeeds and receipt fails transiently then succeeds", async () => {
    const t = createHelpTest();
    resendSink.failOnSendNumber(2, {
      status: 500,
      failureClass: "provider_5xx",
    });

    const json = await acceptSupport(t, {
      idempotencyKey: "del-partial-receipt-retry",
    });
    await finishDelivery(t);

    const afterFirst = await getIntakeByReference(t, json.reference);
    expect(afterFirst!.mailboxDelivery.status).toBe("sent");
    expect(afterFirst!.receiptDelivery.status).toBe("pending");
    expect(afterFirst!.receiptDelivery.failureClass).toBe("provider_5xx");
    expect(afterFirst!.receiptDelivery.nextAttemptAtMs).toBeTruthy();
    expect(resendSink.emails).toHaveLength(1);

    await runDueDelivery(t, afterFirst!._id);

    const afterRetry = await getIntakeByReference(t, json.reference);
    expect(afterRetry!.receiptDelivery.status).toBe("sent");
    expect(resendSink.emails).toHaveLength(2);
  });

  it("shows partial success when receipt succeeds and mailbox fails transiently then succeeds", async () => {
    const t = createHelpTest();
    resendSink.failOnSendNumber(1, { status: 503, failureClass: "provider_5xx" });

    const json = await acceptSupport(t, {
      idempotencyKey: "del-partial-mailbox-retry",
    });
    await finishDelivery(t);

    const afterFirst = await getIntakeByReference(t, json.reference);
    expect(afterFirst!.mailboxDelivery.status).toBe("pending");
    expect(afterFirst!.receiptDelivery.status).toBe("sent");
    expect(afterFirst!.mailboxDelivery.failureClass).toBe("provider_5xx");

    await runDueDelivery(t, afterFirst!._id);

    const afterRetry = await getIntakeByReference(t, json.reference);
    expect(afterRetry!.mailboxDelivery.status).toBe("sent");
    expect(resendSink.emails).toHaveLength(2);
  });

  it("does not retry permanent provider failures", async () => {
    const t = createHelpTest();
    resendSink.failPermanently({ status: 400, failureClass: "invalid_request" });

    const json = await acceptSupport(t, {
      idempotencyKey: "del-permanent-fail",
    });
    await finishDelivery(t);

    const stored = await getIntakeByReference(t, json.reference);
    expect(stored!.mailboxDelivery.status).toBe("failed");
    expect(stored!.mailboxDelivery.failureClass).toBe("invalid_request");
    expect(stored!.mailboxDelivery.nextAttemptAtMs).toBeUndefined();
    expect(stored!.mailboxDelivery.attemptCount).toBe(1);
    expect(resendSink.emails).toHaveLength(0);

    await t.action(internal.helpDelivery.deliverIntake, {
      intakeId: stored!._id,
    });
    await finishDelivery(t);

    const afterReplay = await getIntakeByReference(t, json.reference);
    expect(afterReplay!.mailboxDelivery.attemptCount).toBe(1);
    expect(resendSink.emails).toHaveLength(0);
  });

  it("marks exhausted retries as failed and emits safe Sentry metadata only", async () => {
    process.env.DEPLOYMENT_KIND = "production";
    process.env.SENTRY_DSN = "https://example@o0.ingest.sentry.io/0";
    process.env.HELP_NETWORK_HASH_SECRET = HELP_TEST_RATE_LIMIT_SECRET;
    process.env.HELP_EMAIL_MODE = "double";

    const t = createHelpTest();
    resendSink.failNext(HELP_DELIVERY_MAX_ATTEMPTS, {
      status: 500,
      failureClass: "provider_5xx",
    });

    const response = await t.fetch("/help/intake", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify(
        feedbackPayload({
          idempotencyKey: "del-exhausted",
          anonymous: true,
        }),
      ),
    });
    expect(response.status).toBe(200);
    const json = (await response.json()) as { reference: string };

    for (let i = 0; i < HELP_DELIVERY_MAX_ATTEMPTS; i += 1) {
      await finishDelivery(t);
      const stored = await getIntakeByReference(t, json.reference);
      if (stored!.mailboxDelivery.status === "failed") break;
      await runDueDelivery(t, stored!._id);
    }

    const stored = await getIntakeByReference(t, json.reference);
    expect(stored!.mailboxDelivery.status).toBe("failed");
    expect(stored!.mailboxDelivery.attemptCount).toBe(
      HELP_DELIVERY_MAX_ATTEMPTS,
    );
    expect(stored!.mailboxDelivery.nextAttemptAtMs).toBeUndefined();

    const signals = sentrySink.captures.filter(
      (c) => c.tags?.channel === "help_delivery",
    );
    expect(signals).toHaveLength(1);
    expect(signals[0]!.pagesProduction).toBe(true);
    expect(signals[0]!.tags).toMatchObject({
      channel: "help_delivery",
      lane: "feedback",
      recipient: "mailbox",
      failure_class: "provider_5xx",
    });
    const blob = JSON.stringify(signals[0]);
    expect(blob).not.toContain("submitter@example.test");
    expect(blob).not.toContain(json.reference);
    expect(blob).not.toContain("picks page");
  });

  it("does not duplicate emails on idempotent deliverIntake replay after success", async () => {
    const t = createHelpTest();
    const json = await acceptSupport(t, {
      idempotencyKey: "del-idempotent-replay",
    });
    await finishDelivery(t);
    expect(resendSink.emails).toHaveLength(2);

    const stored = await getIntakeByReference(t, json.reference);
    await t.action(internal.helpDelivery.deliverIntake, {
      intakeId: stored!._id,
    });
    await finishDelivery(t);

    expect(resendSink.emails).toHaveLength(2);
  });

  it("uses resend idempotency keys per intake recipient", async () => {
    const t = createHelpTest();
    const json = await acceptSupport(t, {
      idempotencyKey: "del-idem-key-header",
    });
    await finishDelivery(t);

    const stored = await getIntakeByReference(t, json.reference);
    expect(resendSink.emails[0]?.idempotencyKey).toBe(
      `${stored!._id}:mailbox`,
    );
    expect(resendSink.emails[1]?.idempotencyKey).toBe(
      `${stored!._id}:receipt`,
    );
  });

  it("skips receipt for anonymous feedback and only delivers mailbox", async () => {
    const t = createHelpTest();
    const response = await t.fetch("/help/intake", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify(
        feedbackPayload({
          idempotencyKey: "del-anon-feedback",
          anonymous: true,
          replyEmail: "ignored@example.test",
        }),
      ),
    });
    expect(response.status).toBe(200);
    const json = (await response.json()) as { reference: string };
    await finishDelivery(t);

    const stored = await getIntakeByReference(t, json.reference);
    expect(stored!.mailboxDelivery.status).toBe("sent");
    expect(stored!.receiptDelivery.status).toBe("skipped");
    expect(stored!.receiptDelivery.failureClass).toBe("anonymous_feedback");
    expect(resendSink.emails).toHaveLength(1);
  });

  it("schedules bounded delayed retries via mutation-driven policy", async () => {
    const t = createHelpTest();
    resendSink.failNext(1, { status: 500, failureClass: "provider_5xx" });

    const json = await acceptSupport(t, {
      idempotencyKey: "del-scheduled-retry",
    });
    await finishDelivery(t);

    const afterFail = await getIntakeByReference(t, json.reference);
    expect(afterFail!.mailboxDelivery.status).toBe("pending");
    expect(afterFail!.mailboxDelivery.nextAttemptAtMs).toBeTruthy();
    expect(afterFail!.mailboxDelivery.attemptCount).toBe(1);

    await runDueDelivery(t, afterFail!._id);

    const afterRetry = await getIntakeByReference(t, json.reference);
    expect(afterRetry!.mailboxDelivery.status).toBe("sent");
    expect(afterRetry!.mailboxDelivery.attemptCount).toBe(2);
    expect(resendSink.emails).toHaveLength(2);
  });

  it("fails closed in production without required delivery configuration", async () => {
    process.env.DEPLOYMENT_KIND = "production";
    delete process.env.HELP_EMAIL_MODE;
    delete process.env.RESEND_API_KEY;
    delete process.env.HELP_SUPPORT_MAILBOX;

    const t = createHelpTest();
    const response = await t.fetch("/help/intake", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify(supportPayload({ idempotencyKey: "del-prod-gate" })),
    });

    expect(response.status).toBe(503);
    expect(resendSink.emails).toHaveLength(0);
  });
});
