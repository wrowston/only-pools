/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { defaultConfidenceRanking } from "./lib/confidenceScale";

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

async function seedConfidenceSlate(
  t: ReturnType<typeof convexTest>,
  opts: {
    week1KickoffMs?: number;
    week1Game2KickoffMs?: number;
    week1Lifecycle?: "scheduled" | "in_progress" | "terminal";
  } = {},
) {
  const now = Date.now();
  const week1Kickoff = opts.week1KickoffMs ?? now + 7 * 24 * 60 * 60 * 1000;
  const week1Game2 =
    opts.week1Game2KickoffMs ?? week1Kickoff + 3 * 60 * 60 * 1000;
  const lifecycle = opts.week1Lifecycle ?? "scheduled";

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
      lifecycle,
      homeScore: null,
      awayScore: null,
      sportsDbEventId: "evt_w1a",
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

describe("ensurePickSheet — frozen Pick Sheet (window open)", () => {
  it("freezes identical Pick Sheet and default ranking for every eligible participant", async () => {
    const t = convexTest(schema, modules);
    const s = await seedConfidenceSlate(t);
    const alex = t.withIdentity(fullyVerifiedIdentity());
    await alex.mutation(api.participants.ensureMyParticipant, {});
    const p = await alex.mutation(api.pools.createPool, {
      name: "Sheet Pool",
      type: "confidence",
      startWeek: 1,
      pickLockMode: "gameKickoff",
    });

    const blake = t.withIdentity(blakeIdentity());
    const { participantId: blakeId } = await blake.mutation(
      api.participants.ensureMyParticipant,
      {},
    );
    await t.run(async (ctx) => {
      await ctx.db.insert("poolMemberships", {
        poolId: p.poolId,
        participantId: blakeId,
        role: "member",
        status: "active",
      });
    });

    const sheetAlex = await alex.mutation(api.confidencePicks.ensurePickSheet, {
      poolId: p.poolId,
      week: 1,
    });
    const sheetBlake = await blake.mutation(
      api.confidencePicks.ensurePickSheet,
      { poolId: p.poolId, week: 1 },
    );

    expect(sheetAlex.gameIds).toEqual([s.game1Id, s.game2Id]);
    expect(sheetBlake.gameIds).toEqual(sheetAlex.gameIds);
    expect(sheetAlex.defaultRanking).toEqual(defaultConfidenceRanking(2));
    expect(sheetBlake.defaultRanking).toEqual(sheetAlex.defaultRanking);
    expect(sheetAlex.tiebreakerGameId).toEqual(s.game2Id);
    expect(sheetAlex.frozenAtMs).toEqual(sheetBlake.frozenAtMs);

    // Same frozen sheet even if slate later changes — freeze-on-first wins.
    await t.run(async (ctx) => {
      await ctx.db.patch(s.game2Id, {
        scheduledKickoffMs: s.week1Kickoff - 60_000,
      });
    });
    const again = await alex.mutation(api.confidencePicks.ensurePickSheet, {
      poolId: p.poolId,
      week: 1,
    });
    expect(again.gameIds).toEqual([s.game1Id, s.game2Id]);
    expect(again.tiebreakerGameId).toEqual(s.game2Id);
  });
});

describe("autosaveConfidence (acceptance scenario 19)", () => {
  it("persists prediction, atomic reorder, and tiebreaker with unit explanations", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedConfidenceSlate(t);
    const asAlex = t.withIdentity(fullyVerifiedIdentity());
    await asAlex.mutation(api.participants.ensureMyParticipant, {});
    const pool = await asAlex.mutation(api.pools.createPool, {
      name: "Autosave Conf",
      type: "confidence",
      startWeek: 1,
      pickLockMode: "gameKickoff",
    });

    await asAlex.mutation(api.confidencePicks.ensurePickSheet, {
      poolId: pool.poolId,
      week: 1,
    });

    const result = await asAlex.mutation(api.confidencePicks.autosaveConfidence, {
      poolId: pool.poolId,
      week: 1,
      predictions: [{ gameId: seeded.game1Id, pickedTeamId: seeded.kc }],
      confidenceReorder: [
        { gameId: seeded.game1Id, confidenceValue: 15 },
        { gameId: seeded.game2Id, confidenceValue: 16 },
      ],
      tiebreakerPrediction: 41,
    });

    expect(result.saveTrust.status).toBe("saved");
    expect(result.units.predictions).toEqual([
      { gameId: seeded.game1Id, ok: true },
    ]);
    expect(result.units.confidenceReorder).toEqual({ ok: true });
    expect(result.units.tiebreaker).toEqual({ ok: true });

    const mine = await asAlex.query(
      api.confidencePicks.getMyConfidencePickSet,
      { poolId: pool.poolId, week: 1 },
    );
    expect(mine?.origin).toBe("authored");
    expect(mine?.tiebreakerPrediction).toBe(41);
    const g1 = mine?.picks.find((p) => p.gameId === seeded.game1Id);
    expect(g1).toMatchObject({
      pickedTeamId: seeded.kc,
      confidenceValue: 15,
    });

    // Partial multi-edit: locked prediction fails while tiebreaker may succeed
    await t.run(async (ctx) => {
      await ctx.db.patch(seeded.game1Id, {
        scheduledKickoffMs: Date.now() - 1000,
      });
    });
    const partial = await asAlex.mutation(
      api.confidencePicks.autosaveConfidence,
      {
        poolId: pool.poolId,
        week: 1,
        predictions: [{ gameId: seeded.game1Id, pickedTeamId: seeded.buf }],
        tiebreakerPrediction: 55,
      },
    );
    expect(partial.units.predictions[0]?.ok).toBe(false);
    expect(partial.units.predictions[0]).toHaveProperty("explanation");
    expect(partial.units.tiebreaker).toEqual({ ok: true });
    expect(partial.saveTrust.status).toBe("error");
  });
});

