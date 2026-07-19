/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { MAX_OWNED_POOLS, MAX_POOL_ENTRIES } from "./lib/quotas";

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

function blakeIdentity() {
  return fullyVerifiedIdentity({
    subject: "clerk_blake",
    email: "blake@example.com",
    name: "Blake Adult",
    phoneNumber: "+15559876543",
    sid: "sess_blake_1",
  });
}

function caseyIdentity() {
  return fullyVerifiedIdentity({
    subject: "clerk_casey",
    email: "casey@example.com",
    name: "Casey Adult",
    phoneNumber: "+15551112222",
    sid: "sess_casey_1",
  });
}

async function seedAvailableSeasonWithSlate(t: ReturnType<typeof convexTest>) {
  const now = Date.now();
  return await t.run(async (ctx) => {
    const seasonId = await ctx.db.insert("poolSeasons", {
      label: "2025",
      year: 2025,
      status: "available",
      usableStartWeek: 1,
      bootstrappedAtMs: now,
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
      scheduledKickoffMs: now + 7 * 24 * 60 * 60 * 1000,
      lifecycle: "scheduled",
      homeScore: null,
      awayScore: null,
      sportsDbEventId: "evt_w1",
    });
    return { seasonId, homeId, awayId, gameId };
  });
}

async function createOwnedPool(t: ReturnType<typeof convexTest>) {
  await seedAvailableSeasonWithSlate(t);
  const asAlex = t.withIdentity(fullyVerifiedIdentity());
  await asAlex.mutation(api.participants.ensureMyParticipant, {});
  const created = await asAlex.mutation(api.pools.createPool, {
    name: "Admin Pool",
    type: "survivor",
    startWeek: 1,
    pickLockMode: "gameKickoff",
  });
  return { asAlex, poolId: created.poolId as Id<"pools"> };
}

async function joinAsMember(
  t: ReturnType<typeof convexTest>,
  asAlex: ReturnType<ReturnType<typeof convexTest>["withIdentity"]>,
  poolId: Id<"pools">,
  identity: ReturnType<typeof blakeIdentity>,
) {
  await asAlex.mutation(api.invites.confirmStepUp, {});
  const invite = await asAlex.mutation(api.invites.createOrRetrieveInvite, {
    poolId,
  });
  const rawToken = invite.url.replace("/join/", "");
  const asJoiner = t.withIdentity(identity);
  await asJoiner.mutation(api.participants.ensureMyParticipant, {});
  await asJoiner.mutation(api.invites.acceptInvite, {
    token: rawToken,
    acknowledgedContactVisibility: true,
  });
  const participantId = await t.run(async (ctx) => {
    const rows = await ctx.db.query("participants").collect();
    const match = rows.find(
      (p) => p.clerkUserId === (identity.subject as string),
    );
    return match!._id;
  });
  return { asJoiner, participantId };
}

