/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { hashInviteCredential } from "./lib/inviteCrypto";
import { INVITE_UNAVAILABLE } from "./lib/inviteThrottle";

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

function futureKickoffs() {
  const now = Date.now();
  return {
    week1: now + 7 * 24 * 60 * 60 * 1000,
    week2: now + 14 * 24 * 60 * 60 * 1000,
  };
}

async function seedAvailableSeasonWithSlate(
  t: ReturnType<typeof convexTest>,
  opts: {
    week1KickoffMs?: number;
    week2KickoffMs?: number;
  } = {},
) {
  const defaults = futureKickoffs();
  const week1Kickoff = opts.week1KickoffMs ?? defaults.week1;
  const week2Kickoff = opts.week2KickoffMs ?? defaults.week2;
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

    const gameId = await ctx.db.insert("nflGames", {
      stableKey: "nfl:2025:w1:buf@kc",
      seasonId,
      seasonLabel: "2025",
      week: 1,
      homeTeamId: homeId,
      awayTeamId: awayId,
      scheduledKickoffMs: week1Kickoff,
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
      scheduledKickoffMs: week2Kickoff,
      lifecycle: "scheduled",
      homeScore: null,
      awayScore: null,
      sportsDbEventId: "evt_w2",
    });

    return { seasonId, homeId, awayId, week1Kickoff, week2Kickoff, gameId };
  });
}

async function createOwnedPool(t: ReturnType<typeof convexTest>) {
  await seedAvailableSeasonWithSlate(t);
  const asAlex = t.withIdentity(fullyVerifiedIdentity());
  await asAlex.mutation(api.participants.ensureMyParticipant, {});
  const created = await asAlex.mutation(api.pools.createPool, {
    name: "Invite Pool",
    type: "survivor",
    startWeek: 1,
    pickLockMode: "gameKickoff",
  });
  return { asAlex, poolId: created.poolId };
}