describe("Confidence uniqueness and lock rejection (scenarios 20, 23)", () => {
  it("server rejects duplicate confidence values and locked-value edits", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedConfidenceSlate(t);
    const asAlex = t.withIdentity(fullyVerifiedIdentity());
    await asAlex.mutation(api.participants.ensureMyParticipant, {});
    const pool = await asAlex.mutation(api.pools.createPool, {
      name: "Unique Pool",
      type: "confidence",
      startWeek: 1,
      pickLockMode: "gameKickoff",
    });
    await asAlex.mutation(api.confidencePicks.ensurePickSheet, {
      poolId: pool.poolId,
      week: 1,
    });

    const dup = await asAlex.mutation(api.confidencePicks.autosaveConfidence, {
      poolId: pool.poolId,
      week: 1,
      confidenceReorder: [
        { gameId: seeded.game1Id, confidenceValue: 16 },
        { gameId: seeded.game2Id, confidenceValue: 16 },
      ],
    });
    expect(dup.units.confidenceReorder?.ok).toBe(false);
    expect(dup.units.confidenceReorder).toMatchObject({
      explanation: expect.stringMatching(/unique|available/i),
    });

    const outOfRange = await asAlex.mutation(
      api.confidencePicks.autosaveConfidence,
      {
        poolId: pool.poolId,
        week: 1,
        confidenceReorder: [
          { gameId: seeded.game1Id, confidenceValue: 16 },
          { gameId: seeded.game2Id, confidenceValue: 14 },
        ],
      },
    );
    expect(outOfRange.units.confidenceReorder?.ok).toBe(false);

    const badTb = await asAlex.mutation(api.confidencePicks.autosaveConfidence, {
      poolId: pool.poolId,
      week: 1,
      tiebreakerPrediction: 201,
    });
    expect(badTb.units.tiebreaker?.ok).toBe(false);

    // Lock game1 then reject prediction / reorder involving it
    await t.run(async (ctx) => {
      await ctx.db.patch(seeded.game1Id, {
        scheduledKickoffMs: Date.now() - 1000,
      });
    });
    const lockedPred = await asAlex.mutation(
      api.confidencePicks.autosaveConfidence,
      {
        poolId: pool.poolId,
        week: 1,
        predictions: [{ gameId: seeded.game1Id, pickedTeamId: seeded.buf }],
        clientNowMs: Date.now() + 10_000_000,
      },
    );
    expect(lockedPred.units.predictions[0]?.ok).toBe(false);
    if (lockedPred.units.predictions[0]?.ok === false) {
      expect(lockedPred.units.predictions[0].explanation).not.toContain(
        String(seeded.kc),
      );
    }
  });
});

