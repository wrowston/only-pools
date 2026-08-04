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
) {
  await seedSeason(t);
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
});
