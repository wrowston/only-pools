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
    subject: "clerk_blake",
    email: "blake@example.com",
    name: "Blake Member",
    phoneNumber: "+15559876543",
    sid: "sess_blake_1",
  });
}

async function seedSurvivorSlate(
  t: ReturnType<typeof convexTest>,
  opts: {
    week1KickoffMs?: number;
    week2KickoffMs?: number;
    week1Lifecycle?: "scheduled" | "in_progress" | "terminal";
    extraWeek1Game?: boolean;
  } = {},
) {
  const now = Date.now();
  const week1Kickoff = opts.week1KickoffMs ?? now + 7 * 24 * 60 * 60 * 1000;
  const week2Kickoff = opts.week2KickoffMs ?? now + 14 * 24 * 60 * 60 * 1000;
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

    const week1GameId = await ctx.db.insert("nflGames", {
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
      sportsDbEventId: "evt_w1",
    });

    let week1ExtraGameId: Id<"nflGames"> | null = null;
    if (opts.extraWeek1Game) {
      week1ExtraGameId = await ctx.db.insert("nflGames", {
        stableKey: "nfl:2025:w1:dal@phi",
        seasonId,
        seasonLabel: "2025",
        week: 1,
        homeTeamId: phi,
        awayTeamId: dal,
        scheduledKickoffMs: week1Kickoff + 3 * 60 * 60 * 1000,
        lifecycle: "scheduled",
        homeScore: null,
        awayScore: null,
        sportsDbEventId: "evt_w1b",
      });
    }

    await ctx.db.insert("nflGames", {
      stableKey: "nfl:2025:w2:buf@kc",
      seasonId,
      seasonLabel: "2025",
      week: 2,
      homeTeamId: kc,
      awayTeamId: buf,
      scheduledKickoffMs: week2Kickoff,
      lifecycle: "scheduled",
      homeScore: null,
      awayScore: null,
      sportsDbEventId: "evt_w2",
    });

    return {
      seasonId,
      kc,
      buf,
      phi,
      dal,
      week1GameId,
      week1ExtraGameId,
      week1Kickoff,
      week2Kickoff,
    };
  });
}

describe("autosaveSurvivorPick (acceptance scenario 19)", () => {
  it("persists a team pick without a Save button and returns SaveTrust saved", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedSurvivorSlate(t);
    const asAlex = t.withIdentity(fullyVerifiedIdentity());
    await asAlex.mutation(api.participants.ensureMyParticipant, {});
    const pool = await asAlex.mutation(api.pools.createPool, {
      name: "Autosave Pool",
      type: "survivor",
      startWeek: 1,
      pickLockMode: "gameKickoff",
    });

    const result = await asAlex.mutation(api.survivorPicks.autosaveSurvivorPick, {
      poolId: pool.poolId,
      week: 1,
      nflTeamId: seeded.kc,
    });

    expect(result).toMatchObject({
      saveTrust: { status: "saved" },
      week: 1,
      nflTeamId: seeded.kc,
      locked: false,
      provenance: "authored",
    });
    expect(result.saveTrust.status).toBe("saved");
    if (result.saveTrust.status === "saved") {
      expect(result.saveTrust.savedAtMs).toBeGreaterThan(0);
    }

    const board = await asAlex.query(api.pools.getWeekBoard, {
      poolId: pool.poolId,
      week: 1,
    });
    expect(board.mySurvivorPick).toMatchObject({
      nflTeamId: seeded.kc,
      locked: false,
      provenance: "authored",
    });

    const frozen = await t.run(async (ctx) => ctx.db.get(pool.poolId));
    expect(frozen?.rulesFrozen).toBe(true);
  });

  it("rejects an invalid team not on the week slate with an explained error", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedSurvivorSlate(t, { extraWeek1Game: false });
    const asAlex = t.withIdentity(fullyVerifiedIdentity());
    await asAlex.mutation(api.participants.ensureMyParticipant, {});
    const pool = await asAlex.mutation(api.pools.createPool, {
      name: "Invalid Team Pool",
      type: "survivor",
      startWeek: 1,
      pickLockMode: "gameKickoff",
    });

    // PHI is seeded but not in week 1 when extraWeek1Game is false
    await expect(
      asAlex.mutation(api.survivorPicks.autosaveSurvivorPick, {
        poolId: pool.poolId,
        week: 1,
        nflTeamId: seeded.phi,
      }),
    ).rejects.toThrow(/not eligible|not on the week|Week slate/i);
  });

  it("releases prior reservation and reserves the new team on unlocked change", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedSurvivorSlate(t);
    const asAlex = t.withIdentity(fullyVerifiedIdentity());
    await asAlex.mutation(api.participants.ensureMyParticipant, {});
    const pool = await asAlex.mutation(api.pools.createPool, {
      name: "Reservation Pool",
      type: "survivor",
      startWeek: 1,
      pickLockMode: "gameKickoff",
    });

    await asAlex.mutation(api.survivorPicks.autosaveSurvivorPick, {
      poolId: pool.poolId,
      week: 1,
      nflTeamId: seeded.kc,
    });
    await asAlex.mutation(api.survivorPicks.autosaveSurvivorPick, {
      poolId: pool.poolId,
      week: 1,
      nflTeamId: seeded.buf,
    });

    // KC released — can re-reserve on another week after changing
    const week2 = await asAlex.mutation(api.survivorPicks.autosaveSurvivorPick, {
      poolId: pool.poolId,
      week: 2,
      nflTeamId: seeded.kc,
    });
    expect(week2.nflTeamId).toEqual(seeded.kc);
    expect(week2.provisional).toBe(true);

    // BUF still reserved from week 1 — cannot pick again on week 2
    await expect(
      asAlex.mutation(api.survivorPicks.autosaveSurvivorPick, {
        poolId: pool.poolId,
        week: 2,
        nflTeamId: seeded.buf,
      }),
    ).rejects.toThrow(/already used|already reserved|one-use/i);
  });
});