describe("Automatic Confidence Pick Set (acceptance scenario 16)", () => {
  it("materializes home + default ranking for untouched set at first required lock", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedConfidenceSlate(t);
    const asAlex = t.withIdentity(fullyVerifiedIdentity());
    await asAlex.mutation(api.participants.ensureMyParticipant, {});
    const pool = await asAlex.mutation(api.pools.createPool, {
      name: "Auto Pool",
      type: "confidence",
      startWeek: 1,
      pickLockMode: "gameKickoff",
    });

    const blake = t.withIdentity(blakeIdentity());
    const { participantId: blakeId } = await blake.mutation(
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

    // Alex starts a set; Blake never touches.
    await asAlex.mutation(api.confidencePicks.ensurePickSheet, {
      poolId: pool.poolId,
      week: 1,
    });
    await asAlex.mutation(api.confidencePicks.autosaveConfidence, {
      poolId: pool.poolId,
      week: 1,
      predictions: [{ gameId: seeded.game1Id, pickedTeamId: seeded.buf }],
    });

    await t.run(async (ctx) => {
      await ctx.db.patch(seeded.game1Id, {
        scheduledKickoffMs: Date.now() - 1000,
      });
    });

    const mat = await asAlex.mutation(
      api.confidencePicks.materializeConfidenceLocks,
      { poolId: pool.poolId, week: 1 },
    );
    expect(mat.automaticSetCount).toBeGreaterThanOrEqual(1);

    const blakeSet = await blake.query(
      api.confidencePicks.getMyConfidencePickSet,
      { poolId: pool.poolId, week: 1 },
    );
    // Blake may need ensure first to load — materialize already created set.
    expect(blakeSet?.origin).toBe("automatic");
    const g1 = blakeSet?.picks.find((p) => p.gameId === seeded.game1Id);
    const g2 = blakeSet?.picks.find((p) => p.gameId === seeded.game2Id);
    expect(g1).toMatchObject({
      pickedTeamId: seeded.kc, // home
      confidenceValue: 16,
      locked: true,
      provenance: "automatic",
    });
    expect(g2).toMatchObject({
      pickedTeamId: seeded.phi, // home
      confidenceValue: 15,
      locked: false,
      provenance: "automatic",
    });

    // Origin retained after later edit on unlocked game
    await blake.mutation(api.confidencePicks.autosaveConfidence, {
      poolId: pool.poolId,
      week: 1,
      predictions: [{ gameId: seeded.game2Id, pickedTeamId: seeded.dal }],
    });
    const after = await blake.query(
      api.confidencePicks.getMyConfidencePickSet,
      { poolId: pool.poolId, week: 1 },
    );
    expect(after?.origin).toBe("automatic");
  });
});

describe("Weekly Cutoff Lock freezes remaining including tiebreaker (scenario 21)", () => {
  it("rejects remaining edits after Sunday 1pm Eastern cutoff", async () => {
    const t = convexTest(schema, modules);
    // Create with future kickoffs so createPool succeeds, then move slate
    // into a week whose Sunday 1pm ET cutoff is already past.
    const seeded = await seedConfidenceSlate(t);
    const asAlex = t.withIdentity(fullyVerifiedIdentity());
    await asAlex.mutation(api.participants.ensureMyParticipant, {});
    const pool = await asAlex.mutation(api.pools.createPool, {
      name: "Cutoff Pool",
      type: "confidence",
      startWeek: 1,
      pickLockMode: "weeklyCutoff",
    });

    await asAlex.mutation(api.confidencePicks.ensurePickSheet, {
      poolId: pool.poolId,
      week: 1,
    });
    await asAlex.mutation(api.confidencePicks.autosaveConfidence, {
      poolId: pool.poolId,
      week: 1,
      predictions: [{ gameId: seeded.game2Id, pickedTeamId: seeded.phi }],
      tiebreakerPrediction: 40,
    });

    // Past Thursday whose Sunday cutoff is before now; Monday-night game still
    // "scheduled" later but Weekly Cutoff freezes remaining including TB.
    const pastThursday = Date.now() - 5 * 24 * 60 * 60 * 1000;
    await t.run(async (ctx) => {
      await ctx.db.patch(seeded.game1Id, {
        scheduledKickoffMs: pastThursday,
      });
      await ctx.db.patch(seeded.game2Id, {
        scheduledKickoffMs: pastThursday + 4 * 24 * 60 * 60 * 1000,
      });
    });

    const rejected = await asAlex.mutation(
      api.confidencePicks.autosaveConfidence,
      {
        poolId: pool.poolId,
        week: 1,
        predictions: [{ gameId: seeded.game2Id, pickedTeamId: seeded.dal }],
        tiebreakerPrediction: 99,
      },
    );
    expect(rejected.units.predictions[0]?.ok).toBe(false);
    expect(rejected.units.tiebreaker?.ok).toBe(false);

    const mat = await asAlex.mutation(
      api.confidencePicks.materializeConfidenceLocks,
      { poolId: pool.poolId, week: 1 },
    );
    expect(mat.tiebreakerLockedCount).toBeGreaterThanOrEqual(1);
  });
});

