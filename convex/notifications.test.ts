/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { POOL_UPDATE_DEBOUNCE_MS } from "./lib/notificationConfig";
import { resendSink } from "./lib/resendSink";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function fullyVerifiedIdentity(overrides: Record<string, unknown> = {}) {
  return {
    subject: "clerk_user_notify",
    issuer: "https://viable-eagle-73.clerk.accounts.dev",
    name: "Notify User",
    email: "notify@example.com",
    emailVerified: true,
    phoneNumber: "+15551234567",
    phoneNumberVerified: true,
    ageConfirmed: true,
    sid: "sess_notify_1",
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

async function seedSeason(
  t: ReturnType<typeof convexTest>,
  opts: { week1KickoffMs?: number; week2KickoffMs?: number } = {},
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
    });
    const awayId = await ctx.db.insert("nflTeams", {
      stableKey: "nfl:buf",
      name: "Buffalo Bills",
      abbreviation: "BUF",
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
    });
    return { seasonId, homeId, awayId, week1Kickoff, week2Kickoff };
  });
}

async function createSurvivorPool(
  t: ReturnType<typeof convexTest>,
  identity = fullyVerifiedIdentity(),
  seasonOpts: { week1KickoffMs?: number; week2KickoffMs?: number } = {},
) {
  await seedSeason(t, seasonOpts);
  const asUser = t.withIdentity(identity);
  await asUser.mutation(api.participants.ensureMyParticipant, {});
  const pool = await asUser.mutation(api.pools.createPool, {
    name: "Notify Survivor",
    type: "survivor",
    startWeek: 1,
    pickLockMode: "gameKickoff",
  });
  return { asUser, poolId: pool.poolId as Id<"pools"> };
}

async function createConfidencePool(
  t: ReturnType<typeof convexTest>,
  identity = fullyVerifiedIdentity(),
) {
  const now = Date.now();
  const week1Kickoff = now + 7 * 24 * 60 * 60 * 1000;
  const week1Game2 = week1Kickoff + 3 * 60 * 60 * 1000;
  const seeded = await t.run(async (ctx) => {
    const seasonId = await ctx.db.insert("poolSeasons", {
      label: "2025",
      year: 2025,
      status: "available",
      usableStartWeek: 1,
      bootstrappedAtMs: now,
    });
    const kc = await ctx.db.insert("nflTeams", {
      stableKey: "nfl:kc",
      name: "Kansas City Chiefs",
      abbreviation: "KC",
    });
    const buf = await ctx.db.insert("nflTeams", {
      stableKey: "nfl:buf",
      name: "Buffalo Bills",
      abbreviation: "BUF",
    });
    const phi = await ctx.db.insert("nflTeams", {
      stableKey: "nfl:phi",
      name: "Philadelphia Eagles",
      abbreviation: "PHI",
    });
    const dal = await ctx.db.insert("nflTeams", {
      stableKey: "nfl:dal",
      name: "Dallas Cowboys",
      abbreviation: "DAL",
    });
    const game1Id = await ctx.db.insert("nflGames", {
      stableKey: "nfl:2025:w1:buf@kc",
      seasonId,
      seasonLabel: "2025",
      week: 1,
      homeTeamId: kc,
      awayTeamId: buf,
      scheduledKickoffMs: week1Kickoff,
      lifecycle: "scheduled",
      homeScore: null,
      awayScore: null,
    });
    const game2Id = await ctx.db.insert("nflGames", {
      stableKey: "nfl:2025:w1:dal@phi",
      seasonId,
      seasonLabel: "2025",
      week: 1,
      homeTeamId: phi,
      awayTeamId: dal,
      scheduledKickoffMs: week1Game2,
      lifecycle: "scheduled",
      homeScore: null,
      awayScore: null,
    });
    return { seasonId, kc, buf, phi, dal, game1Id, game2Id, week1Kickoff };
  });

  const asUser = t.withIdentity(identity);
  await asUser.mutation(api.participants.ensureMyParticipant, {});
  const pool = await asUser.mutation(api.pools.createPool, {
    name: "Notify Confidence",
    type: "confidence",
    startWeek: 1,
    pickLockMode: "gameKickoff",
  });

  return { asUser, poolId: pool.poolId as Id<"pools">, seeded };
}