describe("Game Kickoff Lock rejection (acceptance scenario 20)", () => {
  it("rejects mutation at server kickoff regardless of client-supplied time", async () => {
    const t = convexTest(schema, modules);
    const pastKickoff = Date.now() - 60_000;
    // Seed with future kickoff first so createPool succeeds, then move kickoff.
    const seeded = await seedSurvivorSlate(t);
    const asAlex = t.withIdentity(fullyVerifiedIdentity());
    await asAlex.mutation(api.participants.ensureMyParticipant, {});
    const pool = await asAlex.mutation(api.pools.createPool, {
      name: "Lock Pool",
      type: "survivor",
      startWeek: 1,
      pickLockMode: "gameKickoff",
    });

    await t.run(async (ctx) => {
      await ctx.db.patch(seeded.week1GameId, {
        scheduledKickoffMs: pastKickoff,
      });
    });

    await expect(
      asAlex.mutation(api.survivorPicks.autosaveSurvivorPick, {
        poolId: pool.poolId,
        week: 1,
        nflTeamId: seeded.kc,
        // Client lies about "now" — server must ignore
        clientNowMs: Date.now() + 10_000_000,
      }),
    ).rejects.toThrow(/Pick Lock|kickoff|locked/i);
  });

  it("rejects when provider reports in_progress before scheduled kickoff", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedSurvivorSlate(t);
    const asAlex = t.withIdentity(fullyVerifiedIdentity());
    await asAlex.mutation(api.participants.ensureMyParticipant, {});
    const pool = await asAlex.mutation(api.pools.createPool, {
      name: "Provider Start Pool",
      type: "survivor",
      startWeek: 1,
      pickLockMode: "gameKickoff",
    });

    await t.run(async (ctx) => {
      await ctx.db.patch(seeded.week1GameId, { lifecycle: "in_progress" });
    });

    await expect(
      asAlex.mutation(api.survivorPicks.autosaveSurvivorPick, {
        poolId: pool.poolId,
        week: 1,
        nflTeamId: seeded.buf,
      }),
    ).rejects.toThrow(/Pick Lock|kickoff|locked|started/i);
  });
});

