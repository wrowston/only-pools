/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { isOpaqueHelpReference } from "./lib/helpReference";
import { resendSink } from "./lib/resendSink";
import {
  HELP_TEST_RATE_LIMIT_SECRET,
  MAX_HELP_REQUEST_BODY_BYTES,
  MIN_HELP_FORM_COMPLETION_MS,
  RATE_LIMIT_ACCOUNT_PER_WINDOW,
  RATE_LIMIT_NETWORK_PER_WINDOW,
} from "./lib/helpConstants";
import {
  hashHelpAccountKey,
  hashHelpNetworkKey,
} from "./lib/helpThrottle";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");

function fullyVerifiedIdentity(overrides: Record<string, unknown> = {}) {
  return {
    subject: "clerk_user_help",
    issuer: "https://viable-eagle-73.clerk.accounts.dev",
    name: "Help User",
    email: "help@example.com",
    emailVerified: true,
    phoneNumber: "+15551234567",
    phoneNumberVerified: true,
    ageConfirmed: true,
    sid: "sess_help_1",
    ...overrides,
  };
}

function validTimingFields(overrides: Record<string, unknown> = {}) {
  const completedAtMs = Date.now();
  return {
    startedAtMs: completedAtMs - MIN_HELP_FORM_COMPLETION_MS - 500,
    completedAtMs,
    ...overrides,
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
    includeDiagnostics: true,
    context: {
      pagePath: "/help",
      browserSummary: "Chrome 120 on macOS",
      appVersion: "0.1.0",
    },
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
    context: {
      pagePath: "/help",
    },
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
  delete process.env.HELP_RATE_LIMIT_SECRET;
}

async function resetHelpThrottle(t: ReturnType<typeof convexTest>) {
  await t.mutation(internal.lib.helpThrottle.resetHelpThrottleForTests, {});
}

describe("Help intake HTTP (issue #19)", () => {
  const prevEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of [
      "DEPLOYMENT_KIND",
      "HELP_ALLOWED_ORIGIN",
      "HELP_SUPPORT_MAILBOX",
      "HELP_FROM_EMAIL",
      "HELP_EMAIL_MODE",
      "RESEND_API_KEY",
    ]) {
      prevEnv[key] = process.env[key];
    }
    applyHelpTestEnv();
    resendSink.reset();
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(prevEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resendSink.reset();
  });

  async function finishDelivery(t: ReturnType<typeof convexTest>) {
    // Scheduled functions use setTimeout(0); yield before waiting.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }

  it("accepts valid public support request, stores record, delivers mailbox + receipt to sink", async () => {
    const t = convexTest(schema, modules);
    const body = supportPayload();

    const response = await t.fetch("/help/intake", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify(body),
    });

    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      ok: boolean;
      reference: string;
      acceptedAtMs: number;
      lane: string;
    };
    expect(json.ok).toBe(true);
    expect(json.lane).toBe("support");
    expect(isOpaqueHelpReference(json.reference)).toBe(true);

    await finishDelivery(t);

    const stored = await t.run(async (ctx) => {
      return await ctx.db
        .query("helpIntake")
        .withIndex("by_reference", (q) => q.eq("reference", json.reference))
        .unique();
    });
    expect(stored).not.toBeNull();
    expect(stored!.replyEmail).toBe("submitter@example.test");
    expect(stored!.participantId).toBeUndefined();
    expect(stored!.mailboxDelivery.status).toBe("sent");
    expect(stored!.receiptDelivery.status).toBe("sent");

    expect(resendSink.emails).toHaveLength(2);
    const subjects = resendSink.emails.map((e) => e.subject);
    expect(subjects.some((s) => s.includes("[Support]"))).toBe(true);
    expect(subjects.some((s) => s.includes(json.reference))).toBe(true);
  });

  it("stores participantId from auth identity, not client-supplied id", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(fullyVerifiedIdentity());
    const { participantId } = await asUser.mutation(
      api.participants.ensureMyParticipant,
      {},
    );

    const fakeId = "jh7fakeparticipantid000000000000" as Id<"participants">;

    const response = await asUser.fetch("/help/intake", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify(
        supportPayload({ participantId: fakeId, idempotencyKey: "auth-key-1" }),
      ),
    });

    expect(response.status).toBe(200);
    const json = (await response.json()) as { reference: string };
    await finishDelivery(t);

    const stored = await t.run(async (ctx) => {
      return await ctx.db
        .query("helpIntake")
        .withIndex("by_reference", (q) => q.eq("reference", json.reference))
        .unique();
    });
    expect(stored!.participantId).toEqual(participantId);
    expect(stored!.participantId).not.toEqual(fakeId);
  });

  it("returns same reference on idempotent replay without duplicate emails", async () => {
    const t = convexTest(schema, modules);
    const body = supportPayload({ idempotencyKey: "idem-key-42" });

    const first = await t.fetch("/help/intake", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify(body),
    });
    const firstJson = (await first.json()) as { reference: string };
    await finishDelivery(t);
    expect(resendSink.emails).toHaveLength(2);

    resendSink.reset();

    const second = await t.fetch("/help/intake", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify(body),
    });
    const secondJson = (await second.json()) as { reference: string };
    await finishDelivery(t);

    expect(secondJson.reference).toBe(firstJson.reference);

    const count = await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("helpIntake")
        .withIndex("by_idempotencyKey", (q) =>
          q.eq("idempotencyKey", "idem-key-42"),
        )
        .collect();
      return rows.length;
    });
    expect(count).toBe(1);
    expect(resendSink.emails).toHaveLength(0);
  });

  it("returns 400 field errors for missing email, category, and message", async () => {
    const t = convexTest(schema, modules);
    const response = await t.fetch("/help/intake", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify({
        lane: "support",
        idempotencyKey: "bad-fields",
        ...validTimingFields(),
      }),
    });

    expect(response.status).toBe(400);
    const json = (await response.json()) as {
      ok: false;
      errors: Record<string, string>;
    };
    expect(json.ok).toBe(false);
    expect(json.errors.replyEmail).toBeTruthy();
    expect(json.errors.category).toBeTruthy();
    expect(json.errors.message).toBeTruthy();
  });

  it("returns 400 for invalid category", async () => {
    const t = convexTest(schema, modules);
    const response = await t.fetch("/help/intake", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify(
        supportPayload({
          category: "Not a real category",
          idempotencyKey: "bad-cat",
        }),
      ),
    });

    expect(response.status).toBe(400);
    const json = (await response.json()) as {
      ok: false;
      errors: Record<string, string>;
    };
    expect(json.errors.category).toMatch(/not a valid support category/i);
  });

  it("persists intake before delivery completes", async () => {
    const t = convexTest(schema, modules);
    const body = supportPayload({ idempotencyKey: "persist-before-delivery" });

    const response = await t.fetch("/help/intake", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(200);
    const json = (await response.json()) as { reference: string };

    const beforeDelivery = await t.run(async (ctx) => {
      return await ctx.db
        .query("helpIntake")
        .withIndex("by_reference", (q) => q.eq("reference", json.reference))
        .unique();
    });
    expect(beforeDelivery).not.toBeNull();
    expect(beforeDelivery!.mailboxDelivery.status).toBe("pending");

    await finishDelivery(t);

    const afterDelivery = await t.run(async (ctx) => {
      return await ctx.db.get("helpIntake", beforeDelivery!._id);
    });
    expect(afterDelivery!.mailboxDelivery.status).toBe("sent");
  });

  it("does not require RESEND_API_KEY in non-production", async () => {
    delete process.env.RESEND_API_KEY;
    process.env.DEPLOYMENT_KIND = "development";
    process.env.HELP_EMAIL_MODE = "double";

    const t = convexTest(schema, modules);
    const response = await t.fetch("/help/intake", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify(supportPayload({ idempotencyKey: "no-resend-key" })),
    });

    expect(response.status).toBe(200);
    await finishDelivery(t);
    expect(resendSink.emails.length).toBeGreaterThanOrEqual(2);
  });
});

