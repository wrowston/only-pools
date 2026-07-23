/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const OWNER_CLERK = "user_3GYF9xQXL66xX5aTpVwIvUj4bok";

function ownerIdentity() {
  return {
    subject: OWNER_CLERK,
    issuer: "https://viable-eagle-73.clerk.accounts.dev",
    name: "Demo Owner",
    email: "owner@example.com",
    emailVerified: true,
    phoneNumber: "+15551234567",
    phoneNumberVerified: true,
    ageConfirmed: true,
    sid: "sess_owner_1",
  };
}

describe("seedDemoWorld (browse-ready)", () => {
  const prevKind = process.env.DEPLOYMENT_KIND;

  beforeEach(() => {
    process.env.DEPLOYMENT_KIND = "development";
  });

  afterEach(() => {
    if (prevKind === undefined) {
      delete process.env.DEPLOYMENT_KIND;
    } else {
      process.env.DEPLOYMENT_KIND = prevKind;
    }
  });

  it("refuses when DEPLOYMENT_KIND=production", async () => {
    process.env.DEPLOYMENT_KIND = "production";
    const t = convexTest(schema, modules);
    const asOwner = t.withIdentity(ownerIdentity());
    await asOwner.mutation(api.participants.ensureMyParticipant, {});

    await expect(
      t.mutation(internal.seedDemo.seedDemoWorld, {
        ownerClerkUserId: OWNER_CLERK,
      }),
    ).rejects.toThrow(/Dev-only/);
  });

  it("fails when owner participant is missing", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(internal.seedDemo.seedDemoWorld, {
        ownerClerkUserId: OWNER_CLERK,
      }),
    ).rejects.toThrow(/Sign into the app once/);
  });

  it("marks season Available and attaches owner memberships", async () => {
    const t = convexTest(schema, modules);
    const asOwner = t.withIdentity(ownerIdentity());
    await asOwner.mutation(api.participants.ensureMyParticipant, {});

    const result = await t.mutation(internal.seedDemo.seedDemoWorld, {
      ownerClerkUserId: OWNER_CLERK,
      poolCount: 4,
      fakeUserCount: 8,
    });

    expect(result.teamCount).toBe(32);
    expect(result.gameCount).toBeGreaterThan(0);
    expect(result.poolCount).toBe(4);
    expect(result.fakeUserCount).toBe(8);
    expect(result.membershipCount).toBeGreaterThan(4);
    expect(result.survivorPickCount).toBeGreaterThan(0);

    const home = await asOwner.query(api.participants.myPools, {});
    expect(home.createPoolEnabled).toBe(true);
    expect(home.memberships.length).toBe(4);
    expect(home.memberships.every((m) => m.role === "owner")).toBe(true);
    expect(home.memberships.every((m) => m.name.startsWith("Seed · "))).toBe(
      true,
    );

    const survivor = home.memberships.find((m) => m.type === "survivor");
    const confidence = home.memberships.find((m) => m.type === "confidence");
    expect(survivor).toMatchObject({
      boardWeek: 4,
      pickStatus: "pick_saved",
      nextAction: "open_week_board",
      standing: { kind: "survivor", eligibility: "alive" },
    });
    expect(confidence).toMatchObject({
      boardWeek: 4,
      pickStatus: "needs_pick",
      nextAction: "make_pick",
      standing: { kind: "confidence" },
    });

    const season = await t.run(async (ctx) => {
      return await ctx.db.get(result.seasonId);
    });
    expect(season?.status).toBe("available");
    expect(season?.usableStartWeek).toBe(1);

    const slate = await t.run(async (ctx) => {
      const games = await ctx.db
        .query("nflGames")
        .withIndex("by_seasonId", (q) => q.eq("seasonId", result.seasonId))
        .collect();
      const nowMs = Date.now();
      return {
        pastLocked: games
          .filter((g) => g.week <= 3)
          .every(
            (g) =>
              g.scheduledKickoffMs < nowMs &&
              g.kickoffLockReachedAtMs != null &&
              g.lifecycle === "terminal",
          ),
        openWeekHasFutureGames: games.some(
          (g) => g.week === 4 && g.scheduledKickoffMs > nowMs,
        ),
        openWeekHasStartedGame: games.some(
          (g) => g.week === 4 && g.scheduledKickoffMs <= nowMs,
        ),
        futureStartWeeks: [
          ...new Set(
            games
              .filter((g) => g.scheduledKickoffMs > nowMs)
              .map((g) => g.week),
          ),
        ].sort((a, b) => a - b),
      };
    });
    expect(slate.pastLocked).toBe(true);
    expect(slate.openWeekHasFutureGames).toBe(true);
    expect(slate.openWeekHasStartedGame).toBe(true);
    expect(slate.futureStartWeeks).toEqual(
      expect.arrayContaining([5, 6]),
    );
  });

  it("reset replaces prior seed pools without duplicating", async () => {
    const t = convexTest(schema, modules);
    const asOwner = t.withIdentity(ownerIdentity());
    await asOwner.mutation(api.participants.ensureMyParticipant, {});

    await t.mutation(internal.seedDemo.seedDemoWorld, {
      ownerClerkUserId: OWNER_CLERK,
      poolCount: 3,
      fakeUserCount: 5,
    });
    await t.mutation(internal.seedDemo.seedDemoWorld, {
      ownerClerkUserId: OWNER_CLERK,
      poolCount: 3,
      fakeUserCount: 5,
      reset: true,
    });

    const home = await asOwner.query(api.participants.myPools, {});
    expect(home.memberships.length).toBe(3);

    const seedPools = await t.run(async (ctx) => {
      const pools = await ctx.db.query("pools").collect();
      return pools.filter((p) => p.name.startsWith("Seed · "));
    });
    expect(seedPools).toHaveLength(3);
  });
});