describe("Hidden Picks until lock (acceptance scenarios 22, 37)", () => {
  it("hides unlocked opponent picks from members and Owner; reveals after lock", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedSurvivorSlate(t);
    const asAlex = t.withIdentity(fullyVerifiedIdentity());
    await asAlex.mutation(api.participants.ensureMyParticipant, {});
    const pool = await asAlex.mutation(api.pools.createPool, {
      name: "Hidden Pool",
      type: "survivor",
      startWeek: 1,
      pickLockMode: "gameKickoff",
    });

    // Enroll Blake as member
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

    await asBlake.mutation(api.survivorPicks.autosaveSurvivorPick, {
      poolId: pool.poolId,
      week: 1,
      nflTeamId: seeded.kc,
    });

    // Owner sees completion only — not the team
    const ownerBoard = await asAlex.query(api.pools.getWeekBoard, {
      poolId: pool.poolId,
      week: 1,
    });
    const blakeRow = ownerBoard.participantPickStates.find(
      (p) => p.participantId === blakeId,
    );
    expect(blakeRow).toMatchObject({ hasPick: true, locked: false });
    expect(blakeRow).not.toHaveProperty("nflTeamId");
    expect(blakeRow).not.toHaveProperty("teamAbbreviation");
    // Slate lists scheduled teams; Hidden Pick identity must not appear on rows.
    expect(JSON.stringify(ownerBoard.participantPickStates)).not.toContain(
      String(seeded.kc),
    );
    expect(ownerBoard.mySurvivorPick).toBeNull();

    // Blake sees own pick
    const blakeBoard = await asBlake.query(api.pools.getWeekBoard, {
      poolId: pool.poolId,
      week: 1,
    });
    expect(blakeBoard.mySurvivorPick).toMatchObject({
      nflTeamId: seeded.kc,
      locked: false,
    });

    // Materialize lock after kickoff
    await t.run(async (ctx) => {
      await ctx.db.patch(seeded.week1GameId, {
        scheduledKickoffMs: Date.now() - 1000,
      });
    });
    await asAlex.mutation(api.survivorPicks.materializeSurvivorLocks, {
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
      nflTeamId: seeded.kc,
      provenance: "authored",
    });
  });

  it("omits Hidden Pick team ids from audit metadata and error messages", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedSurvivorSlate(t);
    const asAlex = t.withIdentity(fullyVerifiedIdentity());
    await asAlex.mutation(api.participants.ensureMyParticipant, {});
    const pool = await asAlex.mutation(api.pools.createPool, {
      name: "Audit Pool",
      type: "survivor",
      startWeek: 1,
      pickLockMode: "gameKickoff",
    });

    await asAlex.mutation(api.survivorPicks.autosaveSurvivorPick, {
      poolId: pool.poolId,
      week: 1,
      nflTeamId: seeded.kc,
    });

    const audits = await t.run(async (ctx) =>
      ctx.db
        .query("poolAuditEvents")
        .withIndex("by_poolId_and_atMs", (q) => q.eq("poolId", pool.poolId))
        .take(20),
    );
    const joined = audits.map((a) => a.metadataJson ?? "").join("|");
    expect(joined).not.toContain(String(seeded.kc));
    expect(joined).not.toMatch(/Kansas City|nfl:kc/i);

    // Failed reservation error must not echo the conflicting Hidden team
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
    await asBlake.mutation(api.survivorPicks.autosaveSurvivorPick, {
      poolId: pool.poolId,
      week: 1,
      nflTeamId: seeded.buf,
    });
    // Force lock then attempt change — error path
    await t.run(async (ctx) => {
      await ctx.db.patch(seeded.week1GameId, {
        scheduledKickoffMs: Date.now() - 1000,
      });
    });
    try {
      await asBlake.mutation(api.survivorPicks.autosaveSurvivorPick, {
        poolId: pool.poolId,
        week: 1,
        nflTeamId: seeded.kc,
      });
      expect.unreachable("expected lock rejection");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).not.toContain(String(seeded.buf));
      expect(msg).not.toContain(String(seeded.kc));
      expect(msg).not.toMatch(/Buffalo|Kansas City/i);
    }
  });
});