describe("Help intake HTTP — Feedback lane (issue #20)", () => {
  const prevEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of [
      "DEPLOYMENT_KIND",
      "HELP_ALLOWED_ORIGIN",
      "HELP_SUPPORT_MAILBOX",
      "HELP_FROM_EMAIL",
      "HELP_EMAIL_MODE",
      "RESEND_API_KEY",
    ]) {
      prevEnv[key] = process.env[key];
    }
    applyHelpTestEnv();
    resendSink.reset();
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(prevEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resendSink.reset();
  });

  async function finishDelivery(t: ReturnType<typeof convexTest>) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }

  it("accepts valid public feedback, stores record, delivers mailbox only", async () => {
    const t = convexTest(schema, modules);
    const body = feedbackPayload({ idempotencyKey: "fb-public-1" });

    const response = await t.fetch("/help/intake", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify(body),
    });

    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      ok: boolean;
      reference: string;
      lane: string;
      contactable: boolean;
    };
    expect(json.ok).toBe(true);
    expect(json.lane).toBe("feedback");
    expect(json.contactable).toBe(false);
    expect(isOpaqueHelpReference(json.reference)).toBe(true);

    await finishDelivery(t);

    const stored = await t.run(async (ctx) => {
      return await ctx.db
        .query("helpIntake")
        .withIndex("by_reference", (q) => q.eq("reference", json.reference))
        .unique();
    });
    expect(stored).not.toBeNull();
    expect(stored!.lane).toBe("feedback");
    expect(stored!.sentiment).toBe("negative");
    expect(stored!.feedbackType).toBe("problem");
    expect(stored!.anonymous).toBe(false);
    expect(stored!.participantId).toBeUndefined();
    expect(stored!.replyEmail).toBeUndefined();
    expect(stored!.poolId).toBeUndefined();
    expect(stored!.mailboxDelivery.status).toBe("sent");
    expect(stored!.receiptDelivery.status).toBe("skipped");

    expect(resendSink.emails).toHaveLength(1);
    expect(resendSink.emails[0]!.subject).toMatch(
      /^\[Feedback\] problem · negative · /,
    );
    expect(resendSink.emails[0]!.subject).toContain(json.reference);
  });

  it("accepts identified signed-in feedback with optional contact email and receipt", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(fullyVerifiedIdentity());
    const { participantId } = await asUser.mutation(
      api.participants.ensureMyParticipant,
      {},
    );

    const response = await asUser.fetch("/help/intake", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify(
        feedbackPayload({
          idempotencyKey: "fb-identified-1",
          sentiment: "positive",
          feedbackType: "liked",
          replyEmail: "followup@example.test",
        }),
      ),
    });

    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      reference: string;
      contactable: boolean;
    };
    expect(json.contactable).toBe(true);
    await finishDelivery(t);

    const stored = await t.run(async (ctx) => {
      return await ctx.db
        .query("helpIntake")
        .withIndex("by_reference", (q) => q.eq("reference", json.reference))
        .unique();
    });
    expect(stored!.participantId).toEqual(participantId);
    expect(stored!.replyEmail).toBe("followup@example.test");
    expect(stored!.anonymous).toBe(false);
    expect(stored!.mailboxDelivery.status).toBe("sent");
    expect(stored!.receiptDelivery.status).toBe("sent");

    expect(resendSink.emails).toHaveLength(2);
    const mailbox = resendSink.emails.find((e) =>
      e.subject.startsWith("[Feedback]"),
    );
    expect(mailbox?.replyTo).toBe("followup@example.test");
    const receipt = resendSink.emails.find((e) =>
      e.subject.startsWith("Only Pools Feedback"),
    );
    expect(receipt?.text).toMatch(/does not guarantee a personal reply/i);
    expect(receipt?.text).not.toMatch(/respond within 2 business days/i);
  });

  it("accepts anonymous signed-in feedback without identity, email, or receipt", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(fullyVerifiedIdentity());
    await asUser.mutation(api.participants.ensureMyParticipant, {});

    const fakeId = "jh7fakeparticipantid000000000000" as Id<"participants">;

    const response = await asUser.fetch("/help/intake", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify(
        feedbackPayload({
          idempotencyKey: "fb-anon-1",
          anonymous: true,
          replyEmail: "ignored@example.test",
          participantId: fakeId,
        }),
      ),
    });

    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      reference: string;
      contactable: boolean;
    };
    expect(json.contactable).toBe(false);
    await finishDelivery(t);

    const stored = await t.run(async (ctx) => {
      return await ctx.db
        .query("helpIntake")
        .withIndex("by_reference", (q) => q.eq("reference", json.reference))
        .unique();
    });
    expect(stored!.anonymous).toBe(true);
    expect(stored!.participantId).toBeUndefined();
    expect(stored!.replyEmail).toBeUndefined();
    expect(stored!.poolId).toBeUndefined();
    expect(stored!.receiptDelivery.status).toBe("skipped");
    expect(resendSink.emails).toHaveLength(1);
    expect(resendSink.emails[0]!.text).toContain("Anonymous");
  });

  it("returns same reference on idempotent feedback replay without duplicate emails", async () => {
    const t = convexTest(schema, modules);
    const body = feedbackPayload({ idempotencyKey: "fb-idem-42" });

    const first = await t.fetch("/help/intake", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify(body),
    });
    const firstJson = (await first.json()) as { reference: string };
    await finishDelivery(t);
    expect(resendSink.emails).toHaveLength(1);

    resendSink.reset();

    const second = await t.fetch("/help/intake", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify(body),
    });
    const secondJson = (await second.json()) as { reference: string };
    await finishDelivery(t);

    expect(secondJson.reference).toBe(firstJson.reference);
    expect(resendSink.emails).toHaveLength(0);
  });

  it("returns 400 when required feedback fields are missing", async () => {
    const t = convexTest(schema, modules);
    const response = await t.fetch("/help/intake", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify({
        lane: "feedback",
        idempotencyKey: "fb-bad-fields",
        ...validTimingFields(),
      }),
    });

    expect(response.status).toBe(400);
    const json = (await response.json()) as {
      ok: false;
      errors: Record<string, string>;
    };
    expect(json.errors.sentiment).toBeTruthy();
    expect(json.errors.feedbackType).toBeTruthy();
  });

  it("returns 400 for invalid feedback sentiment and type", async () => {
    const t = convexTest(schema, modules);
    const response = await t.fetch("/help/intake", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify(
        feedbackPayload({
          idempotencyKey: "fb-bad-values",
          sentiment: "angry",
          feedbackType: "complaint",
        }),
      ),
    });

    expect(response.status).toBe(400);
    const json = (await response.json()) as {
      ok: false;
      errors: Record<string, string>;
    };
    expect(json.errors.sentiment).toMatch(/not a valid feedback sentiment/i);
    expect(json.errors.feedbackType).toMatch(/not a valid feedback type/i);
  });

  it("allows optional message and validates optional reply email", async () => {
    const t = convexTest(schema, modules);

    const noMessage = await t.fetch("/help/intake", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify(
        feedbackPayload({
          idempotencyKey: "fb-no-message",
          message: "",
        }),
      ),
    });
    expect(noMessage.status).toBe(200);

    const badEmail = await t.fetch("/help/intake", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify(
        feedbackPayload({
          idempotencyKey: "fb-bad-email",
          replyEmail: "not-an-email",
        }),
      ),
    });
    expect(badEmail.status).toBe(400);
    const badJson = (await badEmail.json()) as {
      errors: Record<string, string>;
    };
    expect(badJson.errors.replyEmail).toMatch(/valid email/i);
  });

  it("does not attach another participant id from client payload", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(fullyVerifiedIdentity());
    const { participantId } = await asUser.mutation(
      api.participants.ensureMyParticipant,
      {},
    );
    const fakeId = "jh7fakeparticipantid000000000000" as Id<"participants">;

    const response = await asUser.fetch("/help/intake", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify(
        feedbackPayload({
          idempotencyKey: "fb-auth-key",
          participantId: fakeId,
          replyEmail: "real@example.test",
        }),
      ),
    });

    expect(response.status).toBe(200);
    const json = (await response.json()) as { reference: string };
    await finishDelivery(t);

    const stored = await t.run(async (ctx) => {
      return await ctx.db
        .query("helpIntake")
        .withIndex("by_reference", (q) => q.eq("reference", json.reference))
        .unique();
    });
    expect(stored!.participantId).toEqual(participantId);
    expect(stored!.participantId).not.toEqual(fakeId);
  });
});