describe("ownership transfer (acceptance scenario 4)", () => {
  it("requires step-up, Admin accept, atomic role swap; sole Owner cannot leave", async () => {
    const t = convexTest(schema, modules);
    const { asAlex, poolId } = await createOwnedPool(t);
    const { asJoiner: asBlake, participantId: blakeId } = await joinAsMember(
      t,
      asAlex,
      poolId,
      blakeIdentity(),
    );

    await asAlex.mutation(api.invites.confirmStepUp, {});
    await expect(
      asAlex.mutation(api.membershipAdmin.offerOwnershipTransfer, {
        poolId,
        toParticipantId: blakeId,
      }),
    ).rejects.toThrow(/Pool Admin/);

    await asAlex.mutation(api.membershipAdmin.promoteAdmin, {
      poolId,
      participantId: blakeId,
    });

    // Expire step-up so offer requires a fresh verification.
    await t.run(async (ctx) => {
      const alex = await ctx.db
        .query("participants")
        .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", "clerk_user_1"))
        .unique();
      await ctx.db.patch(alex!._id, { stepUpVerifiedAtMs: 0 });
    });

    await expect(
      asAlex.mutation(api.membershipAdmin.offerOwnershipTransfer, {
        poolId,
        toParticipantId: blakeId,
      }),
    ).rejects.toThrow(/Step-up/);

    await asAlex.mutation(api.invites.confirmStepUp, {});
    const offer = await asAlex.mutation(
      api.membershipAdmin.offerOwnershipTransfer,
      { poolId, toParticipantId: blakeId },
    );
    expect(offer.status).toBe("pending");

    const status = await asAlex.query(
      api.membershipAdmin.getOwnershipTransferStatus,
      { poolId },
    );
    expect(status.pending).toMatchObject({
      offerId: offer.offerId,
      toParticipantId: blakeId,
      toDisplayName: "Blake Adult",
      canCancel: true,
      canAccept: false,
    });

    await expect(
      asAlex.mutation(api.membershipAdmin.leavePool, { poolId }),
    ).rejects.toThrow(/cannot leave while owning/);

    const casey = await joinAsMember(t, asAlex, poolId, caseyIdentity());
    await expect(
      casey.asJoiner.mutation(api.membershipAdmin.acceptOwnershipTransfer, {
        offerId: offer.offerId,
      }),
    ).rejects.toThrow(/Only the offered/);

    const accepted = await asBlake.mutation(
      api.membershipAdmin.acceptOwnershipTransfer,
      { offerId: offer.offerId },
    );
    expect(accepted.ownerParticipantId).toEqual(blakeId);

    const roles = await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("poolMemberships")
        .withIndex("by_poolId", (q) => q.eq("poolId", poolId))
        .collect();
      const byParticipant = Object.fromEntries(
        rows.map((r) => [r.participantId, r.role]),
      );
      const pool = await ctx.db.get(poolId);
      return { byParticipant, ownerParticipantId: pool!.ownerParticipantId };
    });
    expect(roles.ownerParticipantId).toEqual(blakeId);
    expect(roles.byParticipant[blakeId]).toBe("owner");

    const alexId = await t.run(async (ctx) => {
      const alex = await ctx.db
        .query("participants")
        .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", "clerk_user_1"))
        .unique();
      return alex!._id;
    });
    expect(roles.byParticipant[alexId]).toBe("admin");

    // Former Owner can now leave after transfer.
    const left = await asAlex.mutation(api.membershipAdmin.leavePool, {
      poolId,
    });
    expect(left.status).toBe("left");
  });
});

describe("removal preserves history (acceptance scenario 5)", () => {
  it("ends access and contacts; preserves picks; invite cannot reinstate; Owner reinstates as Member", async () => {
    const t = convexTest(schema, modules);
    const { asAlex, poolId } = await createOwnedPool(t);
    const { asJoiner: asBlake, participantId: blakeId } = await joinAsMember(
      t,
      asAlex,
      poolId,
      blakeIdentity(),
    );

    const homeId = await t.run(async (ctx) => {
      const teams = await ctx.db.query("nflTeams").collect();
      return teams.find((tm) => tm.abbreviation === "KC")!._id;
    });

    await asBlake.mutation(api.survivorPicks.autosaveSurvivorPick, {
      poolId,
      week: 1,
      nflTeamId: homeId,
    });

    await asAlex.mutation(api.membershipAdmin.removeMember, {
      poolId,
      participantId: blakeId,
      reason: "Disruptive behavior",
    });

    const membership = await t.run(async (ctx) =>
      ctx.db
        .query("poolMemberships")
        .withIndex("by_poolId_and_participantId", (q) =>
          q.eq("poolId", poolId).eq("participantId", blakeId),
        )
        .unique(),
    );
    expect(membership?.status).toBe("removed");

    const pick = await t.run(async (ctx) =>
      ctx.db
        .query("survivorPicks")
        .withIndex("by_poolId_and_participantId_and_week", (q) =>
          q.eq("poolId", poolId).eq("participantId", blakeId).eq("week", 1),
        )
        .unique(),
    );
    expect(pick?.nflTeamId).toEqual(homeId);

    await expect(
      asBlake.mutation(api.survivorPicks.autosaveSurvivorPick, {
        poolId,
        week: 1,
        nflTeamId: homeId,
      }),
    ).rejects.toThrow(/Not a member/);

    const members = await asAlex.query(api.invites.listPoolMembers, { poolId });
    const blakeRow = members.members.find((m) => m.participantId === blakeId);
    expect(blakeRow?.status).toBe("removed");
    expect(blakeRow).not.toHaveProperty("email");

    await asAlex.mutation(api.invites.confirmStepUp, {});
    const invite = await asAlex.mutation(api.invites.createOrRetrieveInvite, {
      poolId,
    });
    const rawToken = invite.url.replace("/join/", "");
    await expect(
      asBlake.mutation(api.invites.acceptInvite, {
        token: rawToken,
        acknowledgedContactVisibility: true,
      }),
    ).rejects.toThrow();

    const reinstated = await asAlex.mutation(
      api.membershipAdmin.reinstateMember,
      {
        poolId,
        participantId: blakeId,
        reason: "Appealed successfully",
      },
    );
    expect(reinstated.role).toBe("member");
    expect(reinstated.status).toBe("active");

    const after = await t.run(async (ctx) =>
      ctx.db
        .query("poolMemberships")
        .withIndex("by_poolId_and_participantId", (q) =>
          q.eq("poolId", poolId).eq("participantId", blakeId),
        )
        .unique(),
    );
    expect(after?.role).toBe("member");
    expect(after?.status).toBe("active");
  });
});

