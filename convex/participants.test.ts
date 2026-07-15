/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function fullyVerifiedIdentity(overrides: Record<string, unknown> = {}) {
  return {
    subject: "clerk_user_1",
    issuer: "https://viable-eagle-73.clerk.accounts.dev",
    name: "Alex Adult",
    email: "alex@example.com",
    emailVerified: true,
    phoneNumber: "+15551234567",
    phoneNumberVerified: true,
    ageConfirmed: true,
    sid: "sess_alex_1",
    ...overrides,
  };
}

describe("deny-by-default authz (acceptance scenario 36)", () => {
  it("returns null privileged data when unauthenticated", async () => {
    const t = convexTest(schema, modules);
    const result = await t.query(api.participants.privilegedParticipantSnapshot, {
      role: "owner",
    });
    expect(result).toBeNull();
  });

  it("throws on privileged mutation when unauthenticated even if role is supplied", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.participants.privilegedNoop, {
        role: "owner",
      }),
    ).rejects.toThrow(/Unauthenticated/);
  });

  it("ignores client-supplied participantId and role; only auth identity grants access", async () => {
    const t = convexTest(schema, modules);
    const asAlex = t.withIdentity(fullyVerifiedIdentity());
    const { participantId } = await asAlex.mutation(
      api.participants.ensureMyParticipant,
      {},
    );

    // Impersonate a different identity and try to use Alex's id + owner role.
    const asIntruder = t.withIdentity(
      fullyVerifiedIdentity({
        subject: "clerk_intruder",
        email: "intruder@example.com",
        name: "Intruder",
      }),
    );
    await asIntruder.mutation(api.participants.ensureMyParticipant, {});

    const snapshot = await asIntruder.query(
      api.participants.privilegedParticipantSnapshot,
      {
        participantId,
        role: "owner",
      },
    );

    expect(snapshot).not.toBeNull();
    expect(snapshot!.participantId).not.toEqual(participantId);
    expect(snapshot!.displayName).toBe("Intruder");
  });

  it("refuses queries when Participant is not yet established", async () => {
    const t = convexTest(schema, modules);
    const asAlex = t.withIdentity(fullyVerifiedIdentity());
    // Authenticated but never called ensureMyParticipant
    const result = await asAlex.query(
      api.participants.privilegedParticipantSnapshot,
      {},
    );
    expect(result).toBeNull();
  });

  it("refuses ensure when dual verification is incomplete", async () => {
    const t = convexTest(schema, modules);
    const incomplete = t.withIdentity(
      fullyVerifiedIdentity({ phoneNumberVerified: false }),
    );
    await expect(
      incomplete.mutation(api.participants.ensureMyParticipant, {}),
    ).rejects.toThrow(/Verification incomplete/);
  });
});

describe("My Pools for authenticated Participant", () => {
  it("returns empty memberships and createPoolEnabled false with no Available Season", async () => {
    const t = convexTest(schema, modules);
    const asAlex = t.withIdentity(fullyVerifiedIdentity());
    await asAlex.mutation(api.participants.ensureMyParticipant, {});

    const home = await asAlex.query(api.participants.myPools, {});
    expect(home).toEqual({
      memberships: [],
      archivedCount: 0,
      createPoolEnabled: false,
      authError: null,
    });
  });

  it("sets createPoolEnabled true when an Available Season exists", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("poolSeasons", {
        label: "2026",
        year: 2026,
        status: "available",
      });
    });

    const asAlex = t.withIdentity(fullyVerifiedIdentity());
    await asAlex.mutation(api.participants.ensureMyParticipant, {});

    const home = await asAlex.query(api.participants.myPools, {});
    expect(home.createPoolEnabled).toBe(true);
    expect(home.memberships).toEqual([]);
  });

  it("does not interrupt an already-valid session when phone verification lapses mid-session", async () => {
    const t = convexTest(schema, modules);
    const asAlex = t.withIdentity(fullyVerifiedIdentity());
    await asAlex.mutation(api.participants.ensureMyParticipant, {});

    const midSession = t.withIdentity(
      fullyVerifiedIdentity({ phoneNumberVerified: false }),
    );
    const home = await midSession.query(api.participants.myPools, {});
    expect(home.memberships).toEqual([]);
    expect(home.createPoolEnabled).toBe(false);
  });

  it("requires phone again on a new Clerk session after a lapse", async () => {
    const t = convexTest(schema, modules);
    const asAlex = t.withIdentity(fullyVerifiedIdentity());
    await asAlex.mutation(api.participants.ensureMyParticipant, {});

    // New sign-in: different Clerk session id, phone no longer verified.
    const newSignIn = t.withIdentity(
      fullyVerifiedIdentity({
        sid: "sess_alex_2",
        phoneNumberVerified: false,
      }),
    );
    await expect(
      newSignIn.mutation(api.participants.ensureMyParticipant, {}),
    ).rejects.toThrow(/Verification incomplete/);
  });

  it("requires phone again on a fresh Participant establish after lapse", async () => {
    const t = convexTest(schema, modules);
    // Brand-new identity that never established — new sign-in path.
    const fresh = t.withIdentity(
      fullyVerifiedIdentity({
        subject: "clerk_new",
        phoneNumberVerified: false,
      }),
    );
    await expect(
      fresh.mutation(api.participants.ensureMyParticipant, {}),
    ).rejects.toThrow(/Verification incomplete/);
  });
});