async function seedSeasonForHelp(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const seasonId = await ctx.db.insert("poolSeasons", {
      label: "2025",
      year: 2025,
      status: "available",
      usableStartWeek: 1,
      bootstrappedAtMs: Date.now(),
    });
    const homeId = await ctx.db.insert("nflTeams", {
      stableKey: "nfl:kc",
      name: "Kansas City Chiefs",
      abbreviation: "KC",
      sportsDbTeamId: "134934",
    });
    const awayId = await ctx.db.insert("nflTeams", {
      stableKey: "nfl:buf",
      name: "Buffalo Bills",
      abbreviation: "BUF",
      sportsDbTeamId: "134918",
    });
    const now = Date.now();
    await ctx.db.insert("nflGames", {
      stableKey: "nfl:2025:w1:buf@kc",
      seasonId,
      seasonLabel: "2025",
      week: 1,
      homeTeamId: homeId,
      awayTeamId: awayId,
      scheduledKickoffMs: now + 7 * 24 * 60 * 60 * 1000,
      lifecycle: "scheduled",
      homeScore: null,
      awayScore: null,
      sportsDbEventId: "evt_w1",
    });
    await ctx.db.insert("nflGames", {
      stableKey: "nfl:2025:w2:buf@kc",
      seasonId,
      seasonLabel: "2025",
      week: 2,
      homeTeamId: homeId,
      awayTeamId: awayId,
      scheduledKickoffMs: now + 14 * 24 * 60 * 60 * 1000,
      lifecycle: "scheduled",
      homeScore: null,
      awayScore: null,
      sportsDbEventId: "evt_w2",
    });
  });
}

