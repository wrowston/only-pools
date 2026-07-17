/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
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

function blakeIdentity() {
  return fullyVerifiedIdentity({
    subject: "clerk_user_2",
    name: "Blake Friend",
    email: "blake@example.com",
    phoneNumber: "+15559876543",
    sid: "sess_blake_1",
  });
}

function caseyIdentity() {
  return fullyVerifiedIdentity({
    subject: "clerk_user_3",
    name: "Casey Pal",
    email: "casey@example.com",
    phoneNumber: "+15551112222",
    sid: "sess_casey_1",
  });
}

function futureKickoffs() {
  const now = Date.now();
  return {
    week1: now + 7 * 24 * 60 * 60 * 1000,
    week2: now + 14 * 24 * 60 * 60 * 1000,
  };
}

async function seedSeasonWithSlate(
  t: ReturnType<typeof convexTest>,
  opts: {
    label: string;
    year: number;
    status: "available" | "bootstrapping";
    week1KickoffMs?: number;
    week2KickoffMs?: number;
  },
) {
  const defaults = futureKickoffs();
  const week1Kickoff = opts.week1KickoffMs ?? defaults.week1;
  const week2Kickoff = opts.week2KickoffMs ?? defaults.week2;
  return await t.run(async (ctx) => {
    const seasonId = await ctx.db.insert("poolSeasons", {
      label: opts.label,
      year: opts.year,
      status: opts.status,
      usableStartWeek: 1,
      bootstrappedAtMs: Date.now(),
    });

    const homeId = await ctx.db.insert("nflTeams", {
      stableKey: `nfl:kc:${opts.label}`,
      name: "Kansas City Chiefs",
      abbreviation: "KC",
      sportsDbTeamId: `134934_${opts.label}`,
    });
    const awayId = await ctx.db.insert("nflTeams", {
      stableKey: `nfl:buf:${opts.label}`,
      name: "Buffalo Bills",
      abbreviation: "BUF",
      sportsDbTeamId: `134918_${opts.label}`,
    });

    await ctx.db.insert("nflGames", {
      stableKey: `nfl:${opts.label}:w1:buf@kc`,
      seasonId,
      seasonLabel: opts.label,
      week: 1,
      homeTeamId: homeId,
      awayTeamId: awayId,
      scheduledKickoffMs: week1Kickoff,
      lifecycle: "scheduled",
      homeScore: null,
      awayScore: null,
      sportsDbEventId: `evt_${opts.label}_w1`,
    });
    await ctx.db.insert("nflGames", {
      stableKey: `nfl:${opts.label}:w2:buf@kc`,
      seasonId,
      seasonLabel: opts.label,
      week: 2,
      homeTeamId: homeId,
      awayTeamId: awayId,
      scheduledKickoffMs: week2Kickoff,
      lifecycle: "scheduled",
      homeScore: null,
      awayScore: null,
      sportsDbEventId: `evt_${opts.label}_w2`,
    });

    return { seasonId, homeId, awayId };
  });
}

/**
 * Prior-season owned Pool with competitive history + memberships that must
 * never copy into a template-created Pool (acceptance scenario 11).
 */
async function seedPriorPoolWithHistory(
  t: ReturnType<typeof convexTest>,
  opts: {
    ownerId: Id<"participants">;
    adminId: Id<"participants">;
    memberId: Id<"participants">;
    priorSeasonId: Id<"poolSeasons">;
  },
) {
  return await t.run(async (ctx) => {
    const poolId = await ctx.db.insert("pools", {
      name: "Office Survivor 2024",
      type: "survivor",
      seasonId: opts.priorSeasonId,
      startWeek: 2,
      pickLockMode: "weeklyCutoff",
      status: "completed",
      rulesFrozen: true,
      archived: false,
      ownerParticipantId: opts.ownerId,
      createdAtMs: Date.now() - 86_400_000,
      completedAtMs: Date.now() - 3_600_000,
      completedWeek: 10,
    });

    await ctx.db.insert("poolMemberships", {
      poolId,
      participantId: opts.ownerId,
      role: "owner",
      status: "active",
    });
    await ctx.db.insert("poolMemberships", {
      poolId,
      participantId: opts.adminId,
      role: "admin",
      status: "active",
    });
    await ctx.db.insert("poolMemberships", {
      poolId,
      participantId: opts.memberId,
      role: "member",
      status: "active",
    });

    await ctx.db.insert("poolAuditEvents", {
      poolId,
      action: "invite_accepted",
      actorParticipantId: opts.adminId,
      atMs: Date.now() - 50_000,
      metadataJson: JSON.stringify({ note: "prior history" }),
    });

    await ctx.db.insert("survivorPicks", {
      poolId,
      participantId: opts.memberId,
      week: 2,
      locked: true,
      lockedAtMs: Date.now() - 40_000,
      provenance: "authored",
      provisional: false,
      updatedAtMs: Date.now() - 40_000,
    });

    await ctx.db.insert("seasonStandings", {
      poolId,
      participantId: opts.memberId,
      eligibility: "eliminated",
      eliminatedWeek: 2,
      eliminationReason: "loss",
      updatedAtMs: Date.now() - 30_000,
    });

    return { poolId };
  });
}

