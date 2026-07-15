/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
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

/** Kickoffs relative to wall clock so createPool's Date.now() validation works. */
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
    includeWeek2?: boolean;
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

    if (opts.includeWeek2 !== false) {
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
    }

    return { seasonId, homeId, awayId, week1Kickoff, week2Kickoff };
  });
}

describe("createPool", () => {
  it("refuses create when no Available Season exists", async () => {
    const t = convexTest(schema, modules);
    const asAlex = t.withIdentity(fullyVerifiedIdentity());
    await asAlex.mutation(api.participants.ensureMyParticipant, {});

    await expect(
      asAlex.mutation(api.pools.createPool, {
        name: "Office Survivor",
        type: "survivor",
        startWeek: 1,
        pickLockMode: "gameKickoff",
      }),
    ).rejects.toThrow(/No Available Season/);
  });

  it("creates an Active Pool with Owner membership when season is Available", async () => {
    const t = convexTest(schema, modules);
    const { seasonId } = await seedAvailableSeasonWithSlate(t);
    const asAlex = t.withIdentity(fullyVerifiedIdentity());
    const { participantId } = await asAlex.mutation(
      api.participants.ensureMyParticipant,
      {},
    );

    const result = await asAlex.mutation(api.pools.createPool, {
      name: "Office Survivor",
      type: "survivor",
      startWeek: 1,
      pickLockMode: "gameKickoff",
    });

    expect(result.status).toBe("active");
    expect(result.startWeek).toBe(1);
    expect(result.seasonId).toEqual(seasonId);

    const pool = await t.run(async (ctx) => ctx.db.get(result.poolId));
    expect(pool).toMatchObject({
      name: "Office Survivor",
      type: "survivor",
      seasonId,
      startWeek: 1,
      pickLockMode: "gameKickoff",
      status: "active",
      rulesFrozen: false,
      ownerParticipantId: participantId,
    });

    const memberships = await t.run(async (ctx) =>
      ctx.db
        .query("poolMemberships")
        .withIndex("by_poolId", (q) => q.eq("poolId", result.poolId))
        .collect(),
    );
    expect(memberships).toHaveLength(1);
    expect(memberships[0]).toMatchObject({
      participantId,
      role: "owner",
      status: "active",
    });
  });

  it("rejects Start Week with missing slate", async () => {
    const t = convexTest(schema, modules);
    await seedAvailableSeasonWithSlate(t);
    const asAlex = t.withIdentity(fullyVerifiedIdentity());
    await asAlex.mutation(api.participants.ensureMyParticipant, {});

    await expect(
      asAlex.mutation(api.pools.createPool, {
        name: "Bad Week",
        type: "confidence",
        startWeek: 18,
        pickLockMode: "weeklyCutoff",
      }),
    ).rejects.toThrow(/no published slate/);
  });

  it("rejects Start Week whose first game has kicked off", async () => {
    const t = convexTest(schema, modules);
    await seedAvailableSeasonWithSlate(t, {
      week1KickoffMs: Date.now() - 60_000,
    });
    const asAlex = t.withIdentity(fullyVerifiedIdentity());
    await asAlex.mutation(api.participants.ensureMyParticipant, {});

    await expect(
      asAlex.mutation(api.pools.createPool, {
        name: "Too Late",
        type: "survivor",
        startWeek: 1,
        pickLockMode: "gameKickoff",
      }),
    ).rejects.toThrow(/already kicked off/);
  });

  it("stores Pool Type, season, and Pick Lock mode from create args", async () => {
    const t = convexTest(schema, modules);
    await seedAvailableSeasonWithSlate(t);
    const asAlex = t.withIdentity(fullyVerifiedIdentity());
    await asAlex.mutation(api.participants.ensureMyParticipant, {});

    const result = await asAlex.mutation(api.pools.createPool, {
      name: "Confidence Crew",
      type: "confidence",
      startWeek: 2,
      pickLockMode: "weeklyCutoff",
    });

    const pool = await t.run(async (ctx) => ctx.db.get(result.poolId));
    expect(pool).toMatchObject({
      type: "confidence",
      startWeek: 2,
      pickLockMode: "weeklyCutoff",
    });
  });
});