async function createOwnedPoolForHelp(t: ReturnType<typeof convexTest>) {
  await seedSeasonForHelp(t);
  const asUser = t.withIdentity(fullyVerifiedIdentity());
  await asUser.mutation(api.participants.ensureMyParticipant, {});
  const created = await asUser.mutation(api.pools.createPool, {
    name: "Help Pool",
    type: "survivor",
    startWeek: 1,
    pickLockMode: "gameKickoff",
  });
  return { asUser, poolId: created.poolId };
}

describe("Help intake HTTP — diagnostic context (issue #21)", () => {
  const prevEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of [
      "DEPLOYMENT_KIND",
      "HELP_ALLOWED_ORIGIN",
      "HELP_SUPPORT_MAILBOX",
      "HELP_FROM_EMAIL",
      "HELP_EMAIL_MODE",
      "RESEND_API_KEY",
    ]) {
      prevEnv[key] = process.env[key];
    }
    applyHelpTestEnv();
    resendSink.reset();
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(prevEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resendSink.reset();
  });

  async function finishDelivery(t: ReturnType<typeof convexTest>) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }

  it("stores optional diagnostics when includeDiagnostics is true", async () => {
    const t = convexTest(schema, modules);
    const response = await t.fetch("/help/intake", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify(
        supportPayload({
          idempotencyKey: "ctx-diag-on",
          includeDiagnostics: true,
          context: {
            pagePath: "/help?source=board",
            browserSummary: "Chrome on macOS",
            appVersion: "0.1.0",
          },
        }),
      ),
    });
    expect(response.status).toBe(200);
    const json = (await response.json()) as { reference: string };
    await finishDelivery(t);

    const stored = await t.run(async (ctx) => {
      return await ctx.db
        .query("helpIntake")
        .withIndex("by_reference", (q) => q.eq("reference", json.reference))
        .unique();
    });
    expect(stored!.includeDiagnostics).toBe(true);
    const context = JSON.parse(stored!.contextJson!) as Record<string, string>;
    expect(context.pagePath).toBe("/help?source=board");
    expect(context.browserSummary).toBe("Chrome on macOS");
    expect(context.appVersion).toBe("0.1.0");
  });

  it("excludes optional diagnostics when includeDiagnostics is false", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(fullyVerifiedIdentity());
    const { participantId } = await asUser.mutation(
      api.participants.ensureMyParticipant,
      {},
    );

    const response = await asUser.fetch("/help/intake", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify(
        supportPayload({
          idempotencyKey: "ctx-diag-off",
          includeDiagnostics: false,
          context: {
            pagePath: "/help",
            browserSummary: "Should not store",
            appVersion: "9.9.9",
          },
        }),
      ),
    });
    expect(response.status).toBe(200);
    const json = (await response.json()) as { reference: string };
    await finishDelivery(t);

    const stored = await t.run(async (ctx) => {
      return await ctx.db
        .query("helpIntake")
        .withIndex("by_reference", (q) => q.eq("reference", json.reference))
        .unique();
    });
    expect(stored!.includeDiagnostics).toBe(false);
    const context = JSON.parse(stored!.contextJson!) as Record<string, string>;
    expect(context.pagePath).toBeUndefined();
    expect(context.browserSummary).toBeUndefined();
    expect(context.accountId).toBe(participantId);
  });

  it("enriches signed-in support from server identity, not client payload", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(fullyVerifiedIdentity());
    const { participantId } = await asUser.mutation(
      api.participants.ensureMyParticipant,
      {},
    );
    const fakeId = "jh7fakeparticipantid000000000000" as Id<"participants">;

    const response = await asUser.fetch("/help/intake", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify(
        supportPayload({
          idempotencyKey: "ctx-enrich-support",
          includeDiagnostics: false,
          participantId: fakeId,
        }),
      ),
    });
    expect(response.status).toBe(200);
    const json = (await response.json()) as { reference: string };
    await finishDelivery(t);

    const stored = await t.run(async (ctx) => {
      return await ctx.db
        .query("helpIntake")
        .withIndex("by_reference", (q) => q.eq("reference", json.reference))
        .unique();
    });
    expect(stored!.participantId).toEqual(participantId);
    expect(stored!.participantId).not.toEqual(fakeId);
    const context = JSON.parse(stored!.contextJson!) as Record<string, string>;
    expect(context.accountId).toBe(participantId);
    expect(context.email).toBe("help@example.com");
  });

  it("rejects forged sensitive context keys", async () => {
    const t = convexTest(schema, modules);
    const response = await t.fetch("/help/intake", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify(
        feedbackPayload({
          idempotencyKey: "ctx-forged-sensitive",
          context: {
            pagePath: "/help",
            hiddenPick: "KC",
          },
        }),
      ),
    });
    expect(response.status).toBe(400);
    const json = (await response.json()) as {
      ok: false;
      errors: Record<string, string>;
    };
    expect(json.errors.context).toMatch(/unsupported field|forbidden field/i);
  });

  it("minimizes anonymous feedback context regardless of client payload", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(fullyVerifiedIdentity());
    await asUser.mutation(api.participants.ensureMyParticipant, {});
    const { poolId } = await createOwnedPoolForHelp(t);

    const response = await asUser.fetch("/help/intake", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify(
        feedbackPayload({
          idempotencyKey: "ctx-anon-min",
          anonymous: true,
          includeDiagnostics: true,
          context: {
            pagePath: "/help",
            browserSummary: "Chrome on macOS",
            appVersion: "0.1.0",
          },
          poolIdHint: poolId,
          participantId: "jh7fakeparticipantid000000000000",
          replyEmail: "ignored@example.test",
        }),
      ),
    });
    expect(response.status).toBe(200);
    const json = (await response.json()) as { reference: string };
    await finishDelivery(t);

    const stored = await t.run(async (ctx) => {
      return await ctx.db
        .query("helpIntake")
        .withIndex("by_reference", (q) => q.eq("reference", json.reference))
        .unique();
    });
    expect(stored!.anonymous).toBe(true);
    expect(stored!.participantId).toBeUndefined();
    expect(stored!.poolId).toBeUndefined();
    const context = JSON.parse(stored!.contextJson!) as Record<string, string>;
    expect(context.accountId).toBeUndefined();
    expect(context.email).toBeUndefined();
    expect(context.poolId).toBeUndefined();
    expect(context.pagePath).toBe("/help");
  });

  it("attaches poolId only when authenticated and membership is verified", async () => {
    const t = convexTest(schema, modules);
    const { asUser, poolId } = await createOwnedPoolForHelp(t);
    const { participantId } = await asUser.mutation(
      api.participants.ensureMyParticipant,
      {},
    );

    const response = await asUser.fetch("/help/intake", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify(
        supportPayload({
          idempotencyKey: "ctx-pool-member",
          includeDiagnostics: false,
          poolIdHint: poolId,
        }),
      ),
    });
    expect(response.status).toBe(200);
    const json = (await response.json()) as { reference: string };
    await finishDelivery(t);

    const stored = await t.run(async (ctx) => {
      return await ctx.db
        .query("helpIntake")
        .withIndex("by_reference", (q) => q.eq("reference", json.reference))
        .unique();
    });
    expect(stored!.poolId).toEqual(poolId);
    expect(stored!.participantId).toEqual(participantId);
    const context = JSON.parse(stored!.contextJson!) as Record<string, string>;
    expect(context.poolId).toBe(poolId);
    expect(context.accountId).toBe(participantId);
  });

  it("ignores forged poolId when submitter is not a member", async () => {
    const t = convexTest(schema, modules);
    const { poolId } = await createOwnedPoolForHelp(t);
    const asUser = t.withIdentity(
      fullyVerifiedIdentity({ subject: "clerk_user_other" }),
    );
    await asUser.mutation(api.participants.ensureMyParticipant, {});

    const response = await asUser.fetch("/help/intake", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify(
        supportPayload({
          idempotencyKey: "ctx-pool-forged",
          includeDiagnostics: false,
          poolIdHint: poolId,
        }),
      ),
    });
    expect(response.status).toBe(200);
    const json = (await response.json()) as { reference: string };
    await finishDelivery(t);

    const stored = await t.run(async (ctx) => {
      return await ctx.db
        .query("helpIntake")
        .withIndex("by_reference", (q) => q.eq("reference", json.reference))
        .unique();
    });
    expect(stored!.poolId).toBeUndefined();
    const context = stored!.contextJson
      ? (JSON.parse(stored!.contextJson) as Record<string, string>)
      : {};
    expect(context.poolId).toBeUndefined();
  });
});