describe("notification preferences", () => {
  it("defaults all email prefs on and persists explicit off", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(fullyVerifiedIdentity());
    await asUser.mutation(api.participants.ensureMyParticipant, {});

    const defaults = await asUser.query(
      api.notificationPreferences.getMyNotificationPreferences,
      {},
    );
    expect(defaults).toEqual({
      emailPickReminders: true,
      emailPoolUpdates: true,
      emailWeeklySummary: true,
    });

    const updated = await asUser.mutation(
      api.notificationPreferences.updateMyNotificationPreferences,
      { emailPoolUpdates: false },
    );
    expect(updated.emailPoolUpdates).toBe(false);
    expect(updated.emailPickReminders).toBe(true);
  });
});

describe("pool update notifications", () => {
  beforeEach(() => {
    resendSink.reset();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    resendSink.reset();
  });

  it("coalesces multiple banner edits into one sink email after debounce", async () => {
    const t = convexTest(schema, modules);
    const { asUser, poolId } = await createSurvivorPool(t);

    await asUser.mutation(api.pools.updatePoolBannerMessage, {
      poolId,
      bannerMessage: "Buy-in Friday",
    });
    await asUser.mutation(api.pools.updatePoolBannerMessage, {
      poolId,
      bannerMessage: "Buy-in Saturday",
    });

    expect(resendSink.emails).toHaveLength(0);

    await t.finishAllScheduledFunctions(() => {
      vi.advanceTimersByTime(POOL_UPDATE_DEBOUNCE_MS + 1000);
    });

    expect(resendSink.emails.length).toBeGreaterThanOrEqual(1);
    const subjects = resendSink.emails.map((e) => e.subject);
    expect(subjects.some((s) => s.includes("banner updated"))).toBe(true);
    const mailed = resendSink.emails.find((e) =>
      e.subject.includes("banner updated"),
    );
    expect(mailed?.text).toContain("Buy-in Saturday");
    expect(mailed?.text).not.toContain("Buy-in Friday");
    expect(mailed?.html).toContain("Buy-in Saturday");
    expect(mailed?.html).toContain("#fa5d19");
  });

  it("skips pool update email when pref is off", async () => {
    const t = convexTest(schema, modules);
    const { asUser, poolId } = await createSurvivorPool(t);
    await asUser.mutation(
      api.notificationPreferences.updateMyNotificationPreferences,
      { emailPoolUpdates: false },
    );

    await asUser.mutation(api.pools.updatePoolBannerMessage, {
      poolId,
      bannerMessage: "Quiet banner",
    });
    await t.finishAllScheduledFunctions(() => {
      vi.advanceTimersByTime(POOL_UPDATE_DEBOUNCE_MS + 1000);
    });

    expect(
      resendSink.emails.filter((e) => e.subject.includes("banner")),
    ).toHaveLength(0);
  });
});

