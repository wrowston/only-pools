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

  it("allows ensure for an authenticated Clerk identity even without phone claims on the JWT", async () => {
    const t = convexTest(schema, modules);
    const sparse = t.withIdentity(
      fullyVerifiedIdentity({
        phoneNumberVerified: false,
        phoneNumber: undefined,
        emailVerified: false,
        email: undefined,
      }),
    );
    const result = await sparse.mutation(api.participants.ensureMyParticipant, {});
    expect(result.participantId).toBeTruthy();
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

  it("does not interrupt an already-valid session when phone verification flag is missing but phone remains on the JWT", async () => {
    const t = convexTest(schema, modules);
    const asAlex = t.withIdentity(fullyVerifiedIdentity());
    await asAlex.mutation(api.participants.ensureMyParticipant, {});

    const midSession = t.withIdentity(
      fullyVerifiedIdentity({ phoneNumberVerified: false }),
    );
    const home = await midSession.query(api.participants.myPools, {});
    expect(home.authError).toBeNull();
    expect(home.memberships).toEqual([]);
    expect(home.createPoolEnabled).toBe(false);
  });

  it("allows a new Clerk session even when phone claims are absent from the JWT", async () => {
    const t = convexTest(schema, modules);
    const asAlex = t.withIdentity(fullyVerifiedIdentity());
    await asAlex.mutation(api.participants.ensureMyParticipant, {});

    const newSignIn = t.withIdentity(
      fullyVerifiedIdentity({
        sid: "sess_alex_2",
        phoneNumberVerified: false,
        phoneNumber: undefined,
      }),
    );
    const result = await newSignIn.mutation(
      api.participants.ensureMyParticipant,
      {},
    );
    expect(result.participantId).toBeTruthy();
  });

  it("allows a fresh Participant establish without phone claims on the JWT", async () => {
    const t = convexTest(schema, modules);
    const fresh = t.withIdentity(
      fullyVerifiedIdentity({
        subject: "clerk_new",
        phoneNumberVerified: false,
        phoneNumber: undefined,
      }),
    );
    const result = await fresh.mutation(api.participants.ensureMyParticipant, {});
    expect(result.participantId).toBeTruthy();
  });

  it("lists active pools even when left history exceeds the old take(80) window", async () => {
    const t = convexTest(schema, modules);
    const asAlex = t.withIdentity(fullyVerifiedIdentity());
    const { participantId: alexId } = await asAlex.mutation(
      api.participants.ensureMyParticipant,
      {},
    );

    const livePoolId = await t.run(async (ctx) => {
      const seasonId = await ctx.db.insert("poolSeasons", {
        label: "2026",
        year: 2026,
        status: "available",
      });
      const otherOwner = await ctx.db.insert("participants", {
        tokenIdentifier:
          "https://viable-eagle-73.clerk.accounts.dev|other_owner_pools",
        clerkUserId: "other_owner_pools",
        displayName: "Other Owner",
        emailVerified: true,
        phoneVerified: true,
        ageConfirmed: true,
        suspended: false,
      });
      for (let i = 0; i < 80; i++) {
        const poolId = await ctx.db.insert("pools", {
          name: `Left ${i}`,
          type: "survivor",
          seasonId,
          startWeek: 1,
          pickLockMode: "gameKickoff",
          status: "active",
          rulesFrozen: false,
          archived: false,
          ownerParticipantId: otherOwner,
          createdAtMs: Date.now(),
        });
        await ctx.db.insert("poolMemberships", {
          poolId,
          participantId: alexId,
          role: "member",
          status: "left",
        });
      }
      const livePoolId = await ctx.db.insert("pools", {
        name: "Still competing",
        type: "survivor",
        seasonId,
        startWeek: 1,
        pickLockMode: "gameKickoff",
        status: "active",
        rulesFrozen: false,
        archived: false,
        ownerParticipantId: otherOwner,
        createdAtMs: Date.now(),
      });
      await ctx.db.insert("poolMemberships", {
        poolId: livePoolId,
        participantId: alexId,
        role: "member",
        status: "active",
      });
      return livePoolId;
    });

    const home = await asAlex.query(api.participants.myPools, {});
    expect(home.authError).toBeNull();
    expect(home.memberships.some((m) => m.poolId === livePoolId)).toBe(true);
  });
});