describe("Help intake HTTP — security & abuse (issue #22)", () => {
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
      "HELP_RATE_LIMIT_SECRET",
    ]) {
      prevEnv[key] = process.env[key];
    }
    applyHelpTestEnv();
    resendSink.reset();
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(prevEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resendSink.reset();
  });

  async function finishDelivery(t: ReturnType<typeof convexTest>) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }

  async function postIntake(
    t: ReturnType<typeof convexTest>,
    body: Record<string, unknown>,
    headers: Record<string, string> = {
      "Content-Type": "application/json",
      Origin: "http://localhost:3000",
    },
  ) {
    await resetHelpThrottle(t);
    return await t.fetch("/help/intake", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  }

  it("allows configured origin and rejects disallowed cross-origin requests", async () => {
    const t = convexTest(schema, modules);

    const allowed = await postIntake(t, supportPayload({ idempotencyKey: "cors-ok" }));
    expect(allowed.status).toBe(200);

    const rejected = await postIntake(
      t,
      supportPayload({ idempotencyKey: "cors-bad" }),
      {
        "Content-Type": "application/json",
        Origin: "https://evil.example",
      },
    );
    expect(rejected.status).toBe(403);

    const preflight = await t.fetch("/help/intake", {
      method: "OPTIONS",
      headers: { Origin: "https://evil.example" },
    });
    expect(preflight.status).toBe(403);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBeNull();

    const validPreflight = await t.fetch("/help/intake", {
      method: "OPTIONS",
      headers: { Origin: "http://localhost:3000" },
    });
    expect(validPreflight.status).toBe(204);
    expect(validPreflight.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:3000",
    );
  });

  it("allows requests without Origin header for same-origin test harness", async () => {
    const t = convexTest(schema, modules);
    const response = await postIntake(
      t,
      supportPayload({ idempotencyKey: "no-origin" }),
      { "Content-Type": "application/json" },
    );
    expect(response.status).toBe(200);
  });

  it("rejects honeypot submissions for support and feedback", async () => {
    const t = convexTest(schema, modules);

    const support = await postIntake(
      t,
      supportPayload({ idempotencyKey: "hp-support", honeypot: "bot" }),
    );
    expect(support.status).toBe(400);
    const supportJson = (await support.json()) as {
      errors: Record<string, string>;
    };
    expect(supportJson.errors.honeypot).toBeTruthy();

    const feedback = await postIntake(
      t,
      feedbackPayload({ idempotencyKey: "hp-feedback", honeypot: "spam" }),
    );
    expect(feedback.status).toBe(400);
    const feedbackJson = (await feedback.json()) as {
      errors: Record<string, string>;
    };
    expect(feedbackJson.errors.honeypot).toBeTruthy();
  });

  it("rejects missing or too-fast timing without echoing sensitive content", async () => {
    const t = convexTest(schema, modules);

    const missingPayload = supportPayload({ idempotencyKey: "timing-missing" });
    delete (missingPayload as Record<string, unknown>).startedAtMs;
    const missing = await postIntake(t, missingPayload);
    expect(missing.status).toBe(400);
    const missingJson = (await missing.json()) as {
      errors: Record<string, string>;
    };
    expect(missingJson.errors.form).toMatch(/take a moment/i);
    expect(JSON.stringify(missingJson)).not.toContain("hunter2");

    const completedAtMs = Date.now();
    const tooFast = await postIntake(t, {
      ...supportPayload({ idempotencyKey: "timing-fast" }),
      startedAtMs: completedAtMs - 100,
      completedAtMs,
    });
    expect(tooFast.status).toBe(400);
    const fastJson = (await tooFast.json()) as { errors: Record<string, string> };
    expect(fastJson.errors.form).toMatch(/take a moment/i);
  });

  it("rejects oversized bodies via Content-Length and actual payload size", async () => {
    const t = convexTest(schema, modules);

    const viaHeader = await t.fetch("/help/intake", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
        "Content-Length": String(MAX_HELP_REQUEST_BODY_BYTES + 1),
      },
      body: JSON.stringify(supportPayload({ idempotencyKey: "size-header" })),
    });
    expect(viaHeader.status).toBe(413);

    const hugeMessage = "x".repeat(MAX_HELP_REQUEST_BODY_BYTES);
    const viaBody = await postIntake(
      t,
      supportPayload({
        idempotencyKey: "size-body",
        message: hugeMessage,
      }),
      {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
    );
    expect(viaBody.status).toBe(413);
  });

  it("rejects sensitive disclosures before persistence or email delivery", async () => {
    const t = convexTest(schema, modules);
    const secretMessage = "my password is hunter2 unique-secret-xyz";

    const response = await postIntake(
      t,
      supportPayload({
        idempotencyKey: "secret-reject",
        message: secretMessage,
      }),
    );
    expect(response.status).toBe(400);
    const json = (await response.json()) as { errors: Record<string, string> };
    expect(json.errors.message).toMatch(/passwords or secret credentials/i);
    expect(JSON.stringify(json)).not.toContain("hunter2");
    expect(JSON.stringify(json)).not.toContain("unique-secret-xyz");

    const count = await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("helpIntake")
        .withIndex("by_idempotencyKey", (q) =>
          q.eq("idempotencyKey", "secret-reject"),
        )
        .collect();
      return rows.length;
    });
    expect(count).toBe(0);
    expect(resendSink.emails).toHaveLength(0);
  });

  it("rate-limits burst traffic with a generic retry message", async () => {
    const t = convexTest(schema, modules);
    await resetHelpThrottle(t);

    for (let i = 0; i < RATE_LIMIT_NETWORK_PER_WINDOW; i++) {
      const response = await t.fetch("/help/intake", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:3000",
          "x-forwarded-for": "203.0.113.50",
        },
        body: JSON.stringify(
          supportPayload({ idempotencyKey: `burst-${i}` }),
        ),
      });
      expect(response.status).toBe(200);
    }

    const limited = await t.fetch("/help/intake", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
        "x-forwarded-for": "203.0.113.50",
      },
      body: JSON.stringify(
        supportPayload({ idempotencyKey: "burst-over" }),
      ),
    });
    expect(limited.status).toBe(429);
    const limitedJson = (await limited.json()) as {
      ok: false;
      error: string;
    };
    expect(limitedJson.error).toBe("Please try again later.");
    expect(JSON.stringify(limitedJson)).not.toMatch(/30|limit|threshold/i);
  });

  it("uses separate account and network throttle keys", async () => {
    const t = convexTest(schema, modules);
    await resetHelpThrottle(t);

    const networkIp = "198.51.100.10";
    const networkHash = await hashHelpNetworkKey(
      HELP_TEST_RATE_LIMIT_SECRET,
      networkIp,
    );

    const asUser = t.withIdentity(fullyVerifiedIdentity());
    const { participantId } = await asUser.mutation(
      api.participants.ensureMyParticipant,
      {},
    );
    const accountHash = await hashHelpAccountKey(
      HELP_TEST_RATE_LIMIT_SECRET,
      participantId,
    );

    for (let i = 0; i < RATE_LIMIT_ACCOUNT_PER_WINDOW; i++) {
      const response = await asUser.fetch("/help/intake", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:3000",
          "x-forwarded-for": networkIp,
        },
        body: JSON.stringify(
          supportPayload({ idempotencyKey: `acct-${i}` }),
        ),
      });
      expect(response.status).toBe(200);
    }

    const accountLimited = await asUser.fetch("/help/intake", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
        "x-forwarded-for": networkIp,
      },
      body: JSON.stringify(
        supportPayload({ idempotencyKey: "acct-over" }),
      ),
    });
    expect(accountLimited.status).toBe(429);

    const otherNetworkOk = await t.fetch("/help/intake", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
        "x-forwarded-for": "198.51.100.99",
      },
      body: JSON.stringify(
        supportPayload({ idempotencyKey: "other-network" }),
      ),
    });
    expect(otherNetworkOk.status).toBe(200);

    const accountRow = await t.run(async (ctx) => {
      return await ctx.db
        .query("helpThrottle")
        .withIndex("by_keyHash", (q) => q.eq("keyHash", accountHash))
        .unique();
    });
    const networkRow = await t.run(async (ctx) => {
      return await ctx.db
        .query("helpThrottle")
        .withIndex("by_keyHash", (q) => q.eq("keyHash", networkHash))
        .unique();
    });
    expect(accountRow?.keyKind).toBe("account");
    expect(networkRow?.keyKind).toBe("network");
    expect(accountRow?.keyHash).not.toBe(networkRow?.keyHash);
  });

  it("ignores expired throttle records after 24 hours", async () => {
    const t = convexTest(schema, modules);
    await resetHelpThrottle(t);

    const networkIp = "203.0.113.77";
    const networkHash = await hashHelpNetworkKey(
      HELP_TEST_RATE_LIMIT_SECRET,
      networkIp,
    );
    const nowMs = Date.now();

    await t.run(async (ctx) => {
      await ctx.db.insert("helpThrottle", {
        keyHash: networkHash,
        keyKind: "network",
        windowStartMs: nowMs - 25 * 60 * 60 * 1000,
        count: RATE_LIMIT_NETWORK_PER_WINDOW,
        expiresAtMs: nowMs - 1000,
      });
    });

    const response = await t.fetch("/help/intake", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
        "x-forwarded-for": networkIp,
      },
      body: JSON.stringify(
        supportPayload({ idempotencyKey: "expired-window" }),
      ),
    });
    expect(response.status).toBe(200);

    const row = await t.run(async (ctx) => {
      return await ctx.db
        .query("helpThrottle")
        .withIndex("by_keyHash", (q) => q.eq("keyHash", networkHash))
        .unique();
    });
    expect(row!.count).toBe(1);
    expect(row!.expiresAtMs).toBeGreaterThan(nowMs);
  });

  it("never stores raw network addresses in intake or throttle records", async () => {
    const t = convexTest(schema, modules);
    const rawIp = "203.0.113.44";

    const response = await postIntake(
      t,
      supportPayload({ idempotencyKey: "raw-ip-absence" }),
      {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
        "x-forwarded-for": rawIp,
        "x-real-ip": rawIp,
      },
    );
    expect(response.status).toBe(200);
    const json = (await response.json()) as { reference: string };
    await finishDelivery(t);

    const stored = await t.run(async (ctx) => {
      return await ctx.db
        .query("helpIntake")
        .withIndex("by_reference", (q) => q.eq("reference", json.reference))
        .unique();
    });
    const intakeBlob = JSON.stringify(stored);
    expect(intakeBlob).not.toContain(rawIp);

    const throttleRows = await t.run(async (ctx) => {
      return await ctx.db.query("helpThrottle").take(20);
    });
    const throttleBlob = JSON.stringify(throttleRows);
    expect(throttleBlob).not.toContain(rawIp);
    for (const row of throttleRows) {
      expect(row.keyHash).not.toBe(rawIp);
    }

    expect(resendSink.emails.length).toBeGreaterThan(0);
    for (const email of resendSink.emails) {
      expect(email.text).not.toContain(rawIp);
      expect(email.html ?? "").not.toContain(rawIp);
    }
  });

  it("fails closed in production without hash secret", async () => {
    process.env.DEPLOYMENT_KIND = "production";
    process.env.HELP_SUPPORT_MAILBOX = "support@example.test";
    process.env.HELP_FROM_EMAIL = "Only Pools <noreply@example.test>";
    process.env.RESEND_API_KEY = "re_test_key";
    delete process.env.HELP_EMAIL_MODE;
    delete process.env.HELP_NETWORK_HASH_SECRET;

    const t = convexTest(schema, modules);
    const response = await t.fetch("/help/intake", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify(supportPayload({ idempotencyKey: "prod-no-secret" })),
    });
    expect(response.status).toBe(503);
    const json = (await response.json()) as { ok: false; error: string };
    expect(json.error).toMatch(/HELP_NETWORK_HASH_SECRET/i);
  });
});