describe("pick reminders", () => {
  beforeEach(() => {
    resendSink.reset();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    resendSink.reset();
  });

  it("emails incomplete pickers once and is idempotent on re-fire", async () => {
    const t = convexTest(schema, modules);
    const kickoff = Date.now() + 25 * 60 * 60 * 1000;
    await seedSeason(t, {
      week1KickoffMs: kickoff,
      week2KickoffMs: kickoff + 7 * 24 * 60 * 60 * 1000,
    });
    const asUser = t.withIdentity(fullyVerifiedIdentity());
    await asUser.mutation(api.participants.ensureMyParticipant, {});
    const pool = await asUser.mutation(api.pools.createPool, {
      name: "Reminder Pool",
      type: "survivor",
      startWeek: 1,
      pickLockMode: "gameKickoff",
    });

    await t.mutation(internal.notificationPickReminders.ensureUpcomingPickReminders, {
      nowMs: Date.now(),
    });

    await t.finishAllScheduledFunctions(() => {
      vi.advanceTimersByTime(2 * 60 * 60 * 1000);
    });

    const firstCount = resendSink.emails.filter((e) =>
      e.subject.includes("picks due"),
    ).length;
    expect(firstCount).toBe(1);

    await t.mutation(
      internal.notificationPickReminders.firePickRemindersForPoolWeek,
      {
        poolId: pool.poolId,
        week: 1,
        firstKickoffMs: kickoff,
      },
    );
    await t.finishAllScheduledFunctions(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(
      resendSink.emails.filter((e) => e.subject.includes("picks due")),
    ).toHaveLength(1);
  });

  it("does not email pick reminders after kickoff has passed", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const futureKickoff = now + 25 * 60 * 60 * 1000;
    const { poolId } = await createSurvivorPool(t, fullyVerifiedIdentity(), {
      week1KickoffMs: futureKickoff,
      week2KickoffMs: futureKickoff + 7 * 24 * 60 * 60 * 1000,
    });
    const pastKickoff = now - 60_000;
    await t.run(async (ctx) => {
      const games = await ctx.db.query("nflGames").collect();
      for (const game of games) {
        if (game.week === 1) {
          await ctx.db.patch(game._id, { scheduledKickoffMs: pastKickoff });
        }
      }
    });

    await t.mutation(
      internal.notificationPickReminders.ensureUpcomingPickReminders,
      { nowMs: now },
    );
    const week1Job = await t.run(async (ctx) =>
      ctx.db
        .query("notificationPickReminderJobs")
        .withIndex("by_poolId_and_week", (q) =>
          q.eq("poolId", poolId).eq("week", 1),
        )
        .unique(),
    );
    expect(week1Job).toBeNull();

    await t.mutation(
      internal.notificationPickReminders.firePickRemindersForPoolWeek,
      {
        poolId,
        week: 1,
        firstKickoffMs: pastKickoff,
      },
    );
    await t.finishAllScheduledFunctions(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(
      resendSink.emails.filter((e) => e.subject.includes("picks due")),
    ).toHaveLength(0);
  });

  it("reminds confidence players with partial pick sheets", async () => {
    const t = convexTest(schema, modules);
    const { poolId, seeded } = await createConfidencePool(t);
    const kickoff = seeded.week1Kickoff;

    await t.run(async (ctx) => {
      const membership = await ctx.db
        .query("poolMemberships")
        .withIndex("by_poolId", (q) => q.eq("poolId", poolId))
        .unique();
      if (!membership) throw new Error("missing membership");
      const entry = await ctx.db
        .query("poolEntries")
        .withIndex("by_poolId_and_participantId", (q) =>
          q
            .eq("poolId", poolId)
            .eq("participantId", membership.participantId),
        )
        .unique();
      if (!entry) throw new Error("missing entry");
      const pickSetId = await ctx.db.insert("confidencePickSets", {
        poolId,
        participantId: membership.participantId,
        entryId: entry._id,
        week: 1,
        origin: "authored",
        tiebreakerLocked: false,
        updatedAtMs: Date.now(),
      });
      await ctx.db.insert("confidencePicks", {
        poolId,
        participantId: membership.participantId,
        entryId: entry._id,
        week: 1,
        pickSetId,
        gameId: seeded.game1Id,
        pickedTeamId: seeded.kc,
        confidenceValue: 2,
        locked: false,
        provenance: "authored",
        updatedAtMs: Date.now(),
      });
      await ctx.db.insert("confidencePicks", {
        poolId,
        participantId: membership.participantId,
        entryId: entry._id,
        week: 1,
        pickSetId,
        gameId: seeded.game2Id,
        confidenceValue: 1,
        locked: false,
        provenance: "authored",
        updatedAtMs: Date.now(),
      });
    });

    await t.mutation(
      internal.notificationPickReminders.firePickRemindersForPoolWeek,
      {
        poolId,
        week: 1,
        firstKickoffMs: kickoff,
      },
    );
    await t.finishAllScheduledFunctions(() => {
      vi.advanceTimersByTime(1000);
    });

    const reminder = resendSink.emails.find((e) =>
      e.subject.includes("picks due"),
    );
    expect(reminder).toBeDefined();
    expect(reminder?.text).toMatch(/incomplete|entry/i);
  });
});

describe("weekly summary", () => {
  beforeEach(() => {
    resendSink.reset();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    resendSink.reset();
  });

  it("skips accounts with nothing to report and sends when standings exist", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const futureKickoff = now + 7 * 24 * 60 * 60 * 1000;
    await seedSeason(t, {
      week1KickoffMs: futureKickoff,
      week2KickoffMs: futureKickoff + 7 * 24 * 60 * 60 * 1000,
    });
    const asUser = t.withIdentity(fullyVerifiedIdentity());
    await asUser.mutation(api.participants.ensureMyParticipant, {});
    const pool = await asUser.mutation(api.pools.createPool, {
      name: "Digest Pool",
      type: "survivor",
      startWeek: 1,
      pickLockMode: "gameKickoff",
    });

    const pastKickoff = now - 2 * 24 * 60 * 60 * 1000;
    await t.run(async (ctx) => {
      const games = await ctx.db.query("nflGames").collect();
      for (const game of games) {
        if (game.week === 1) {
          await ctx.db.patch(game._id, { scheduledKickoffMs: pastKickoff });
        }
      }
      const membership = await ctx.db
        .query("poolMemberships")
        .withIndex("by_poolId", (q) => q.eq("poolId", pool.poolId))
        .unique();
      if (!membership) throw new Error("missing membership");
      const entry = await ctx.db
        .query("poolEntries")
        .withIndex("by_poolId_and_participantId", (q) =>
          q
            .eq("poolId", pool.poolId)
            .eq("participantId", membership.participantId),
        )
        .unique();
      if (!entry) throw new Error("missing entry");
      await ctx.db.insert("seasonStandings", {
        poolId: pool.poolId,
        participantId: membership.participantId,
        entryId: entry._id,
        eligibility: "alive",
        updatedAtMs: now,
      });
    });

    const result = await t.mutation(
      internal.notificationWeeklySummary.sendWeeklySummaries,
      { nowMs: now },
    );
    expect(result.week).toBe(1);
    expect(result.sentAccounts).toBe(1);

    await t.finishAllScheduledFunctions(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(
      resendSink.emails.some((e) => e.subject.includes("weekly summary")),
    ).toBe(true);

    // Idempotent second run
    const again = await t.mutation(
      internal.notificationWeeklySummary.sendWeeklySummaries,
      { nowMs: now },
    );
    expect(again.sentAccounts).toBe(0);
  });

  it("does not send when weekly summary pref is off", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const futureKickoff = now + 7 * 24 * 60 * 60 * 1000;
    await seedSeason(t, {
      week1KickoffMs: futureKickoff,
      week2KickoffMs: futureKickoff + 7 * 24 * 60 * 60 * 1000,
    });
    const asUser = t.withIdentity(fullyVerifiedIdentity());
    await asUser.mutation(api.participants.ensureMyParticipant, {});
    const pool = await asUser.mutation(api.pools.createPool, {
      name: "Quiet Digest",
      type: "survivor",
      startWeek: 1,
      pickLockMode: "gameKickoff",
    });
    await asUser.mutation(
      api.notificationPreferences.updateMyNotificationPreferences,
      { emailWeeklySummary: false },
    );

    await t.run(async (ctx) => {
      const games = await ctx.db.query("nflGames").collect();
      for (const game of games) {
        if (game.week === 1) {
          await ctx.db.patch(game._id, {
            scheduledKickoffMs: now - 24 * 60 * 60 * 1000,
          });
        }
      }
      void pool;
    });

    const result = await t.mutation(
      internal.notificationWeeklySummary.sendWeeklySummaries,
      { nowMs: now },
    );
    expect(result.sentAccounts).toBe(0);
  });

  it("prefers available seasons over bootstrapping when resolving summary week", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const futureWeek2 = now + 7 * 24 * 60 * 60 * 1000;
    const futureWeek1 = now + 2 * 24 * 60 * 60 * 1000;
    const pastWeek1 = now - 2 * 24 * 60 * 60 * 1000;
    const pastWeek5 = now - 1 * 24 * 60 * 60 * 1000;

    await t.run(async (ctx) => {
      const homeId = await ctx.db.insert("nflTeams", {
        stableKey: "nfl:kc",
        name: "Kansas City Chiefs",
        abbreviation: "KC",
      });
      const awayId = await ctx.db.insert("nflTeams", {
        stableKey: "nfl:buf",
        name: "Buffalo Bills",
        abbreviation: "BUF",
      });

      const bootstrappingSeasonId = await ctx.db.insert("poolSeasons", {
        label: "2026",
        year: 2026,
        status: "bootstrapping",
        usableStartWeek: 1,
      });
      for (let week = 1; week <= 5; week++) {
        await ctx.db.insert("nflGames", {
          stableKey: `nfl:2026:w${week}:buf@kc`,
          seasonId: bootstrappingSeasonId,
          seasonLabel: "2026",
          week,
          homeTeamId: homeId,
          awayTeamId: awayId,
          scheduledKickoffMs: pastWeek5 - (5 - week) * 24 * 60 * 60 * 1000,
          lifecycle: "terminal",
          homeScore: 21,
          awayScore: 14,
        });
      }

      const availableSeasonId = await ctx.db.insert("poolSeasons", {
        label: "2025",
        year: 2025,
        status: "available",
        usableStartWeek: 1,
        bootstrappedAtMs: now,
      });
      await ctx.db.insert("nflGames", {
        stableKey: "nfl:2025:w1:buf@kc",
        seasonId: availableSeasonId,
        seasonLabel: "2025",
        week: 1,
        homeTeamId: homeId,
        awayTeamId: awayId,
        scheduledKickoffMs: futureWeek1,
        lifecycle: "scheduled",
        homeScore: null,
        awayScore: null,
      });
      await ctx.db.insert("nflGames", {
        stableKey: "nfl:2025:w2:buf@kc",
        seasonId: availableSeasonId,
        seasonLabel: "2025",
        week: 2,
        homeTeamId: homeId,
        awayTeamId: awayId,
        scheduledKickoffMs: futureWeek2,
        lifecycle: "scheduled",
        homeScore: null,
        awayScore: null,
      });
    });

    const asUser = t.withIdentity(fullyVerifiedIdentity());
    await asUser.mutation(api.participants.ensureMyParticipant, {});
    const pool = await asUser.mutation(api.pools.createPool, {
      name: "Available Season Pool",
      type: "survivor",
      startWeek: 1,
      pickLockMode: "gameKickoff",
    });

    await t.run(async (ctx) => {
      const games = await ctx.db.query("nflGames").collect();
      for (const game of games) {
        if (game.seasonLabel === "2025" && game.week === 1) {
          await ctx.db.patch(game._id, {
            scheduledKickoffMs: pastWeek1,
            lifecycle: "terminal",
            homeScore: 17,
            awayScore: 10,
          });
        }
      }

      const membership = await ctx.db
        .query("poolMemberships")
        .withIndex("by_poolId", (q) => q.eq("poolId", pool.poolId))
        .unique();
      if (!membership) throw new Error("missing membership");
      const entry = await ctx.db
        .query("poolEntries")
        .withIndex("by_poolId_and_participantId", (q) =>
          q
            .eq("poolId", pool.poolId)
            .eq("participantId", membership.participantId),
        )
        .unique();
      if (!entry) throw new Error("missing entry");
      await ctx.db.insert("seasonStandings", {
        poolId: pool.poolId,
        participantId: membership.participantId,
        entryId: entry._id,
        eligibility: "alive",
        updatedAtMs: now,
      });
    });

    const result = await t.mutation(
      internal.notificationWeeklySummary.sendWeeklySummaries,
      { nowMs: now },
    );
    expect(result.week).toBe(1);
    expect(result.sentAccounts).toBe(1);
  });
});