describe("Hidden Confidence picks until lock (scenarios 22, 37)", () => {
  it("hides unlocked predictions/values from others; reveals provenance after lock", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedConfidenceSlate(t);
    const asAlex = t.withIdentity(fullyVerifiedIdentity());
    await asAlex.mutation(api.participants.ensureMyParticipant, {});
    const pool = await asAlex.mutation(api.pools.createPool, {
      name: "Hidden Conf",
      type: "confidence",
      startWeek: 1,
      pickLockMode: "gameKickoff",
    });

    const blake = t.withIdentity(blakeIdentity());
    const { participantId: blakeId } = await blake.mutation(
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

    await blake.mutation(api.confidencePicks.ensurePickSheet, {
      poolId: pool.poolId,
      week: 1,
    });
    await blake.mutation(api.confidencePicks.autosaveConfidence, {
      poolId: pool.poolId,
      week: 1,
      predictions: [{ gameId: seeded.game1Id, pickedTeamId: seeded.kc }],
      tiebreakerPrediction: 37,
    });

    const ownerBoard = await asAlex.query(api.pools.getWeekBoard, {
      poolId: pool.poolId,
      week: 1,
    });
    const blakeRow = ownerBoard.participantPickStates.find(
      (p) => p.participantId === blakeId,
    );
    expect(blakeRow).toMatchObject({ hasPick: true, locked: false });
    expect(blakeRow).not.toHaveProperty("pickedTeamId");
    expect(blakeRow).not.toHaveProperty("confidenceValue");
    expect(blakeRow).not.toHaveProperty("tiebreakerPrediction");
    const leaked = JSON.stringify(ownerBoard.participantPickStates);
    expect(leaked).not.toContain(String(seeded.kc));
    expect(leaked).not.toMatch(/"confidenceValue"/);

    const audits = await t.run(async (ctx) =>
      ctx.db
        .query("poolAuditEvents")
        .withIndex("by_poolId_and_atMs", (q) => q.eq("poolId", pool.poolId))
        .take(20),
    );
    const joined = audits.map((a) => a.metadataJson ?? "").join("|");
    expect(joined).not.toContain(String(seeded.kc));
    expect(joined).not.toMatch(/\b37\b/);

    await t.run(async (ctx) => {
      await ctx.db.patch(seeded.game1Id, {
        scheduledKickoffMs: Date.now() - 1000,
      });
    });
    await asAlex.mutation(api.confidencePicks.materializeConfidenceLocks, {
      poolId: pool.poolId,
      week: 1,
    });

    const revealed = await asAlex.query(api.pools.getWeekBoard, {
      poolId: pool.poolId,
      week: 1,
    });
    const blakeRevealed = revealed.participantPickStates.find(
      (p) => p.participantId === blakeId,
    );
    expect(blakeRevealed).toMatchObject({
      hasPick: true,
      locked: true,
      provenance: "authored",
    });
    if (blakeRevealed && "picks" in blakeRevealed) {
      const lockedPick = (
        blakeRevealed as {
          picks: Array<{
            gameId: Id<"nflGames">;
            pickedTeamId: Id<"nflTeams"> | null;
          }>;
        }
      ).picks.find((p) => p.gameId === seeded.game1Id);
      expect(lockedPick?.pickedTeamId).toEqual(seeded.kc);
    }
  });
});