describe("acceptInvite (acceptance scenario 2)", () => {
  it("preview alone does not enroll; accept with disclosure creates one membership; repeat is idempotent", async () => {
    const t = convexTest(schema, modules);
    const { asAlex, poolId } = await createOwnedPool(t);

    await asAlex.mutation(api.invites.confirmStepUp, {});
    const invite = await asAlex.mutation(api.invites.createOrRetrieveInvite, {
      poolId,
    });
    expect(invite.url).toMatch(/^\/join\//);
    const rawToken = invite.url.replace("/join/", "");

    const asBlake = t.withIdentity(
      fullyVerifiedIdentity({
        subject: "clerk_blake",
        email: "blake@example.com",
        name: "Blake Adult",
        phoneNumber: "+15559876543",
        sid: "sess_blake_1",
      }),
    );
    await asBlake.mutation(api.participants.ensureMyParticipant, {});

    const preview = await asBlake.query(api.invites.previewInvite, {
      token: rawToken,
    });
    expect(preview).not.toBeNull();
    expect(preview!.poolName).toBe("Invite Pool");
    expect(preview!.disclosureText.length).toBeGreaterThan(20);
    expect(preview!.alreadyMember).toBe(false);

    const membershipsBefore = await t.run(async (ctx) =>
      ctx.db
        .query("poolMemberships")
        .withIndex("by_poolId", (q) => q.eq("poolId", poolId))
        .collect(),
    );
    expect(membershipsBefore).toHaveLength(1);

    await expect(
      asBlake.mutation(api.invites.acceptInvite, {
        token: rawToken,
        acknowledgedContactVisibility: false,
      }),
    ).rejects.toThrow(/acknowledg/);

    const accepted = await asBlake.mutation(api.invites.acceptInvite, {
      token: rawToken,
      acknowledgedContactVisibility: true,
    });
    expect(accepted.poolId).toEqual(poolId);
    expect(accepted.role).toBe("member");
    expect(accepted.created).toBe(true);

    const membershipsAfter = await t.run(async (ctx) =>
      ctx.db
        .query("poolMemberships")
        .withIndex("by_poolId", (q) => q.eq("poolId", poolId))
        .collect(),
    );
    expect(membershipsAfter).toHaveLength(2);

    const again = await asBlake.mutation(api.invites.acceptInvite, {
      token: rawToken,
      acknowledgedContactVisibility: true,
    });
    expect(again.created).toBe(false);
    expect(again.poolId).toEqual(poolId);

    const membershipsIdempotent = await t.run(async (ctx) =>
      ctx.db
        .query("poolMemberships")
        .withIndex("by_poolId", (q) => q.eq("poolId", poolId))
        .collect(),
    );
    expect(membershipsIdempotent).toHaveLength(2);
  });

  it("refuses accept without contact-visibility disclosure", async () => {
    const t = convexTest(schema, modules);
    const { asAlex, poolId } = await createOwnedPool(t);
    await asAlex.mutation(api.invites.confirmStepUp, {});
    const invite = await asAlex.mutation(api.invites.createOrRetrieveInvite, {
      poolId,
    });
    const rawToken = invite.url.replace("/join/", "");

    const asBlake = t.withIdentity(
      fullyVerifiedIdentity({
        subject: "clerk_blake2",
        email: "blake2@example.com",
        name: "Blake Two",
        phoneNumber: "+15551112222",
        sid: "sess_blake_2",
      }),
    );
    await asBlake.mutation(api.participants.ensureMyParticipant, {});

    await expect(
      asBlake.mutation(api.invites.acceptInvite, {
        token: rawToken,
        acknowledgedContactVisibility: false,
      }),
    ).rejects.toThrow(/acknowledg/);
  });
});

describe("membership cutoff (acceptance scenario 3)", () => {
  it("refuses accept after Start Week first kickoff and never reopens on reschedule", async () => {
    const t = convexTest(schema, modules);
    const kickoff = Date.now() + 60_000;
    await seedAvailableSeasonWithSlate(t, { week1KickoffMs: kickoff });
    const asAlex = t.withIdentity(fullyVerifiedIdentity());
    await asAlex.mutation(api.participants.ensureMyParticipant, {});
    const created = await asAlex.mutation(api.pools.createPool, {
      name: "Cutoff Pool",
      type: "survivor",
      startWeek: 1,
      pickLockMode: "gameKickoff",
    });
    await asAlex.mutation(api.invites.confirmStepUp, {});
    const invite = await asAlex.mutation(api.invites.createOrRetrieveInvite, {
      poolId: created.poolId,
    });
    const rawToken = invite.url.replace("/join/", "");

    // Move wall clock past kickoff by rewriting the game kickoff into the past.
    await t.run(async (ctx) => {
      const games = await ctx.db
        .query("nflGames")
        .withIndex("by_seasonId_and_week", (q) =>
          q.eq("seasonId", created.seasonId).eq("week", 1),
        )
        .take(8);
      for (const g of games) {
        await ctx.db.patch(g._id, {
          scheduledKickoffMs: Date.now() - 1_000,
        });
      }
    });

    const asBlake = t.withIdentity(
      fullyVerifiedIdentity({
        subject: "clerk_cutoff",
        email: "cutoff@example.com",
        name: "Cutoff Blake",
        phoneNumber: "+15553334444",
        sid: "sess_cutoff_1",
      }),
    );
    await asBlake.mutation(api.participants.ensureMyParticipant, {});

    await expect(
      asBlake.mutation(api.invites.acceptInvite, {
        token: rawToken,
        acknowledgedContactVisibility: true,
      }),
    ).resolves.toMatchObject({
      created: false,
      refusedReason: "admission_closed",
    });

    const poolAfterRefuse = await t.run(async (ctx) =>
      ctx.db.get(created.poolId),
    );
    expect(poolAfterRefuse?.admissionClosedAtMs).toBeTypeOf("number");

    // Reschedule kickoff far into the future — admission must stay closed.
    await t.run(async (ctx) => {
      const games = await ctx.db
        .query("nflGames")
        .withIndex("by_seasonId_and_week", (q) =>
          q.eq("seasonId", created.seasonId).eq("week", 1),
        )
        .take(8);
      for (const g of games) {
        await ctx.db.patch(g._id, {
          scheduledKickoffMs: Date.now() + 30 * 24 * 60 * 60 * 1000,
        });
      }
    });

    await expect(
      asBlake.mutation(api.invites.acceptInvite, {
        token: rawToken,
        acknowledgedContactVisibility: true,
      }),
    ).resolves.toMatchObject({
      created: false,
      refusedReason: "admission_closed",
    });

    const memberships = await t.run(async (ctx) =>
      ctx.db
        .query("poolMemberships")
        .withIndex("by_poolId", (q) => q.eq("poolId", created.poolId))
        .collect(),
    );
    expect(memberships).toHaveLength(1);
  });
});

describe("invite credential security + step-up", () => {
  it("requires step-up for create/retrieve and rotate; stores hash; audit has no raw secret", async () => {
    const t = convexTest(schema, modules);
    const { asAlex, poolId } = await createOwnedPool(t);

    await expect(
      asAlex.mutation(api.invites.createOrRetrieveInvite, { poolId }),
    ).rejects.toThrow(/step-up|Step-up/i);

    await asAlex.mutation(api.invites.confirmStepUp, {});
    const invite = await asAlex.mutation(api.invites.createOrRetrieveInvite, {
      poolId,
    });
    const rawToken = invite.url.replace("/join/", "");
    expect(rawToken.length).toBeGreaterThanOrEqual(32);

    const stored = await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("poolInvites")
        .withIndex("by_poolId_and_status", (q) =>
          q.eq("poolId", poolId).eq("status", "active"),
        )
        .take(2);
      return rows[0]!;
    });
    const expectedHash = await hashInviteCredential(rawToken);
    expect(stored.credentialHash).toBe(expectedHash);
    expect(stored.credentialHash).not.toBe(rawToken);

    await asAlex.mutation(api.invites.confirmStepUp, {});
    const retrieved = await asAlex.mutation(api.invites.createOrRetrieveInvite, {
      poolId,
    });
    expect(retrieved.url).toBe(invite.url);

    await asAlex.mutation(api.invites.confirmStepUp, {});
    const rotated = await asAlex.mutation(api.invites.rotateInvite, { poolId });
    expect(rotated.url).not.toBe(invite.url);

    const audits = await t.run(async (ctx) =>
      ctx.db
        .query("poolAuditEvents")
        .withIndex("by_poolId_and_atMs", (q) => q.eq("poolId", poolId))
        .take(20),
    );
    expect(audits.length).toBeGreaterThan(0);
    for (const event of audits) {
      expect(event.metadataJson ?? "").not.toContain(rawToken);
      expect(JSON.stringify(event)).not.toContain(rawToken);
      expect(JSON.stringify(event)).not.toContain(
        rotated.url.replace("/join/", ""),
      );
    }
  });
});