describe("archive overlay (acceptance scenario 10)", () => {
  it("hides from My Pools, blocks joins/picks/rules, restore works; locks unaffected", async () => {
    const t = convexTest(schema, modules);
    const { asAlex, poolId } = await createOwnedPool(t);

    await expect(
      asAlex.mutation(api.membershipAdmin.archivePool, { poolId }),
    ).rejects.toThrow(/Step-up/);

    await asAlex.mutation(api.invites.confirmStepUp, {});
    const archived = await asAlex.mutation(api.membershipAdmin.archivePool, {
      poolId,
    });
    expect(archived.archived).toBe(true);

    const myPools = await asAlex.query(api.participants.myPools, {});
    expect(myPools.memberships.find((m) => m.poolId === poolId)).toBeUndefined();
    expect(myPools.archivedCount).toBe(1);

    const withArchived = await asAlex.query(api.participants.myPools, {
      includeArchived: true,
    });
    expect(withArchived.memberships.some((m) => m.poolId === poolId)).toBe(
      true,
    );

    await expect(
      asAlex.mutation(api.pools.updatePoolRules, {
        poolId,
        name: "Renamed",
      }),
    ).rejects.toThrow(/read-only/);

    await asAlex.mutation(api.invites.confirmStepUp, {});
    await expect(
      asAlex.mutation(api.invites.createOrRetrieveInvite, { poolId }),
    ).rejects.toThrow(/Archived/);

    // Lifecycle status stays active — archive is an overlay.
    const pool = await t.run(async (ctx) => ctx.db.get(poolId));
    expect(pool?.status).toBe("active");
    expect(pool?.archived).toBe(true);

    await asAlex.mutation(api.invites.confirmStepUp, {});
    const restored = await asAlex.mutation(api.membershipAdmin.restorePool, {
      poolId,
    });
    expect(restored.archived).toBe(false);

    const after = await asAlex.query(api.participants.myPools, {});
    expect(after.memberships.some((m) => m.poolId === poolId)).toBe(true);
  });
});

