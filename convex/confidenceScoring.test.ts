/**
 * Confidence scoring seams — scenarios 15–18, 32–33 + standings query.
 */

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

function blakeIdentity() {
  return fullyVerifiedIdentity({
    subject: "clerk_blake",
    email: "blake@example.com",
    name: "Blake Member",
    phoneNumber: "+15559876543",
    sid: "sess_blake_1",
  });
}

async function seedConfidenceWorld(t: ReturnType<typeof convexTest>) {
  const now = Date.now();
  const week1Kickoff = now + 7 * 24 * 60 * 60 * 1000;
  const week1Game2 = week1Kickoff + 3 * 60 * 60 * 1000;

  return await t.run(async (ctx) => {
    const seasonId = await ctx.db.insert("poolSeasons", {
      label: "2025",
      year: 2025,
      status: "available",
      usableStartWeek: 1,
      bootstrappedAtMs: Date.now(),
    });

    const kc = await ctx.db.insert("nflTeams", {
      stableKey: "nfl:kc",
      name: "Kansas City Chiefs",
      abbreviation: "KC",
      sportsDbTeamId: "134934",
    });
    const buf = await ctx.db.insert("nflTeams", {
      stableKey: "nfl:buf",
      name: "Buffalo Bills",
      abbreviation: "BUF",
      sportsDbTeamId: "134918",
    });
    const phi = await ctx.db.insert("nflTeams", {
      stableKey: "nfl:phi",
      name: "Philadelphia Eagles",
      abbreviation: "PHI",
      sportsDbTeamId: "134936",
    });
    const dal = await ctx.db.insert("nflTeams", {
      stableKey: "nfl:dal",
      name: "Dallas Cowboys",
      abbreviation: "DAL",
      sportsDbTeamId: "134925",
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
      sportsDbEventId: "evt_w1a",
      resultAuthority: "none",
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
      sportsDbEventId: "evt_w1b",
      resultAuthority: "none",
    });

    return {
      seasonId,
      kc,
      buf,
      phi,
      dal,
      game1Id,
      game2Id,
      week1Kickoff,
      week1Game2,
    };
  });
}

async function verifyGame(
  t: ReturnType<typeof convexTest>,
  gameId: Id<"nflGames">,
  homeScore: number,
  awayScore: number,
  status: "FT" | "CANC" = "FT",
  nowMs = Date.now(),
) {
  await t.run(async (ctx) => {
    await ctx.db.patch(gameId, {
      resultAuthority: "verified",
      lifecycle: status === "CANC" ? "canceled" : "terminal",
      homeScore,
      awayScore,
      verifiedResult: {
        homeScore,
        awayScore,
        verifiedAtMs: nowMs,
        status,
      },
      scheduledKickoffMs: Date.now() - 2 * 60 * 60 * 1000,
    });
  });
}

async function createPoolWithBlake(t: ReturnType<typeof convexTest>) {
  const asAlex = t.withIdentity(fullyVerifiedIdentity());
  const { participantId: alexId } = await asAlex.mutation(
    api.participants.ensureMyParticipant,
    {},
  );
  const pool = await asAlex.mutation(api.pools.createPool, {
    name: "Confidence Scoring Pool",
    type: "confidence",
    startWeek: 1,
    pickLockMode: "gameKickoff",
  });

  const asBlake = t.withIdentity(blakeIdentity());
  const { participantId: blakeId } = await asBlake.mutation(
    api.participants.ensureMyParticipant,
    {},
  );
  await t.run(async (ctx) => {
    await ctx.db.insert("poolMemberships", {
      poolId: pool.poolId,
      participantId: blakeId,
      role: "member",
      status: "active",
    });
  });

  return { poolId: pool.poolId, alexId, blakeId, asAlex, asBlake };
}