describe("immutability (acceptance scenarios 8–9)", () => {
  async function createOwnedPool(t: ReturnType<typeof convexTest>) {
    await seedAvailableSeasonWithSlate(t);
    const asAlex = t.withIdentity(fullyVerifiedIdentity());
    await asAlex.mutation(api.participants.ensureMyParticipant, {});
    const created = await asAlex.mutation(api.pools.createPool, {
      name: "Immutable Test",
      type: "survivor",
      startWeek: 1,
      pickLockMode: "gameKickoff",
    });
    return { asAlex, poolId: created.poolId };
  }

  it("cannot change Pool Type or Pool Season after create (scenario 8)", async () => {
    const t = convexTest(schema, modules);
    const { asAlex, poolId } = await createOwnedPool(t);

    // updatePoolRules has no type/season args — identity fields are not in the API.
    await asAlex.mutation(api.pools.updatePoolRules, {
      poolId,
      startWeek: 2,
    });

    const pool = await t.run(async (ctx) => ctx.db.get(poolId));
    expect(pool!.type).toBe("survivor");
    expect(pool!.startWeek).toBe(2);

    const seasons = await t.run(async (ctx) =>
      ctx.db
        .query("poolSeasons")
        .withIndex("by_status", (q) => q.eq("status", "available"))
        .take(1),
    );
    expect(pool!.seasonId).toEqual(seasons[0]!._id);
  });

  it("allows Start Week and lock mode edits until freeze (scenario 9)", async () => {
    const t = convexTest(schema, modules);
    const { asAlex, poolId } = await createOwnedPool(t);

    await asAlex.mutation(api.pools.updatePoolRules, {
      poolId,
      startWeek: 2,
      pickLockMode: "weeklyCutoff",
      name: "Renamed Pool",
    });

    const pool = await t.run(async (ctx) => ctx.db.get(poolId));
    expect(pool).toMatchObject({
      startWeek: 2,
      pickLockMode: "weeklyCutoff",
      name: "Renamed Pool",
      rulesFrozen: false,
    });
  });

  it("refuses Start Week / lock mode edits after rulesFrozen (scenario 9)", async () => {
    const t = convexTest(schema, modules);
    const { asAlex, poolId } = await createOwnedPool(t);

    await t.mutation(internal.pools.freezePoolRules, { poolId });

    await expect(
      asAlex.mutation(api.pools.updatePoolRules, {
        poolId,
        startWeek: 2,
      }),
    ).rejects.toThrow(/frozen/);

    await expect(
      asAlex.mutation(api.pools.updatePoolRules, {
        poolId,
        pickLockMode: "weeklyCutoff",
      }),
    ).rejects.toThrow(/frozen/);

    // Display name remains editable after freeze.
    await asAlex.mutation(api.pools.updatePoolRules, {
      poolId,
      name: "Still Renamable",
    });
    const pool = await t.run(async (ctx) => ctx.db.get(poolId));
    expect(pool!.name).toBe("Still Renamable");
  });
});

describe("myPools after create", () => {
  it("lists membership with next-action status", async () => {
    const t = convexTest(schema, modules);
    await seedAvailableSeasonWithSlate(t);
    const asAlex = t.withIdentity(fullyVerifiedIdentity());
    await asAlex.mutation(api.participants.ensureMyParticipant, {});

    const created = await asAlex.mutation(api.pools.createPool, {
      name: "Listed Pool",
      type: "survivor",
      startWeek: 1,
      pickLockMode: "gameKickoff",
    });

    const home = await asAlex.query(api.participants.myPools, {});
    expect(home.createPoolEnabled).toBe(true);
    expect(home.memberships).toEqual([
      {
        poolId: created.poolId,
        name: "Listed Pool",
        role: "owner",
        type: "survivor",
        startWeek: 1,
        nextAction: "open_week_board",
      },
    ]);
  });
});

describe("getWeekBoard", () => {
  it("returns published slate for a member", async () => {
    const t = convexTest(schema, modules);
    const { week1Kickoff } = await seedAvailableSeasonWithSlate(t);
    const asAlex = t.withIdentity(fullyVerifiedIdentity());
    await asAlex.mutation(api.participants.ensureMyParticipant, {});

    const created = await asAlex.mutation(api.pools.createPool, {
      name: "Board Pool",
      type: "survivor",
      startWeek: 1,
      pickLockMode: "gameKickoff",
    });

    const board = await asAlex.query(api.pools.getWeekBoard, {
      poolId: created.poolId,
    });

    expect(board.week).toBe(1);
    expect(board.pool.name).toBe("Board Pool");
    expect(board.slate).toHaveLength(1);
    expect(board.slate[0]).toMatchObject({
      scheduledKickoffMs: week1Kickoff,
      homeTeam: { abbreviation: "KC" },
      awayTeam: { abbreviation: "BUF" },
      locked: false,
    });
    expect(board.mySurvivorPick).toBeNull();
    expect(board.participantPickStates).toEqual([]);
  });

  it("denies non-members", async () => {
    const t = convexTest(schema, modules);
    await seedAvailableSeasonWithSlate(t);
    const asAlex = t.withIdentity(fullyVerifiedIdentity());
    await asAlex.mutation(api.participants.ensureMyParticipant, {});
    const created = await asAlex.mutation(api.pools.createPool, {
      name: "Private Pool",
      type: "survivor",
      startWeek: 1,
      pickLockMode: "gameKickoff",
    });

    const asIntruder = t.withIdentity(
      fullyVerifiedIdentity({
        subject: "clerk_intruder",
        email: "intruder@example.com",
        name: "Intruder",
        sid: "sess_intruder_1",
      }),
    );
    await asIntruder.mutation(api.participants.ensureMyParticipant, {});

    await expect(
      asIntruder.query(api.pools.getWeekBoard, {
        poolId: created.poolId as Id<"pools">,
      }),
    ).rejects.toThrow(/Not a member/);
  });
});