describe("createPoolFromTemplate (acceptance scenario 11)", () => {
  it("prefills setup only and never copies memberships, picks, standings, or audit", async () => {
    const t = convexTest(schema, modules);
    const { seasonId: priorSeasonId } = await seedSeasonWithSlate(t, {
      label: "2024",
      year: 2024,
      status: "bootstrapping",
    });
    const { seasonId: availableSeasonId } = await seedSeasonWithSlate(t, {
      label: "2025",
      year: 2025,
      status: "available",
    });

    const asAlex = t.withIdentity(fullyVerifiedIdentity());
    const asBlake = t.withIdentity(blakeIdentity());
    const asCasey = t.withIdentity(caseyIdentity());

    const { participantId: alexId } = await asAlex.mutation(
      api.participants.ensureMyParticipant,
      {},
    );
    const { participantId: blakeId } = await asBlake.mutation(
      api.participants.ensureMyParticipant,
      {},
    );
    const { participantId: caseyId } = await asCasey.mutation(
      api.participants.ensureMyParticipant,
      {},
    );

    const { poolId: sourcePoolId } = await seedPriorPoolWithHistory(t, {
      ownerId: alexId,
      adminId: blakeId,
      memberId: caseyId,
      priorSeasonId,
    });

    const templates = await asAlex.query(api.poolTemplates.listMyTemplates, {});
    expect(templates).toHaveLength(1);
    expect(templates[0]).toMatchObject({
      poolId: sourcePoolId,
      name: "Office Survivor 2024",
      type: "survivor",
      pickLockMode: "weeklyCutoff",
      startWeek: 2,
    });

    const created = await asAlex.mutation(
      api.poolTemplates.createPoolFromTemplate,
      {
        sourcePoolId,
        returningInvites: [
          { participantId: blakeId, proposedRole: "admin" },
          { participantId: caseyId, proposedRole: "member" },
        ],
      },
    );

    expect(created.status).toBe("active");
    expect(created.seasonId).toEqual(availableSeasonId);
    expect(created.startWeek).toBe(2);
    expect(created.type).toBe("survivor");
    expect(created.pickLockMode).toBe("weeklyCutoff");
    expect(created.name).toBe("Office Survivor 2024");
    expect(created.inviteUrl).toMatch(/^\/join\/[0-9a-f]{64}$/);
    expect(created.expiresAtMs).toBeGreaterThan(Date.now());

    const newPool = await t.run(async (ctx) => ctx.db.get(created.poolId));
    expect(newPool).toMatchObject({
      name: "Office Survivor 2024",
      type: "survivor",
      seasonId: availableSeasonId,
      startWeek: 2,
      pickLockMode: "weeklyCutoff",
      status: "active",
      rulesFrozen: false,
      ownerParticipantId: alexId,
    });

    // Only Owner membership — nobody auto-enrolled from template.
    const memberships = await t.run(async (ctx) =>
      ctx.db
        .query("poolMemberships")
        .withIndex("by_poolId", (q) => q.eq("poolId", created.poolId))
        .collect(),
    );
    expect(memberships).toHaveLength(1);
    expect(memberships[0]).toMatchObject({
      participantId: alexId,
      role: "owner",
      status: "active",
    });

    const ordinaryInvites = await t.run(async (ctx) =>
      ctx.db
        .query("poolInvites")
        .withIndex("by_poolId", (q) => q.eq("poolId", created.poolId))
        .collect(),
    );
    expect(ordinaryInvites).toHaveLength(1);
    expect(ordinaryInvites[0]).toMatchObject({
      status: "active",
      createdByParticipantId: alexId,
      expiresAtMs: created.expiresAtMs,
    });
    expect(created.inviteUrl).toBe(
      `/join/${ordinaryInvites[0]!.credentialSecret}`,
    );

    const picks = await t.run(async (ctx) =>
      ctx.db
        .query("survivorPicks")
        .withIndex("by_poolId_and_participantId", (q) =>
          q.eq("poolId", created.poolId).eq("participantId", caseyId),
        )
        .collect(),
    );
    expect(picks).toHaveLength(0);

    const standings = await t.run(async (ctx) =>
      ctx.db
        .query("seasonStandings")
        .withIndex("by_poolId", (q) => q.eq("poolId", created.poolId))
        .collect(),
    );
    expect(standings).toHaveLength(0);

    const audits = await t.run(async (ctx) =>
      ctx.db
        .query("poolAuditEvents")
        .withIndex("by_poolId_and_atMs", (q) => q.eq("poolId", created.poolId))
        .collect(),
    );
    // May include returning_invite_created — never prior-pool invite_accepted.
    expect(audits.every((e) => e.action !== "invite_accepted")).toBe(true);
    expect(
      audits.every(
        (e) =>
          e.metadataJson === undefined ||
          !e.metadataJson.includes("prior history"),
      ),
    ).toBe(true);

    // Returning invites exist as pending — not memberships.
    expect(created.returningInvites).toHaveLength(2);
    for (const invite of created.returningInvites) {
      expect(invite.url).toMatch(/^\/return\//);
      expect(invite.status).toBe("pending");
    }
  });

  it("falls back when prior Start Week is no longer valid for Available Season", async () => {
    const t = convexTest(schema, modules);
    const { seasonId: priorSeasonId } = await seedSeasonWithSlate(t, {
      label: "2024",
      year: 2024,
      status: "bootstrapping",
    });
    // Available season: only week 1 is still in the future; week 2 already kicked off.
    await seedSeasonWithSlate(t, {
      label: "2025",
      year: 2025,
      status: "available",
      week1KickoffMs: Date.now() + 7 * 24 * 60 * 60 * 1000,
      week2KickoffMs: Date.now() - 60_000,
    });

    const asAlex = t.withIdentity(fullyVerifiedIdentity());
    const { participantId: alexId } = await asAlex.mutation(
      api.participants.ensureMyParticipant,
      {},
    );

    const sourcePoolId = await t.run(async (ctx) => {
      const poolId = await ctx.db.insert("pools", {
        name: "Late Starter",
        type: "confidence",
        seasonId: priorSeasonId,
        startWeek: 2,
        pickLockMode: "gameKickoff",
        status: "completed",
        rulesFrozen: true,
        archived: false,
        ownerParticipantId: alexId,
        createdAtMs: Date.now(),
      });
      await ctx.db.insert("poolMemberships", {
        poolId,
        participantId: alexId,
        role: "owner",
        status: "active",
      });
      return poolId;
    });

    const created = await asAlex.mutation(
      api.poolTemplates.createPoolFromTemplate,
      { sourcePoolId },
    );
    expect(created.startWeek).toBe(1);
    expect(created.type).toBe("confidence");
    expect(created.pickLockMode).toBe("gameKickoff");
  });
});

describe("returning Participant Invites", () => {
  it("are person-specific, single-use, and require explicit accept before enroll", async () => {
    const t = convexTest(schema, modules);
    const { seasonId: priorSeasonId } = await seedSeasonWithSlate(t, {
      label: "2024",
      year: 2024,
      status: "bootstrapping",
    });
    await seedSeasonWithSlate(t, {
      label: "2025",
      year: 2025,
      status: "available",
    });

    const asAlex = t.withIdentity(fullyVerifiedIdentity());
    const asBlake = t.withIdentity(blakeIdentity());
    const asCasey = t.withIdentity(caseyIdentity());

    const { participantId: alexId } = await asAlex.mutation(
      api.participants.ensureMyParticipant,
      {},
    );
    const { participantId: blakeId } = await asBlake.mutation(
      api.participants.ensureMyParticipant,
      {},
    );
    const { participantId: caseyId } = await asCasey.mutation(
      api.participants.ensureMyParticipant,
      {},
    );

    const { poolId: sourcePoolId } = await seedPriorPoolWithHistory(t, {
      ownerId: alexId,
      adminId: blakeId,
      memberId: caseyId,
      priorSeasonId,
    });

    const created = await asAlex.mutation(
      api.poolTemplates.createPoolFromTemplate,
      {
        sourcePoolId,
        returningInvites: [
          { participantId: blakeId, proposedRole: "member" },
        ],
      },
    );
    const inviteUrl = created.returningInvites[0]!.url;
    const rawToken = inviteUrl.replace("/return/", "");

    // Wrong person cannot accept.
    await expect(
      asCasey.mutation(api.poolTemplates.acceptReturningInvite, {
        token: rawToken,
        acknowledgedContactVisibility: true,
      }),
    ).rejects.toThrow(/unavailable|not (for|intended)|Returning/i);

    // Opening / preview alone does not enroll.
    const preview = await asBlake.query(
      api.poolTemplates.previewReturningInvite,
      { token: rawToken },
    );
    expect(preview).toMatchObject({
      poolId: created.poolId,
      proposedRole: "member",
      alreadyMember: false,
    });
    const beforeAccept = await t.run(async (ctx) =>
      ctx.db
        .query("poolMemberships")
        .withIndex("by_poolId_and_participantId", (q) =>
          q.eq("poolId", created.poolId).eq("participantId", blakeId),
        )
        .unique(),
    );
    expect(beforeAccept).toBeNull();

    // Disclosure required.
    await expect(
      asBlake.mutation(api.poolTemplates.acceptReturningInvite, {
        token: rawToken,
        acknowledgedContactVisibility: false,
      }),
    ).rejects.toThrow(/disclosure/i);

    const accepted = await asBlake.mutation(
      api.poolTemplates.acceptReturningInvite,
      {
        token: rawToken,
        acknowledgedContactVisibility: true,
      },
    );
    expect(accepted).toMatchObject({
      poolId: created.poolId,
      role: "member",
      created: true,
    });

    // Single-use: second accept is idempotent for already-active, not a new row.
    const again = await asBlake.mutation(
      api.poolTemplates.acceptReturningInvite,
      {
        token: rawToken,
        acknowledgedContactVisibility: true,
      },
    );
    expect(again.created).toBe(false);

    const memberships = await t.run(async (ctx) =>
      ctx.db
        .query("poolMemberships")
        .withIndex("by_poolId", (q) => q.eq("poolId", created.poolId))
        .collect(),
    );
    expect(memberships.filter((m) => m.participantId === blakeId)).toHaveLength(
      1,
    );
  });
});

describe("proposed Admin via Returning Participant Invite", () => {
  it("is Owner-only to create and grants Admin only after explicit accept", async () => {
    const t = convexTest(schema, modules);
    const { seasonId: priorSeasonId } = await seedSeasonWithSlate(t, {
      label: "2024",
      year: 2024,
      status: "bootstrapping",
    });
    await seedSeasonWithSlate(t, {
      label: "2025",
      year: 2025,
      status: "available",
    });

    const asAlex = t.withIdentity(fullyVerifiedIdentity());
    const asBlake = t.withIdentity(blakeIdentity());
    const asCasey = t.withIdentity(caseyIdentity());

    const { participantId: alexId } = await asAlex.mutation(
      api.participants.ensureMyParticipant,
      {},
    );
    const { participantId: blakeId } = await asBlake.mutation(
      api.participants.ensureMyParticipant,
      {},
    );
    const { participantId: caseyId } = await asCasey.mutation(
      api.participants.ensureMyParticipant,
      {},
    );

    const { poolId: sourcePoolId } = await seedPriorPoolWithHistory(t, {
      ownerId: alexId,
      adminId: blakeId,
      memberId: caseyId,
      priorSeasonId,
    });

    // Non-owner of source cannot template it.
    await expect(
      asBlake.mutation(api.poolTemplates.createPoolFromTemplate, {
        sourcePoolId,
        returningInvites: [
          { participantId: caseyId, proposedRole: "admin" },
        ],
      }),
    ).rejects.toThrow(/Owner|template/i);

    const created = await asAlex.mutation(
      api.poolTemplates.createPoolFromTemplate,
      {
        sourcePoolId,
        returningInvites: [
          { participantId: blakeId, proposedRole: "admin" },
        ],
      },
    );

    const inviteUrl = created.returningInvites[0]!.url;
    expect(created.returningInvites[0]!.proposedRole).toBe("admin");

    // Pending invite does not grant Admin until accept.
    const pendingMembership = await t.run(async (ctx) =>
      ctx.db
        .query("poolMemberships")
        .withIndex("by_poolId_and_participantId", (q) =>
          q.eq("poolId", created.poolId).eq("participantId", blakeId),
        )
        .unique(),
    );
    expect(pendingMembership).toBeNull();

    const accepted = await asBlake.mutation(
      api.poolTemplates.acceptReturningInvite,
      {
        token: inviteUrl,
        acknowledgedContactVisibility: true,
      },
    );
    expect(accepted.role).toBe("admin");

    const membership = await t.run(async (ctx) =>
      ctx.db
        .query("poolMemberships")
        .withIndex("by_poolId_and_participantId", (q) =>
          q.eq("poolId", created.poolId).eq("participantId", blakeId),
        )
        .unique(),
    );
    expect(membership).toMatchObject({
      role: "admin",
      status: "active",
    });
  });
});