describe("Confidence scoring (scenarios 15–18, 32–33)", () => {
  it("scores unique values correctly without redistributing (scenario 15)", async () => {
    const t = convexTest(schema, modules);
    const s = await seedConfidenceWorld(t);
    const { poolId, alexId, blakeId, asAlex, asBlake } =
      await createPoolWithBlake(t);

    await asAlex.mutation(api.confidencePicks.ensurePickSheet, {
      poolId,
      week: 1,
    });

    // Default ranking for 2 games: 16, 15
    await asAlex.mutation(api.confidencePicks.autosaveConfidence, {
      poolId,
      week: 1,
      predictions: [
        { gameId: s.game1Id, pickedTeamId: s.kc },
        { gameId: s.game2Id, pickedTeamId: s.phi },
      ],
      tiebreakerPrediction: 40,
    });
    await asBlake.mutation(api.confidencePicks.autosaveConfidence, {
      poolId,
      week: 1,
      predictions: [
        { gameId: s.game1Id, pickedTeamId: s.buf },
        { gameId: s.game2Id, pickedTeamId: s.dal },
      ],
      tiebreakerPrediction: 55,
    });

    await verifyGame(t, s.game1Id, 27, 24);
    await t.mutation(internal.confidenceScoring.applyConfidenceScoringRevision, {
      poolId,
      week: 1,
    });

    const weekly = await t.run(async (ctx) => {
      return await ctx.db
        .query("weeklyStandings")
        .withIndex("by_poolId_and_week", (q) =>
          q.eq("poolId", poolId).eq("week", 1),
        )
        .collect();
    });
    const alexWeek = weekly.find((r) => r.participantId === alexId)!;
    const blakeWeek = weekly.find((r) => r.participantId === blakeId)!;
    expect(alexWeek.points).toBe(16);
    expect(blakeWeek.points).toBe(0);
    // Season must not advance until week fully resolves
    const season = await t.run(async (ctx) => {
      return await ctx.db
        .query("seasonStandings")
        .withIndex("by_poolId", (q) => q.eq("poolId", poolId))
        .collect();
    });
    expect(season.every((r) => (r.seasonPoints ?? 0) === 0)).toBe(true);

    await verifyGame(t, s.game2Id, 21, 10);
    await t.mutation(internal.confidenceScoring.applyConfidenceScoringRevision, {
      poolId,
      week: 1,
    });

    const weekly2 = await t.run(async (ctx) => {
      return await ctx.db
        .query("weeklyStandings")
        .withIndex("by_poolId_and_week", (q) =>
          q.eq("poolId", poolId).eq("week", 1),
        )
        .collect();
    });
    expect(weekly2.find((r) => r.participantId === alexId)!.points).toBe(31);
    expect(weekly2.find((r) => r.participantId === blakeId)!.points).toBe(0);

    const season2 = await t.run(async (ctx) => {
      return await ctx.db
        .query("seasonStandings")
        .withIndex("by_poolId", (q) => q.eq("poolId", poolId))
        .collect();
    });
    expect(season2.find((r) => r.participantId === alexId)!.seasonPoints).toBe(
      31,
    );
    expect(season2.find((r) => r.participantId === blakeId)!.seasonPoints).toBe(
      0,
    );
  });

  it("applies weekly tiebreaker when usable and shares when canceled (scenario 18)", async () => {
    const t = convexTest(schema, modules);
    const s = await seedConfidenceWorld(t);
    const { poolId, alexId, blakeId, asAlex, asBlake } =
      await createPoolWithBlake(t);

    await asAlex.mutation(api.confidencePicks.ensurePickSheet, {
      poolId,
      week: 1,
    });
    // Both pick correctly so points tie
    await asAlex.mutation(api.confidencePicks.autosaveConfidence, {
      poolId,
      week: 1,
      predictions: [
        { gameId: s.game1Id, pickedTeamId: s.kc },
        { gameId: s.game2Id, pickedTeamId: s.phi },
      ],
      tiebreakerPrediction: 40,
    });
    await asBlake.mutation(api.confidencePicks.autosaveConfidence, {
      poolId,
      week: 1,
      predictions: [
        { gameId: s.game1Id, pickedTeamId: s.kc },
        { gameId: s.game2Id, pickedTeamId: s.phi },
      ],
      tiebreakerPrediction: 55,
    });

    await verifyGame(t, s.game1Id, 27, 24);
    // game2 is tiebreaker game (later kickoff); combined = 31 → blake closer (err 24 vs alex 9? wait 40-31=9, 55-31=24)
    await verifyGame(t, s.game2Id, 21, 10);
    await t.mutation(internal.confidenceScoring.applyConfidenceScoringRevision, {
      poolId,
      week: 1,
    });

    const weekly = await t.run(async (ctx) => {
      return await ctx.db
        .query("weeklyStandings")
        .withIndex("by_poolId_and_week", (q) =>
          q.eq("poolId", poolId).eq("week", 1),
        )
        .collect();
    });
    const alex = weekly.find((r) => r.participantId === alexId)!;
    const blake = weekly.find((r) => r.participantId === blakeId)!;
    expect(alex.points).toBe(blake.points);
    expect(alex.rank).toBe(1);
    expect(blake.rank).toBe(2);
    expect(alex.tiebreakerUsable).toBe(true);

    // Cancel tiebreaker game → shared rank
    await verifyGame(t, s.game2Id, 0, 0, "CANC");
    await t.mutation(internal.confidenceScoring.applyConfidenceScoringRevision, {
      poolId,
      week: 1,
    });
    const weeklyCancel = await t.run(async (ctx) => {
      return await ctx.db
        .query("weeklyStandings")
        .withIndex("by_poolId_and_week", (q) =>
          q.eq("poolId", poolId).eq("week", 1),
        )
        .collect();
    });
    expect(weeklyCancel.find((r) => r.participantId === alexId)!.rank).toBe(1);
    expect(weeklyCancel.find((r) => r.participantId === blakeId)!.rank).toBe(1);
  });

  it("is idempotent on identical fingerprint and rejects stale (scenarios 32–33)", async () => {
    const t = convexTest(schema, modules);
    const s = await seedConfidenceWorld(t);
    const { poolId, asAlex } = await createPoolWithBlake(t);

    await asAlex.mutation(api.confidencePicks.ensurePickSheet, {
      poolId,
      week: 1,
    });
    await asAlex.mutation(api.confidencePicks.autosaveConfidence, {
      poolId,
      week: 1,
      predictions: [
        { gameId: s.game1Id, pickedTeamId: s.kc },
        { gameId: s.game2Id, pickedTeamId: s.phi },
      ],
    });

    await verifyGame(t, s.game1Id, 27, 24);
    await verifyGame(t, s.game2Id, 21, 10);

    const first = await t.mutation(
      internal.confidenceScoring.applyConfidenceScoringRevision,
      { poolId, week: 1 },
    );
    expect(first.status).toBe("published");
    if (first.status !== "published") throw new Error("expected published");

    const noop = await t.mutation(
      internal.confidenceScoring.applyConfidenceScoringRevision,
      { poolId, week: 1 },
    );
    expect(noop).toEqual({
      status: "noop",
      reason: "identical_fingerprint",
      revisionNumber: first.revisionNumber,
    });

    const stale = await t.mutation(
      internal.confidenceScoring.applyConfidenceScoringRevision,
      { poolId, week: 1, basisRevisionNumber: 0 },
    );
    expect(stale).toEqual({
      status: "stale",
      reason: "newer_revision_exists",
      revisionNumber: first.revisionNumber,
    });
  });

  it("standings query returns official weekly/season and labels projections (scenario 17)", async () => {
    const t = convexTest(schema, modules);
    const s = await seedConfidenceWorld(t);
    const { poolId, asAlex } = await createPoolWithBlake(t);

    await asAlex.mutation(api.confidencePicks.ensurePickSheet, {
      poolId,
      week: 1,
    });
    await asAlex.mutation(api.confidencePicks.autosaveConfidence, {
      poolId,
      week: 1,
      predictions: [
        { gameId: s.game1Id, pickedTeamId: s.kc },
        { gameId: s.game2Id, pickedTeamId: s.phi },
      ],
    });

    await verifyGame(t, s.game1Id, 27, 24);
    await t.mutation(internal.confidenceScoring.applyConfidenceScoringRevision, {
      poolId,
      week: 1,
    });

    // Mark game2 projected so standings surfaces non-official label
    await t.run(async (ctx) => {
      await ctx.db.patch(s.game2Id, {
        resultAuthority: "projected",
        homeScore: 14,
        awayScore: 7,
      });
    });

    const standings = await asAlex.query(
      api.confidenceScoring.getConfidenceStandings,
      { poolId, week: 1 },
    );
    expect(standings).not.toBeNull();
    expect(standings!.weekly.official).toBe(true);
    expect(standings!.season.official).toBe(true);
    expect(standings!.weekSettled).toBe(false);
    expect(standings!.projectedWeekly?.official).toBe(false);
    expect(standings!.weekly.rows.some((r) => r.isViewer)).toBe(true);
    expect(standings!.season.rows[0]).toMatchObject({
      wins: expect.any(Number),
      losses: expect.any(Number),
    });
    // No Hidden Pick fields
    expect(
      JSON.stringify(standings).includes("pickedTeamId") ||
        JSON.stringify(standings).includes("confidenceValue"),
    ).toBe(false);

    const peek = await asAlex.query(
      api.confidenceScoring.getConfidenceStandingsPeek,
      { poolId, week: 1 },
    );
    expect(peek).not.toBeNull();
    expect(peek!.top5.length).toBeGreaterThan(0);
    expect(peek!.standingsPath).toContain("/standings");
  });

  it("awards zero for locked omission without redistributing values", async () => {
    const t = convexTest(schema, modules);
    const s = await seedConfidenceWorld(t);
    const { poolId, alexId, asAlex } = await createPoolWithBlake(t);

    await asAlex.mutation(api.confidencePicks.ensurePickSheet, {
      poolId,
      week: 1,
    });
    // Start set with only game1 pick; leave game2 blank then lock
    await asAlex.mutation(api.confidencePicks.autosaveConfidence, {
      poolId,
      week: 1,
      predictions: [{ gameId: s.game1Id, pickedTeamId: s.kc }],
    });

    await t.run(async (ctx) => {
      const picks = await ctx.db
        .query("confidencePicks")
        .withIndex("by_poolId_and_week", (q) =>
          q.eq("poolId", poolId).eq("week", 1),
        )
        .collect();
      for (const p of picks) {
        if (p.gameId === s.game2Id) {
          await ctx.db.patch(p._id, {
            locked: true,
            provenance: "omission",
            pickedTeamId: undefined,
          });
        } else {
          await ctx.db.patch(p._id, { locked: true });
        }
      }
    });

    await verifyGame(t, s.game1Id, 27, 24);
    await verifyGame(t, s.game2Id, 21, 10);
    await t.mutation(internal.confidenceScoring.applyConfidenceScoringRevision, {
      poolId,
      week: 1,
    });

    const outcomes = await t.run(async (ctx) => {
      return await ctx.db
        .query("confidencePickOutcomes")
        .withIndex("by_poolId_and_participantId_and_week", (q) =>
          q
            .eq("poolId", poolId)
            .eq("participantId", alexId)
            .eq("week", 1),
        )
        .collect();
    });
    const g2 = outcomes.find((o) => o.gameId === s.game2Id)!;
    expect(g2.outcome).toBe("omission_zero");
    expect(g2.pointsEarned).toBe(0);
    expect(g2.confidenceValue).toBe(15);

    const weekly = await t.run(async (ctx) => {
      return await ctx.db
        .query("weeklyStandings")
        .withIndex("by_poolId_and_participantId_and_week", (q) =>
          q
            .eq("poolId", poolId)
            .eq("participantId", alexId)
            .eq("week", 1),
        )
        .unique();
    });
    expect(weekly!.points).toBe(16);
  });
});
