/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "./_generated/api";
import schema from "./schema";

const clerk = vi.hoisted(() => ({
  getSession: vi.fn(),
  getToken: vi.fn(),
}));

vi.mock("@clerk/backend", () => ({
  createClerkClient: () => ({ sessions: clerk }),
}));

const modules = import.meta.glob("./**/*.ts");
const NOW_MS = Date.UTC(2026, 8, 14, 20);

function identity(
  subject: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    subject,
    issuer: "https://auth.example.test",
    tokenIdentifier: `https://auth.example.test|${subject}`,
    name: subject,
    email: `${subject}@example.test`,
    emailVerified: true,
    phoneNumber: "+15551234567",
    phoneNumberVerified: true,
    sid: `session_${subject}`,
    ...overrides,
  };
}

function sessionToken(payload: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "RS256", typ: "JWT" })}.${encode(payload)}.signature`;
}

function activeSession(
  overrides: Record<string, unknown> = {},
) {
  return {
    id: "session_operator",
    userId: "operator",
    status: "active",
    expireAt: NOW_MS + 60 * 60 * 1_000,
    ...overrides,
  };
}

describe("Production Operator Clerk reverification", () => {
  const previousOperator =
    process.env.PRODUCTION_OPERATOR_CLERK_USER_ID;
  const previousSecret = process.env.CLERK_SECRET_KEY;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
    vi.clearAllMocks();
    process.env.PRODUCTION_OPERATOR_CLERK_USER_ID = "operator";
    process.env.CLERK_SECRET_KEY = "sk_test_operator_step_up";
    clerk.getSession.mockResolvedValue(activeSession());
    clerk.getToken.mockResolvedValue({
      jwt: sessionToken({
        sub: "operator",
        sid: "session_operator",
        fva: [0, 0],
      }),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    if (previousOperator === undefined) {
      delete process.env.PRODUCTION_OPERATOR_CLERK_USER_ID;
    } else {
      process.env.PRODUCTION_OPERATOR_CLERK_USER_ID = previousOperator;
    }
    if (previousSecret === undefined) {
      delete process.env.CLERK_SECRET_KEY;
    } else {
      process.env.CLERK_SECRET_KEY = previousSecret;
    }
  });

  it("denies nonoperators before calling Clerk", async () => {
    const t = convexTest(schema, modules);
    const asOwner = t.withIdentity(identity("owner"));
    await asOwner.mutation(api.participants.ensureMyParticipant, {});
    await expect(
      asOwner.action(
        api.operatorStepUp.verifyProductionOperatorStepUp,
        {},
      ),
    ).rejects.toThrow(/Production Operator required/);
    expect(clerk.getSession).not.toHaveBeenCalled();
  });

  it("fails closed when sid or the Clerk secret is absent", async () => {
    const t = convexTest(schema, modules);
    const withoutSid = t.withIdentity(
      identity("operator", { sid: undefined }),
    );
    await withoutSid.mutation(api.participants.ensureMyParticipant, {});
    await expect(
      withoutSid.action(
        api.operatorStepUp.verifyProductionOperatorStepUp,
        {},
      ),
    ).rejects.toThrow(/session/i);

    delete process.env.CLERK_SECRET_KEY;
    const asOperator = t.withIdentity(identity("operator"));
    await expect(
      asOperator.action(
        api.operatorStepUp.verifyProductionOperatorStepUp,
        {},
      ),
    ).rejects.toThrow(/unavailable|configuration/i);
  });

  it.each([
    ["inactive session", activeSession({ status: "revoked" })],
    ["wrong session id", activeSession({ id: "session_other" })],
    ["wrong user", activeSession({ userId: "someone_else" })],
    [
      "expired session",
      activeSession({ expireAt: NOW_MS - 1 }),
    ],
  ])("rejects a %s", async (_label, session) => {
    clerk.getSession.mockResolvedValue(session);
    const t = convexTest(schema, modules);
    const asOperator = t.withIdentity(identity("operator"));
    await asOperator.mutation(api.participants.ensureMyParticipant, {});
    await expect(
      asOperator.action(
        api.operatorStepUp.verifyProductionOperatorStepUp,
        {},
      ),
    ).rejects.toThrow(/session/i);
  });

  it.each([
    ["missing factor ages", { sub: "operator", sid: "session_operator" }],
    [
      "mismatched token session",
      { sub: "operator", sid: "session_other", fva: [0, 0] },
    ],
    [
      "mismatched token user",
      { sub: "someone_else", sid: "session_operator", fva: [0, 0] },
    ],
    [
      "stale first factor",
      { sub: "operator", sid: "session_operator", fva: [10, 0] },
    ],
    [
      "stale second factor",
      { sub: "operator", sid: "session_operator", fva: [0, 10] },
    ],
    [
      "invalid factor ages",
      { sub: "operator", sid: "session_operator", fva: ["0", 0] },
    ],
  ])("returns Clerk strict_mfa reverification for %s", async (_label, payload) => {
    clerk.getToken.mockResolvedValue({ jwt: sessionToken(payload) });
    const t = convexTest(schema, modules);
    const asOperator = t.withIdentity(identity("operator"));
    await asOperator.mutation(api.participants.ensureMyParticipant, {});
    const result = await asOperator.action(
      api.operatorStepUp.verifyProductionOperatorStepUp,
      {},
    );
    expect(result).toEqual({
      clerk_error: {
        type: "forbidden",
        reason: "reverification-error",
        metadata: { reverification: "strict_mfa" },
      },
    });
    const participant = await t.run(async (ctx) =>
      ctx.db
        .query("participants")
        .withIndex("by_clerkUserId", (q) =>
          q.eq("clerkUserId", "operator"),
        )
        .unique(),
    );
    expect(participant?.operatorStepUpVerifiedAtMs).toBeUndefined();
  });

  it("writes a fresh marker bound to the verified Clerk session", async () => {
    const t = convexTest(schema, modules);
    const asOperator = t.withIdentity(identity("operator"));
    await asOperator.mutation(api.participants.ensureMyParticipant, {});
    const result = await asOperator.action(
      api.operatorStepUp.verifyProductionOperatorStepUp,
      {},
    );
    expect(result).toEqual({
      operatorStepUpVerifiedAtMs: NOW_MS,
      sessionId: "session_operator",
      expiresAtMs: NOW_MS + 5 * 60 * 1_000,
    });
    const participant = await t.run(async (ctx) =>
      ctx.db
        .query("participants")
        .withIndex("by_clerkUserId", (q) =>
          q.eq("clerkUserId", "operator"),
        )
        .unique(),
    );
    expect(participant).toMatchObject({
      operatorStepUpVerifiedAtMs: NOW_MS,
      operatorStepUpSessionId: "session_operator",
    });
  });
});