describe("sanitized audit events (acceptance scenario 6)", () => {
  it("lists role/membership/invite/archive events without raw invite credentials", async () => {
    const t = convexTest(schema, modules);
    const { asAlex, poolId } = await createOwnedPool(t);
    const { participantId: blakeId } = await joinAsMember(
      t,
      asAlex,
      poolId,
      blakeIdentity(),
    );

    await asAlex.mutation(api.invites.confirmStepUp, {});
    await asAlex.mutation(api.membershipAdmin.promoteAdmin, {
      poolId,
      participantId: blakeId,
    });
    await asAlex.mutation(api.membershipAdmin.archivePool, { poolId });
    await asAlex.mutation(api.invites.confirmStepUp, {});
    await asAlex.mutation(api.membershipAdmin.restorePool, { poolId });

    const audit = await asAlex.query(api.membershipAdmin.listPoolAuditEvents, {
      poolId,
    });
    const actions = audit.events.map((e) => e.action);
    expect(actions).toContain("invite_created");
    expect(actions).toContain("invite_accepted");
    expect(actions).toContain("admin_promoted");
    expect(actions).toContain("pool_archived");
    expect(actions).toContain("pool_restored");

    const blob = JSON.stringify(audit.events);
    expect(blob).not.toMatch(/credentialSecret/);
    expect(blob).not.toMatch(/\/join\//);
  });
});

describe("quotas (acceptance scenario 39)", () => {
  it("enforces ≤10 owned pools", async () => {
    const t = convexTest(schema, modules);
    await seedAvailableSeasonWithSlate(t);
    const asAlex = t.withIdentity(fullyVerifiedIdentity());
    await asAlex.mutation(api.participants.ensureMyParticipant, {});

    for (let i = 0; i < MAX_OWNED_POOLS; i++) {
      await asAlex.mutation(api.pools.createPool, {
        name: `Pool ${i}`,
        type: "survivor",
        startWeek: 1,
        pickLockMode: "gameKickoff",
      });
    }
    await expect(
      asAlex.mutation(api.pools.createPool, {
        name: "One too many",
        type: "survivor",
        startWeek: 1,
        pickLockMode: "gameKickoff",
      }),
    ).rejects.toThrow(/at most 10/);
  });

  it("refuses accept when Pool already has 2000 active entries", async () => {
    const t = convexTest(schema, modules);
    const { asAlex, poolId } = await createOwnedPool(t);

    // Owner already has 1 entry from createPool. Fill remaining slots in DB.
    await t.run(async (ctx) => {
      const ownerMembership = await ctx.db
        .query("poolMemberships")
        .withIndex("by_poolId", (q) => q.eq("poolId", poolId))
        .first();
      if (!ownerMembership) throw new Error("missing owner membership");
      const nowMs = Date.now();
      for (let i = 2; i <= MAX_POOL_ENTRIES; i++) {
        await ctx.db.insert("poolEntries", {
          poolId,
          participantId: ownerMembership.participantId,
          membershipId: ownerMembership._id,
          entryNumber: i,
          status: "active",
          createdAtMs: nowMs,
        });
      }
    });

    const activeEntries = await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("poolEntries")
        .withIndex("by_poolId_and_status", (q) =>
          q.eq("poolId", poolId).eq("status", "active"),
        )
        .take(MAX_POOL_ENTRIES + 1);
      return rows.length;
    });
    expect(activeEntries).toBe(MAX_POOL_ENTRIES);

    await asAlex.mutation(api.invites.confirmStepUp, {});
    const invite = await asAlex.mutation(api.invites.createOrRetrieveInvite, {
      poolId,
    });
    const rawToken = invite.url.replace("/join/", "");
    const asBlake = t.withIdentity(blakeIdentity());
    await asBlake.mutation(api.participants.ensureMyParticipant, {});
    await expect(
      asBlake.mutation(api.invites.acceptInvite, {
        token: rawToken,
        acknowledgedContactVisibility: true,
      }),
    ).rejects.toThrow(/entry limit/);
  });

  it("refuses create when participant already has 50 active memberships in the season", async () => {
    const t = convexTest(schema, modules);
    const { seasonId } = await seedAvailableSeasonWithSlate(t);
    const asAlex = t.withIdentity(fullyVerifiedIdentity());
    await asAlex.mutation(api.participants.ensureMyParticipant, {});
    const alexId = await t.run(async (ctx) => {
      const alex = await ctx.db
        .query("participants")
        .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", "clerk_user_1"))
        .unique();
      return alex!._id;
    });

    await t.run(async (ctx) => {
      const otherOwner = await ctx.db.insert("participants", {
        tokenIdentifier:
          "https://viable-eagle-73.clerk.accounts.dev|other_owner",
        clerkUserId: "other_owner",
        displayName: "Other Owner",
        emailVerified: true,
        phoneVerified: true,
        ageConfirmed: true,
        suspended: false,
      });
      for (let i = 0; i < 50; i++) {
        const poolId = await ctx.db.insert("pools", {
          name: `Filled ${i}`,
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
          status: "active",
        });
      }
    });

    await expect(
      asAlex.mutation(api.pools.createPool, {
        name: "Over season quota",
        type: "survivor",
        startWeek: 1,
        pickLockMode: "gameKickoff",
      }),
    ).rejects.toThrow(/50 Pool memberships per season/);
  });
});

describe("abuse report (acceptance scenario 40)", () => {
  it("creates report without automatic penalty and rejects hidden-pick / invite secrets", async () => {
    const t = convexTest(schema, modules);
    const { asAlex, poolId } = await createOwnedPool(t);

    const ok = await asAlex.mutation(api.membershipAdmin.createAbuseReport, {
      poolId,
      reason: "Harassment in pool chat",
      description: "Repeated insults toward members.",
    });
    expect(ok.accepted).toBe(true);
    expect(ok.automaticPenalty).toBe(false);

    const stored = await t.run(async (ctx) => ctx.db.get(ok.reportId));
    expect(stored?.reason).toBe("Harassment in pool chat");
    expect(stored).not.toHaveProperty("automaticPenaltyApplied");

    await expect(
      asAlex.mutation(api.membershipAdmin.createAbuseReport, {
        reason: "Leak",
        description: "pickedTeamId was shown to me",
      }),
    ).rejects.toThrow(/Hidden Pick/);

    await expect(
      asAlex.mutation(api.membershipAdmin.createAbuseReport, {
        reason: "Invite leak",
        description: "Here is /join/abcDEF1234567890secret",
      }),
    ).rejects.toThrow(/Invite/);
  });
});
