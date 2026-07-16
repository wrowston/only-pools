/**
 * Survivor scoring seams — scenarios 32–34 + revision idempotency.
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

function caseyIdentity() {
  return fullyVerifiedIdentity({
    subject: "clerk_casey",
    email: "casey@example.com",
    name: "Casey Member",
    phoneNumber: "+15551112222",
    sid: "sess_casey_1",
  });
}

async function seedSurvivorWorld(
  t: ReturnType<typeof convexTest>,
  opts: {
    includeWeek2?: boolean;
  } = {},
) {
  const now = Date.now();
  // Keep kickoffs in the future so Create Pool / autosave succeed; tests
  // patch kickoffs earlier when they need locks or Verified Results.
  const week1Kickoff = now + 7 * 24 * 60 * 60 * 1000;
  const week2Kickoff = now + 14 * 24 * 60 * 60 * 1000;

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
      logoUrl:
        "https://r2.thesportsdb.com/images/media/team/badge/936t161515847222.png",
      sportsDbTeamId: "134934",
    });
    const buf = await ctx.db.insert("nflTeams", {
      stableKey: "nfl:buf",
      name: "Buffalo Bills",
      abbreviation: "BUF",
      logoUrl:
        "https://r2.thesportsdb.com/images/media/team/badge/6pb37b1515849026.png",
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
      lifecycle: "scheduled",
      homeScore: null,
      awayScore: null,
      sportsDbEventId: "evt_w1",
      resultAuthority: "none",
    });

    let week2GameId: Id<"nflGames"> | null = null;
    if (opts.includeWeek2 !== false) {
      week2GameId = await ctx.db.insert("nflGames", {
        stableKey: "nfl:2025:w2:dal@phi",
        seasonId,
        seasonLabel: "2025",
        week: 2,
        homeTeamId: phi,
        awayTeamId: dal,
        scheduledKickoffMs: week2Kickoff,
        lifecycle: "scheduled",
        homeScore: null,
        awayScore: null,
        sportsDbEventId: "evt_w2",
      });
    }

    return {
      seasonId,
      kc,
      buf,
      phi,
      dal,
      week1GameId,
      week2GameId,
      week1Kickoff,
      week2Kickoff,
    };
  });
}

async function moveKickoffPast(
  t: ReturnType<typeof convexTest>,
  gameId: Id<"nflGames">,
) {
  await t.run(async (ctx) => {
    await ctx.db.patch(gameId, {
      scheduledKickoffMs: Date.now() - 2 * 60 * 60 * 1000,
      lifecycle: "terminal",
    });
  });
}

async function verifyGame(
  t: ReturnType<typeof convexTest>,
  gameId: Id<"nflGames">,
  homeScore: number,
  awayScore: number,
  nowMs = Date.now(),
) {
  await t.run(async (ctx) => {
    await ctx.db.patch(gameId, {
      resultAuthority: "verified",
      lifecycle: "terminal",
      homeScore,
      awayScore,
      verifiedResult: {
        homeScore,
        awayScore,
        verifiedAtMs: nowMs,
        status: "FT",
      },
    });
  });
}

async function createPoolWithMembers(
  t: ReturnType<typeof convexTest>,
  opts: { startWeek?: number; members?: ("blake" | "casey")[] } = {},
) {
  const asAlex = t.withIdentity(fullyVerifiedIdentity());
  const { participantId: alexId } = await asAlex.mutation(
    api.participants.ensureMyParticipant,
    {},
  );
  const pool = await asAlex.mutation(api.pools.createPool, {
    name: "Survivor Scoring Pool",
    type: "survivor",
    startWeek: opts.startWeek ?? 1,
    pickLockMode: "gameKickoff",
  });

  const memberIds: Record<string, Id<"participants">> = { alex: alexId };

  for (const who of opts.members ?? []) {
    const identity = who === "blake" ? blakeIdentity() : caseyIdentity();
    const asMember = t.withIdentity(identity);
    const { participantId } = await asMember.mutation(
      api.participants.ensureMyParticipant,
      {},
    );
    await t.run(async (ctx) => {
      await ctx.db.insert("poolMemberships", {
        poolId: pool.poolId,
        participantId,
        role: "member",
        status: "active",
      });
    });
    memberIds[who] = participantId;
  }

  return { asAlex, poolId: pool.poolId, memberIds };
}

describe("applySurvivorScoringRevision (scenarios 32–34)", () => {
  it("win keeps Alive; verified loss eliminates permanently (scenario 32)", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedSurvivorWorld(t);
    const { asAlex, poolId, memberIds } = await createPoolWithMembers(t, {
      members: ["blake"],
    });

    await asAlex.mutation(api.survivorPicks.autosaveSurvivorPick, {
      poolId,
      week: 1,
      nflTeamId: seeded.kc,
    });
    const asBlake = t.withIdentity(blakeIdentity());
    await asBlake.mutation(api.survivorPicks.autosaveSurvivorPick, {
      poolId,
      week: 1,
      nflTeamId: seeded.buf,
    });

    await moveKickoffPast(t, seeded.week1GameId);
    await asAlex.mutation(api.survivorPicks.materializeSurvivorLocks, {
      poolId,
      week: 1,
    });

    // KC wins 27-24 → Alex alive, Blake eliminated → sole Winner.
    await verifyGame(t, seeded.week1GameId, 27, 24);

    const published = await t.mutation(
      internal.survivorScoring.applySurvivorScoringRevision,
      { poolId, week: 1 },
    );
    expect(published.status).toBe("published");

    const standings = await asAlex.query(
      api.survivorScoring.getSurvivorStandings,
      { poolId },
    );
    expect(standings).not.toBeNull();
    const alexRow = standings!.rows.find(
      (r) => r.participantId === memberIds.alex,
    );
    const blakeRow = standings!.rows.find(
      (r) => r.participantId === memberIds.blake,
    );
    expect(alexRow?.eligibility).toBe("winner");
    expect(blakeRow?.eligibility).toBe("eliminated");
    expect(blakeRow?.eliminatedWeek).toBe(1);
    expect(blakeRow?.eliminationReason).toBe("loss");

    const pool = await t.run(async (ctx) => ctx.db.get(poolId));
    expect(pool?.status).toBe("completed");
  });

  it("verified tie eliminates (scenario 32)", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedSurvivorWorld(t, { includeWeek2: false });
    const { asAlex, poolId, memberIds } = await createPoolWithMembers(t, {
      members: ["blake"],
    });

    await asAlex.mutation(api.survivorPicks.autosaveSurvivorPick, {
      poolId,
      week: 1,
      nflTeamId: seeded.kc,
    });
    const asBlake = t.withIdentity(blakeIdentity());
    await asBlake.mutation(api.survivorPicks.autosaveSurvivorPick, {
      poolId,
      week: 1,
      nflTeamId: seeded.buf,
    });

    await moveKickoffPast(t, seeded.week1GameId);
    await verifyGame(t, seeded.week1GameId, 20, 20);
    await t.mutation(internal.survivorScoring.applySurvivorScoringRevision, {
      poolId,
      week: 1,
    });

    const standings = await asAlex.query(
      api.survivorScoring.getSurvivorStandings,
      { poolId },
    );
    // Both eliminated on tie → joint winners of entering cohort
    const alex = standings!.rows.find((r) => r.participantId === memberIds.alex);
    const blake = standings!.rows.find(
      (r) => r.participantId === memberIds.blake,
    );
    expect(alex?.eligibility).toBe("winner");
    expect(blake?.eligibility).toBe("winner");
    expect(alex?.eliminationReason).toBe("tie");
    expect(blake?.eliminationReason).toBe("tie");
  });

  it("missing required pick eliminates (scenario 32)", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedSurvivorWorld(t);
    const { asAlex, poolId, memberIds } = await createPoolWithMembers(t, {
      members: ["blake"],
    });

    await asAlex.mutation(api.survivorPicks.autosaveSurvivorPick, {
      poolId,
      week: 1,
      nflTeamId: seeded.kc,
    });
    await moveKickoffPast(t, seeded.week1GameId);
    await asAlex.mutation(api.survivorPicks.materializeSurvivorLocks, {
      poolId,
      week: 1,
    });
    await verifyGame(t, seeded.week1GameId, 27, 24);
    await t.mutation(internal.survivorScoring.applySurvivorScoringRevision, {
      poolId,
      week: 1,
    });

    const standings = await asAlex.query(
      api.survivorScoring.getSurvivorStandings,
      { poolId },
    );
    const blake = standings!.rows.find(
      (r) => r.participantId === memberIds.blake,
    );
    expect(blake?.eligibility).toBe("eliminated");
    expect(blake?.eliminationReason).toBe("missing_pick");
  });

  it("earlier elimination invalidates later provisionals without consuming teams (scenario 33)", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedSurvivorWorld(t);
    const { asAlex, poolId, memberIds } = await createPoolWithMembers(t);

    await asAlex.mutation(api.survivorPicks.autosaveSurvivorPick, {
      poolId,
      week: 1,
      nflTeamId: seeded.kc,
    });
    // Provisional week-2 pick while week 1 still open.
    await asAlex.mutation(api.survivorPicks.autosaveSurvivorPick, {
      poolId,
      week: 2,
      nflTeamId: seeded.phi,
    });

    const before = await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("survivorTeamReservations")
        .withIndex("by_poolId_and_participantId", (q) =>
          q.eq("poolId", poolId).eq("participantId", memberIds.alex!),
        )
        .collect();
      return rows.find((r) => r.nflTeamId === seeded.phi && !r.released);
    });
    expect(before).toBeTruthy();

    await moveKickoffPast(t, seeded.week1GameId);
    // KC loses → Alex eliminated; week-2 provisional invalidated, PHI released.
    await verifyGame(t, seeded.week1GameId, 17, 24);
    await t.mutation(internal.survivorScoring.applySurvivorScoringRevision, {
      poolId,
      week: 1,
    });

    const after = await t.run(async (ctx) => {
      const pick = await ctx.db
        .query("survivorPicks")
        .withIndex("by_poolId_and_participantId_and_week", (q) =>
          q
            .eq("poolId", poolId)
            .eq("participantId", memberIds.alex!)
            .eq("week", 2),
        )
        .unique();
      const res = await ctx.db
        .query("survivorTeamReservations")
        .withIndex("by_poolId_and_participantId_and_nflTeamId", (q) =>
          q
            .eq("poolId", poolId)
            .eq("participantId", memberIds.alex!)
            .eq("nflTeamId", seeded.phi),
        )
        .collect();
      return { pick, res };
    });
    expect(after.pick?.invalidated).toBe(true);
    expect(after.res.every((r) => r.released)).toBe(true);
  });

  it("identical fingerprint is a no-op; stale basis cannot overwrite newer revision", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedSurvivorWorld(t, { includeWeek2: false });
    const { poolId } = await createPoolWithMembers(t);
    const asAlex = t.withIdentity(fullyVerifiedIdentity());
    await asAlex.mutation(api.survivorPicks.autosaveSurvivorPick, {
      poolId,
      week: 1,
      nflTeamId: seeded.kc,
    });
    await moveKickoffPast(t, seeded.week1GameId);
    await verifyGame(t, seeded.week1GameId, 27, 24);

    const first = await t.mutation(
      internal.survivorScoring.applySurvivorScoringRevision,
      { poolId, week: 1 },
    );
    expect(first.status).toBe("published");
    if (first.status !== "published") throw new Error("expected published");

    const second = await t.mutation(
      internal.survivorScoring.applySurvivorScoringRevision,
      { poolId, week: 1 },
    );
    expect(second).toEqual({
      status: "noop",
      reason: "identical_fingerprint",
      revisionNumber: first.revisionNumber,
    });

    const stale = await t.mutation(
      internal.survivorScoring.applySurvivorScoringRevision,
      { poolId, week: 1, basisRevisionNumber: 0 },
    );
    expect(stale).toEqual({
      status: "stale",
      reason: "newer_revision_exists",
      revisionNumber: first.revisionNumber,
    });
  });

  it("multiple Alive after final week become joint winners", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const world = await t.run(async (ctx) => {
      const seasonId = await ctx.db.insert("poolSeasons", {
        label: "2025",
        year: 2025,
        status: "available",
        usableStartWeek: 18,
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
      const gameId = await ctx.db.insert("nflGames", {
        stableKey: "nfl:2025:w18:buf@kc",
        seasonId,
        seasonLabel: "2025",
        week: 18,
        homeTeamId: kc,
        awayTeamId: buf,
        scheduledKickoffMs: now + 7 * 24 * 60 * 60 * 1000,
        lifecycle: "scheduled",
        homeScore: null,
        awayScore: null,
        sportsDbEventId: "evt_w18",
        resultAuthority: "none",
      });
      return { seasonId, kc, buf, gameId };
    });

    const { asAlex, poolId, memberIds } = await createPoolWithMembers(t, {
      startWeek: 18,
      members: ["blake"],
    });
    await asAlex.mutation(api.survivorPicks.autosaveSurvivorPick, {
      poolId,
      week: 18,
      nflTeamId: world.kc,
    });
    const asBlake = t.withIdentity(blakeIdentity());
    await asBlake.mutation(api.survivorPicks.autosaveSurvivorPick, {
      poolId,
      week: 18,
      nflTeamId: world.kc,
    });
    await moveKickoffPast(t, world.gameId);
    await verifyGame(t, world.gameId, 30, 10);
    await t.mutation(internal.survivorScoring.applySurvivorScoringRevision, {
      poolId,
      week: 18,
    });

    const standings = await asAlex.query(
      api.survivorScoring.getSurvivorStandings,
      { poolId },
    );
    expect(
      standings!.rows.filter((r) => r.eligibility === "winner"),
    ).toHaveLength(2);
    expect(standings!.poolStatus).toBe("completed");
    expect(memberIds.alex).toBeTruthy();
  });

  it("standings query denies non-members", async () => {
    const t = convexTest(schema, modules);
    await seedSurvivorWorld(t, { includeWeek2: false });
    const { poolId } = await createPoolWithMembers(t);
    const asBlake = t.withIdentity(blakeIdentity());
    await asBlake.mutation(api.participants.ensureMyParticipant, {});
    const denied = await asBlake.query(api.survivorScoring.getSurvivorStandings, {
      poolId,
    });
    expect(denied).toBeNull();
  });

  it("standings grid reveals locked picks with outcomes and hides unlocked", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedSurvivorWorld(t, { includeWeek2: false });
    const { asAlex, poolId, memberIds } = await createPoolWithMembers(t, {
      members: ["blake"],
    });

    await asAlex.mutation(api.survivorPicks.autosaveSurvivorPick, {
      poolId,
      week: 1,
      nflTeamId: seeded.kc,
    });
    const asBlake = t.withIdentity(blakeIdentity());
    await asBlake.mutation(api.survivorPicks.autosaveSurvivorPick, {
      poolId,
      week: 1,
      nflTeamId: seeded.buf,
    });

    // Before lock: Alex sees own team, Blake's pick is hidden.
    const hidden = await asAlex.query(
      api.survivorScoring.getSurvivorStandingsGrid,
      { poolId },
    );
    expect(hidden).not.toBeNull();
    expect(hidden!.weeks[0]).toBe(1);
    const alexHidden = hidden!.rows.find(
      (r) => r.participantId === memberIds.alex,
    );
    const blakeHidden = hidden!.rows.find(
      (r) => r.participantId === memberIds.blake,
    );
    expect(alexHidden?.cells[0]).toMatchObject({
      revealed: true,
      hasPick: true,
      teamAbbreviation: "KC",
      teamName: "Kansas City Chiefs",
      teamLogoUrl:
        "https://r2.thesportsdb.com/images/media/team/badge/936t161515847222.png",
    });
    expect(blakeHidden?.cells[0]).toMatchObject({
      revealed: false,
      hasPick: true,
      teamAbbreviation: null,
      teamName: null,
      teamLogoUrl: null,
    });
    expect(JSON.stringify(blakeHidden?.cells[0])).not.toContain("BUF");
    expect(JSON.stringify(blakeHidden?.cells[0])).not.toContain("Buffalo Bills");

    await moveKickoffPast(t, seeded.week1GameId);
    await asAlex.mutation(api.survivorPicks.materializeSurvivorLocks, {
      poolId,
      week: 1,
    });
    await verifyGame(t, seeded.week1GameId, 27, 24);
    await t.mutation(internal.survivorScoring.applySurvivorScoringRevision, {
      poolId,
      week: 1,
    });

    const grid = await asAlex.query(
      api.survivorScoring.getSurvivorStandingsGrid,
      { poolId },
    );
    const alex = grid!.rows.find((r) => r.participantId === memberIds.alex);
    const blake = grid!.rows.find((r) => r.participantId === memberIds.blake);
    expect(alex?.cells[0]).toMatchObject({
      revealed: true,
      teamAbbreviation: "KC",
      teamName: "Kansas City Chiefs",
      teamLogoUrl:
        "https://r2.thesportsdb.com/images/media/team/badge/936t161515847222.png",
      outcome: "win",
    });
    expect(blake?.cells[0]).toMatchObject({
      revealed: true,
      teamAbbreviation: "BUF",
      teamName: "Buffalo Bills",
      teamLogoUrl:
        "https://r2.thesportsdb.com/images/media/team/badge/6pb37b1515849026.png",
      outcome: "loss",
    });
  });
});