describe("invite throttle (acceptance scenario 38)", () => {
  it("returns generic errors, progressive throttle, and never auto-rotates valid invite", async () => {
    const t = convexTest(schema, modules);
    const { asAlex, poolId } = await createOwnedPool(t);
    await asAlex.mutation(api.invites.confirmStepUp, {});
    const invite = await asAlex.mutation(api.invites.createOrRetrieveInvite, {
      poolId,
    });
    const validToken = invite.url.replace("/join/", "");

    const asProbe = t.withIdentity(
      fullyVerifiedIdentity({
        subject: "clerk_probe",
        email: "probe@example.com",
        name: "Probe",
        phoneNumber: "+15555556666",
        sid: "sess_probe_1",
      }),
    );
    await asProbe.mutation(api.participants.ensureMyParticipant, {});

    for (let i = 0; i < 3; i++) {
      await expect(
        asProbe.mutation(api.invites.acceptInvite, {
          token: `bogus-token-${i}`,
          acknowledgedContactVisibility: true,
        }),
      ).rejects.toThrow(INVITE_UNAVAILABLE);
    }

    // Fourth attempt should still be generic (may be throttled message wrapping same text).
    await expect(
      asProbe.mutation(api.invites.acceptInvite, {
        token: "bogus-token-3",
        acknowledgedContactVisibility: true,
      }),
    ).rejects.toThrow(INVITE_UNAVAILABLE);

    const activeBefore = await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("poolInvites")
        .withIndex("by_poolId_and_status", (q) =>
          q.eq("poolId", poolId).eq("status", "active"),
        )
        .take(2);
      return rows[0]!;
    });
    expect(activeBefore.credentialHash).toBe(
      await hashInviteCredential(validToken),
    );

    // Valid invite still works for a different, non-throttled account.
    const asBlake = t.withIdentity(
      fullyVerifiedIdentity({
        subject: "clerk_join_ok",
        email: "ok@example.com",
        name: "Ok Blake",
        phoneNumber: "+15557778888",
        sid: "sess_ok_1",
      }),
    );
    await asBlake.mutation(api.participants.ensureMyParticipant, {});
    const joined = await asBlake.mutation(api.invites.acceptInvite, {
      token: validToken,
      acknowledgedContactVisibility: true,
    });
    expect(joined.created).toBe(true);

    const activeAfter = await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("poolInvites")
        .withIndex("by_poolId_and_status", (q) =>
          q.eq("poolId", poolId).eq("status", "active"),
        )
        .take(2);
      return rows[0]!;
    });
    expect(activeAfter._id).toEqual(activeBefore._id);
    expect(activeAfter.credentialHash).toBe(activeBefore.credentialHash);
  });
});

describe("listPoolMembers privacy", () => {
  it("Owner/Admin see email/phone; Members see displayName/avatar only", async () => {
    const t = convexTest(schema, modules);
    const { asAlex, poolId } = await createOwnedPool(t);
    await asAlex.mutation(api.invites.confirmStepUp, {});
    const invite = await asAlex.mutation(api.invites.createOrRetrieveInvite, {
      poolId,
    });
    const rawToken = invite.url.replace("/join/", "");

    const asBlake = t.withIdentity(
      fullyVerifiedIdentity({
        subject: "clerk_member",
        email: "member@example.com",
        name: "Member Blake",
        phoneNumber: "+15559990000",
        sid: "sess_member_1",
      }),
    );
    await asBlake.mutation(api.participants.ensureMyParticipant, {});
    await asBlake.mutation(api.invites.acceptInvite, {
      token: rawToken,
      acknowledgedContactVisibility: true,
    });

    const asOwner = await asAlex.query(api.invites.listPoolMembers, { poolId });
    const blakeAsOwner = asOwner.members.find(
      (m) => m.displayName === "Member Blake",
    );
    expect(blakeAsOwner?.email).toBe("member@example.com");
    expect(blakeAsOwner?.phone).toBe("+15559990000");

    const asMember = await asBlake.query(api.invites.listPoolMembers, {
      poolId,
    });
    const alexAsMember = asMember.members.find(
      (m) => m.displayName === "Alex Adult",
    );
    expect(alexAsMember?.email).toBeUndefined();
    expect(alexAsMember?.phone).toBeUndefined();
    expect(alexAsMember?.displayName).toBe("Alex Adult");
  });
});
