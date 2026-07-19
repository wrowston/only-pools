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

function blakeIdentity() {
  return fullyVerifiedIdentity({
    subject: "clerk_user_2",
    name: "Blake Adult",
    email: "blake@example.com",
    phoneNumber: "+15559876543",
    sid: "sess_blake_1",
  });
}

async function seedAvailableSeasonWithSlate(t: ReturnType<typeof convexTest>) {
  const now = Date.now();
  const week1Kickoff = now + 7 * 24 * 60 * 60 * 1000;
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
      logoUrl: "https://example.com/kc.png",
      sportsDbTeamId: "134934",
    });
    const awayId = await ctx.db.insert("nflTeams", {
      stableKey: "nfl:buf",
      name: "Buffalo Bills",
      abbreviation: "BUF",
      logoUrl: "https://example.com/buf.png",
      sportsDbTeamId: "134918",
    });
    await ctx.db.insert("nflGames", {
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
    return { seasonId, homeId, awayId, week1Kickoff };
  });
}

describe("multi-entry pools", () => {
  it("createPool defaults to maxEntriesPerUser 1 and creates one entry", async () => {
    const t = convexTest(schema, modules);
    await seedAvailableSeasonWithSlate(t);
    const asAlex = t.withIdentity(fullyVerifiedIdentity());
    await asAlex.mutation(api.participants.ensureMyParticipant, {});

    const created = await asAlex.mutation(api.pools.createPool, {
      name: "Office Survivor",
      type: "survivor",
      startWeek: 1,
      pickLockMode: "gameKickoff",
    });

    const entries = await asAlex.query(api.pools.listMyPoolEntries, {
      poolId: created.poolId,
    });
    expect(entries.maxEntriesPerUser).toBe(1);
    expect(entries.entries).toHaveLength(1);
    expect(entries.entries[0]!.entryNumber).toBe(1);
  });

  it("owner can set maxEntriesPerUser on create and member can add entries", async () => {
    const t = convexTest(schema, modules);
    await seedAvailableSeasonWithSlate(t);
    const asAlex = t.withIdentity(fullyVerifiedIdentity());
    await asAlex.mutation(api.participants.ensureMyParticipant, {});

    const created = await asAlex.mutation(api.pools.createPool, {
      name: "Multi Entry",
      type: "survivor",
      startWeek: 1,
      pickLockMode: "gameKickoff",
      maxEntriesPerUser: 3,
    });

    await asAlex.mutation(api.invites.confirmStepUp, {});
    const invite = await asAlex.mutation(api.invites.createOrRetrieveInvite, {
      poolId: created.poolId,
    });
    const rawToken = invite.url.replace("/join/", "");

    const asBlake = t.withIdentity(blakeIdentity());
    await asBlake.mutation(api.participants.ensureMyParticipant, {});
    await asBlake.mutation(api.invites.acceptInvite, {
      token: rawToken,
      acknowledgedContactVisibility: true,
    });

    let mine = await asBlake.query(api.pools.listMyPoolEntries, {
      poolId: created.poolId,
    });
    expect(mine.entries).toHaveLength(1);

    await asBlake.mutation(api.pools.addPoolEntry, {
      poolId: created.poolId,
    });
    mine = await asBlake.query(api.pools.listMyPoolEntries, {
      poolId: created.poolId,
    });
    expect(mine.entries).toHaveLength(2);
    expect(mine.entries.map((e) => e.entryNumber)).toEqual([1, 2]);

    await asBlake.mutation(api.pools.addPoolEntry, {
      poolId: created.poolId,
    });
    await expect(
      asBlake.mutation(api.pools.addPoolEntry, { poolId: created.poolId }),
    ).rejects.toThrow(/at most 3/i);
  });

  it("refuses drop of last entry and of entry with picks", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedAvailableSeasonWithSlate(t);
    const asAlex = t.withIdentity(fullyVerifiedIdentity());
    await asAlex.mutation(api.participants.ensureMyParticipant, {});

    const created = await asAlex.mutation(api.pools.createPool, {
      name: "Drop Rules",
      type: "survivor",
      startWeek: 1,
      pickLockMode: "gameKickoff",
      maxEntriesPerUser: 2,
    });

    const listed = await asAlex.query(api.pools.listMyPoolEntries, {
      poolId: created.poolId,
    });
    const only = listed.entries[0]!;
    await expect(
      asAlex.mutation(api.pools.dropPoolEntry, {
        poolId: created.poolId,
        entryId: only.entryId,
      }),
    ).rejects.toThrow(/last entry|Leave pool/i);

    await asAlex.mutation(api.pools.addPoolEntry, { poolId: created.poolId });
    const two = await asAlex.query(api.pools.listMyPoolEntries, {
      poolId: created.poolId,
    });
    const second = two.entries[1]!;

    await asAlex.mutation(api.survivorPicks.autosaveSurvivorPick, {
      poolId: created.poolId,
      entryId: second.entryId,
      week: 1,
      nflTeamId: seeded.awayId,
    });

    await expect(
      asAlex.mutation(api.pools.dropPoolEntry, {
        poolId: created.poolId,
        entryId: second.entryId,
      }),
    ).rejects.toThrow(/picks/i);

    // Drop unused first entry is OK once there are two.
    await asAlex.mutation(api.pools.dropPoolEntry, {
      poolId: created.poolId,
      entryId: two.entries[0]!.entryId,
    });
    const after = await asAlex.query(api.pools.listMyPoolEntries, {
      poolId: created.poolId,
    });
    expect(after.entries).toHaveLength(1);
    expect(after.entries[0]!.entryId).toBe(second.entryId);
  });

  it("updateMaxEntriesPerUser cannot go below a member's current count", async () => {
    const t = convexTest(schema, modules);
    await seedAvailableSeasonWithSlate(t);
    const asAlex = t.withIdentity(fullyVerifiedIdentity());
    await asAlex.mutation(api.participants.ensureMyParticipant, {});

    const created = await asAlex.mutation(api.pools.createPool, {
      name: "Cap Edit",
      type: "confidence",
      startWeek: 1,
      pickLockMode: "weeklyCutoff",
      maxEntriesPerUser: 3,
    });

    await asAlex.mutation(api.pools.addPoolEntry, { poolId: created.poolId });
    await asAlex.mutation(api.pools.addPoolEntry, { poolId: created.poolId });

    await expect(
      asAlex.mutation(api.pools.updateMaxEntriesPerUser, {
        poolId: created.poolId,
        maxEntriesPerUser: 2,
      }),
    ).rejects.toThrow(/below/i);

    await asAlex.mutation(api.pools.updateMaxEntriesPerUser, {
      poolId: created.poolId,
      maxEntriesPerUser: 3,
    });
  });

  it("survivor one-use teams are independent across a user's entries", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedAvailableSeasonWithSlate(t);
    const asAlex = t.withIdentity(fullyVerifiedIdentity());
    await asAlex.mutation(api.participants.ensureMyParticipant, {});

    const created = await asAlex.mutation(api.pools.createPool, {
      name: "Independent Lives",
      type: "survivor",
      startWeek: 1,
      pickLockMode: "gameKickoff",
      maxEntriesPerUser: 2,
    });

    await asAlex.mutation(api.pools.addPoolEntry, { poolId: created.poolId });
    const mine = await asAlex.query(api.pools.listMyPoolEntries, {
      poolId: created.poolId,
    });
    const [e1, e2] = mine.entries;

    await asAlex.mutation(api.survivorPicks.autosaveSurvivorPick, {
      poolId: created.poolId,
      entryId: e1!.entryId,
      week: 1,
      nflTeamId: seeded.awayId,
    });
    // Same team on entry 2 must be allowed (per-entry one-use).
    await asAlex.mutation(api.survivorPicks.autosaveSurvivorPick, {
      poolId: created.poolId,
      entryId: e2!.entryId,
      week: 1,
      nflTeamId: seeded.awayId,
    });

    const p1 = await asAlex.query(api.survivorPicks.getMySurvivorPick, {
      poolId: created.poolId,
      entryId: e1!.entryId,
      week: 1,
    });
    const p2 = await asAlex.query(api.survivorPicks.getMySurvivorPick, {
      poolId: created.poolId,
      entryId: e2!.entryId,
      week: 1,
    });
    expect(p1?.nflTeamId).toBe(seeded.awayId);
    expect(p2?.nflTeamId).toBe(seeded.awayId);
  });
});
