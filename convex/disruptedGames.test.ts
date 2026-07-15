/**
 * Disrupted / Corrected games — acceptance scenarios 25–27.
 * Server-authoritative replay tests; no live HTTP.
 */

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import {
  CONFIRMATION_MIN_ELAPSED_MS,
  CONFIRMATION_MIN_SPACING_MS,
} from "./lib/confirmationPolicy";

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

async function seedWorld(t: ReturnType<typeof convexTest>) {
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
      lifecycle: "scheduled",
      homeScore: null,
      awayScore: null,
      sportsDbEventId: "evt_w1",
      resultAuthority: "none",
    });
    const week1Game2Id = await ctx.db.insert("nflGames", {
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
      resultAuthority: "none",
    });
    return {
      seasonId,
      kc,
      buf,
      phi,
      dal,
      week1GameId,
      week1Game2Id,
      week1Kickoff,
    };
  });
}

async function createSurvivorPool(
  t: ReturnType<typeof convexTest>,
  members: ("blake")[] = ["blake"],
) {
  const asAlex = t.withIdentity(fullyVerifiedIdentity());
  const { participantId: alexId } = await asAlex.mutation(
    api.participants.ensureMyParticipant,
    {},
  );
  const pool = await asAlex.mutation(api.pools.createPool, {
    name: "Disruption Survivor",
    type: "survivor",
    startWeek: 1,
    pickLockMode: "gameKickoff",
  });
  const memberIds: Record<string, Id<"participants">> = { alex: alexId };
  for (const who of members) {
    const asMember = t.withIdentity(blakeIdentity());
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

async function createConfidencePool(t: ReturnType<typeof convexTest>) {
  const asAlex = t.withIdentity(fullyVerifiedIdentity());
  await asAlex.mutation(api.participants.ensureMyParticipant, {});
  const pool = await asAlex.mutation(api.pools.createPool, {
    name: "Disruption Confidence",
    type: "confidence",
    startWeek: 1,
    pickLockMode: "gameKickoff",
  });
  return { asAlex, poolId: pool.poolId };
}

describe("scenario 25 — Pick Lock irreversibility under schedule disruption", () => {
  it("latches a reached lock so later kickoff never reopens Survivor edits", async () => {
    const t = convexTest(schema, modules);
    const s = await seedWorld(t);
    const { asAlex, poolId } = await createSurvivorPool(t, []);

    await asAlex.mutation(api.survivorPicks.autosaveSurvivorPick, {
      poolId,
      week: 1,
      nflTeamId: s.kc,
    });

    const nowMs = s.week1Kickoff + 60_000;
    await t.mutation(internal.syncLive.applyScheduleObservation, {
      observation: {
        gameId: s.week1GameId,
        observedAtMs: nowMs,
        scheduledKickoffMs: s.week1Kickoff + 8 * 60 * 60 * 1000,
        lifecycle: "postponed",
      },
    });

    const game = await t.run(async (ctx) => ctx.db.get(s.week1GameId));
    expect(game?.kickoffLockReachedAtMs).not.toBeNull();
    expect(game?.scheduledKickoffMs).toBe(s.week1Kickoff + 8 * 60 * 60 * 1000);

    await asAlex.mutation(api.survivorPicks.materializeSurvivorLocks, {
      poolId,
      week: 1,
    });

    await expect(
      asAlex.mutation(api.survivorPicks.autosaveSurvivorPick, {
        poolId,
        week: 1,
        nflTeamId: s.buf,
      }),
    ).rejects.toThrow(/Pick Lock|locked/i);
  });

  it("moves an unreached lock when authoritative kickoff changes", async () => {
    const t = convexTest(schema, modules);
    const s = await seedWorld(t);
    const { asAlex, poolId } = await createSurvivorPool(t, []);

    await asAlex.mutation(api.survivorPicks.autosaveSurvivorPick, {
      poolId,
      week: 1,
      nflTeamId: s.kc,
    });

    const earlier = s.week1Kickoff - 2 * 60 * 60 * 1000;
    await t.mutation(internal.syncLive.applyScheduleObservation, {
      observation: {
        gameId: s.week1GameId,
        observedAtMs: s.week1Kickoff - 24 * 60 * 60 * 1000,
        scheduledKickoffMs: earlier,
        lifecycle: "scheduled",
      },
    });

    const game = await t.run(async (ctx) => ctx.db.get(s.week1GameId));
    expect(game?.kickoffLockReachedAtMs).toBeUndefined();
    expect(game?.scheduledKickoffMs).toBe(earlier);

    // Still before the new kickoff — edit allowed.
    await asAlex.mutation(api.survivorPicks.autosaveSurvivorPick, {
      poolId,
      week: 1,
      nflTeamId: s.buf,
    });
  });
});

describe("scenario 26 — Survivor and Confidence cancellation paths", () => {
  it("pre-lock Survivor cancel invalidates pick and releases team for replace", async () => {
    const t = convexTest(schema, modules);
    const s = await seedWorld(t);
    const { asAlex, poolId, memberIds } = await createSurvivorPool(t, []);

    await asAlex.mutation(api.survivorPicks.autosaveSurvivorPick, {
      poolId,
      week: 1,
      nflTeamId: s.kc,
    });

    await t.run(async (ctx) => {
      await ctx.db.patch(s.week1GameId, {
        resultAuthority: "verified",
        lifecycle: "canceled",
        homeScore: 0,
        awayScore: 0,
        verifiedResult: {
          homeScore: 0,
          awayScore: 0,
          verifiedAtMs: Date.now(),
          status: "CANC",
        },
      });
    });

    const handled = await t.mutation(
      internal.survivorScoring.handleVerifiedCancellation,
      { gameId: s.week1GameId },
    );
    expect(handled.invalidated).toBe(1);

    const pick = await t.run(async (ctx) => {
      return await ctx.db
        .query("survivorPicks")
        .withIndex("by_poolId_and_participantId_and_week", (q) =>
          q
            .eq("poolId", poolId)
            .eq("participantId", memberIds.alex)
            .eq("week", 1),
        )
        .unique();
    });
    expect(pick?.invalidated).toBe(true);

    const reservation = await t.run(async (ctx) => {
      return await ctx.db
        .query("survivorTeamReservations")
        .withIndex("by_poolId_and_participantId_and_nflTeamId", (q) =>
          q
            .eq("poolId", poolId)
            .eq("participantId", memberIds.alex)
            .eq("nflTeamId", s.kc),
        )
        .unique();
    });
    expect(reservation?.released).toBe(true);

    // Replace with another week-1 game.
    await asAlex.mutation(api.survivorPicks.autosaveSurvivorPick, {
      poolId,
      week: 1,
      nflTeamId: s.phi,
    });
    const replaced = await t.run(async (ctx) => {
      return await ctx.db
        .query("survivorPicks")
        .withIndex("by_poolId_and_participantId_and_week", (q) =>
          q
            .eq("poolId", poolId)
            .eq("participantId", memberIds.alex)
            .eq("week", 1),
        )
        .unique();
    });
    expect(replaced?.invalidated).toBeFalsy();
    expect(replaced?.nflTeamId).toBe(s.phi);
  });

  it("post-lock Survivor cancel yields No-Contest Advance consuming the team", async () => {
    const t = convexTest(schema, modules);
    const s = await seedWorld(t);
    const { asAlex, poolId, memberIds } = await createSurvivorPool(t, ["blake"]);

    await asAlex.mutation(api.survivorPicks.autosaveSurvivorPick, {
      poolId,
      week: 1,
      nflTeamId: s.kc,
    });
    const asBlake = t.withIdentity(blakeIdentity());
    await asBlake.mutation(api.survivorPicks.autosaveSurvivorPick, {
      poolId,
      week: 1,
      nflTeamId: s.phi,
    });

    await t.run(async (ctx) => {
      await ctx.db.patch(s.week1GameId, {
        scheduledKickoffMs: Date.now() - 2 * 60 * 60 * 1000,
      });
      await ctx.db.patch(s.week1Game2Id, {
        scheduledKickoffMs: Date.now() - 60 * 60 * 1000,
      });
    });
    await asAlex.mutation(api.survivorPicks.materializeSurvivorLocks, {
      poolId,
      week: 1,
    });

    await t.run(async (ctx) => {
      await ctx.db.patch(s.week1GameId, {
        resultAuthority: "verified",
        lifecycle: "canceled",
        homeScore: 0,
        awayScore: 0,
        verifiedResult: {
          homeScore: 0,
          awayScore: 0,
          verifiedAtMs: Date.now(),
          status: "CANC",
        },
      });
      await ctx.db.patch(s.week1Game2Id, {
        resultAuthority: "verified",
        lifecycle: "terminal",
        homeScore: 21,
        awayScore: 17,
        verifiedResult: {
          homeScore: 21,
          awayScore: 17,
          verifiedAtMs: Date.now(),
          status: "FT",
        },
      });
    });

    const handled = await t.mutation(
      internal.survivorScoring.handleVerifiedCancellation,
      { gameId: s.week1GameId },
    );
    expect(handled.invalidated).toBe(0);

    await t.mutation(internal.survivorScoring.applySurvivorScoringRevision, {
      poolId,
      week: 1,
    });

    const outcome = await t.run(async (ctx) => {
      return await ctx.db
        .query("survivorPickOutcomes")
        .withIndex("by_poolId_and_participantId_and_week", (q) =>
          q
            .eq("poolId", poolId)
            .eq("participantId", memberIds.alex)
            .eq("week", 1),
        )
        .unique();
    });
    expect(outcome?.outcome).toBe("no_contest_advance");

    const reservation = await t.run(async (ctx) => {
      return await ctx.db
        .query("survivorTeamReservations")
        .withIndex("by_poolId_and_participantId_and_nflTeamId", (q) =>
          q
            .eq("poolId", poolId)
            .eq("participantId", memberIds.alex)
            .eq("nflTeamId", s.kc),
        )
        .unique();
    });
    expect(reservation?.released).toBe(false);

    const standings = await asAlex.query(
      api.survivorScoring.getSurvivorStandings,
      { poolId },
    );
    expect(
      standings!.rows.find((r) => r.participantId === memberIds.alex)
        ?.eligibility,
    ).toBe("alive");
  });

  it("post-freeze Confidence cancel keeps slot, scores 0, no renumber", async () => {
    const t = convexTest(schema, modules);
    const s = await seedWorld(t);
    const { asAlex, poolId } = await createConfidencePool(t);

    await asAlex.mutation(api.confidencePicks.ensurePickSheet, {
      poolId,
      week: 1,
    });
    await asAlex.mutation(api.confidencePicks.autosaveConfidence, {
      poolId,
      week: 1,
      predictions: [
        { gameId: s.week1GameId, pickedTeamId: s.kc },
        { gameId: s.week1Game2Id, pickedTeamId: s.phi },
      ],
    });

    const picksBefore = await t.run(async (ctx) => {
      return await ctx.db
        .query("confidencePicks")
        .withIndex("by_poolId_and_week", (q) =>
          q.eq("poolId", poolId).eq("week", 1),
        )
        .collect();
    });
    const valuesBefore = Object.fromEntries(
      picksBefore.map((p) => [p.gameId, p.confidenceValue]),
    );

    await t.run(async (ctx) => {
      await ctx.db.patch(s.week1GameId, {
        resultAuthority: "verified",
        lifecycle: "canceled",
        homeScore: 0,
        awayScore: 0,
        verifiedResult: {
          homeScore: 0,
          awayScore: 0,
          verifiedAtMs: Date.now(),
          status: "CANC",
        },
      });
      await ctx.db.patch(s.week1Game2Id, {
        resultAuthority: "verified",
        lifecycle: "terminal",
        homeScore: 24,
        awayScore: 17,
        verifiedResult: {
          homeScore: 24,
          awayScore: 17,
          verifiedAtMs: Date.now(),
          status: "FT",
        },
      });
    });

    await t.mutation(internal.confidenceScoring.applyConfidenceScoringRevision, {
      poolId,
      week: 1,
    });

    const outcomes = await t.run(async (ctx) => {
      return await ctx.db
        .query("confidencePickOutcomes")
        .withIndex("by_poolId_and_week", (q) =>
          q.eq("poolId", poolId).eq("week", 1),
        )
        .collect();
    });
    const canceled = outcomes.find((o) => o.gameId === s.week1GameId)!;
    const scored = outcomes.find((o) => o.gameId === s.week1Game2Id)!;
    expect(canceled.outcome).toBe("canceled_zero");
    expect(canceled.pointsEarned).toBe(0);
    expect(canceled.confidenceValue).toBe(valuesBefore[s.week1GameId]);
    expect(scored.confidenceValue).toBe(valuesBefore[s.week1Game2Id]);
    expect(scored.pointsEarned).toBe(valuesBefore[s.week1Game2Id]);

    const picksAfter = await t.run(async (ctx) => {
      return await ctx.db
        .query("confidencePicks")
        .withIndex("by_poolId_and_week", (q) =>
          q.eq("poolId", poolId).eq("week", 1),
        )
        .collect();
    });
    expect(picksAfter).toHaveLength(2);
    for (const p of picksAfter) {
      expect(p.confidenceValue).toBe(valuesBefore[p.gameId]);
    }
  });
});

describe("scenario 27 — Corrected Result replay and authz", () => {
  it("authoritative correction supersedes prior result and may reopen Completed→Active", async () => {
    const t = convexTest(schema, modules);
    const s = await seedWorld(t);
    const { asAlex, poolId, memberIds } = await createSurvivorPool(t, ["blake"]);

    await asAlex.mutation(api.survivorPicks.autosaveSurvivorPick, {
      poolId,
      week: 1,
      nflTeamId: s.kc,
    });
    const asBlake = t.withIdentity(blakeIdentity());
    await asBlake.mutation(api.survivorPicks.autosaveSurvivorPick, {
      poolId,
      week: 1,
      nflTeamId: s.buf,
    });

    await t.run(async (ctx) => {
      await ctx.db.patch(s.week1GameId, {
        scheduledKickoffMs: Date.now() - 2 * 60 * 60 * 1000,
      });
      await ctx.db.patch(s.week1Game2Id, {
        scheduledKickoffMs: Date.now() - 60 * 60 * 1000,
        resultAuthority: "verified",
        lifecycle: "terminal",
        homeScore: 10,
        awayScore: 3,
        verifiedResult: {
          homeScore: 10,
          awayScore: 3,
          verifiedAtMs: Date.now(),
          status: "FT",
        },
      });
    });
    await asAlex.mutation(api.survivorPicks.materializeSurvivorLocks, {
      poolId,
      week: 1,
    });

    // First Verified: KC wins → Alex sole winner → Completed.
    await t.run(async (ctx) => {
      await ctx.db.patch(s.week1GameId, {
        resultAuthority: "verified",
        lifecycle: "terminal",
        homeScore: 27,
        awayScore: 24,
        verifiedResult: {
          homeScore: 27,
          awayScore: 24,
          verifiedAtMs: Date.now(),
          status: "FT",
        },
      });
    });
    await t.mutation(internal.survivorScoring.applySurvivorScoringRevision, {
      poolId,
      week: 1,
    });
    let pool = await t.run(async (ctx) => ctx.db.get(poolId));
    expect(pool?.status).toBe("completed");

    // Correction confirmation: BUF wins instead.
    const t0 = Date.now();
    await t.mutation(internal.syncLive.applyConfirmationObservationMutation, {
      observation: {
        gameId: s.week1GameId,
        observedAtMs: t0,
        homeScore: 20,
        awayScore: 28,
        status: "FT",
      },
    });
    let game = await t.run(async (ctx) => ctx.db.get(s.week1GameId));
    expect(game?.resultAuthority).toBe("correction_candidate");

    await t.mutation(internal.syncLive.applyConfirmationObservationMutation, {
      observation: {
        gameId: s.week1GameId,
        observedAtMs: t0 + CONFIRMATION_MIN_ELAPSED_MS,
        homeScore: 20,
        awayScore: 28,
        status: "FT",
      },
    });
    game = await t.run(async (ctx) => ctx.db.get(s.week1GameId));
    expect(game?.resultAuthority).toBe("verified");
    expect(game?.verifiedResult?.homeScore).toBe(20);
    expect(game?.verifiedResult?.awayScore).toBe(28);
    expect(game?.priorVerifiedResult?.homeScore).toBe(27);

    await t.mutation(internal.survivorScoring.scoreSurvivorPoolsForVerifiedGame, {
      gameId: s.week1GameId,
    });

    pool = await t.run(async (ctx) => ctx.db.get(poolId));
    // Blake (BUF) now sole Alive → still Completed with Blake as winner,
    // OR if both somehow alive — for this flip Alex loses, Blake wins → completed.
    const standings = await asAlex.query(
      api.survivorScoring.getSurvivorStandings,
      { poolId },
    );
    expect(
      standings!.rows.find((r) => r.participantId === memberIds.alex)
        ?.eligibility,
    ).toBe("eliminated");
    expect(
      standings!.rows.find((r) => r.participantId === memberIds.blake)
        ?.eligibility,
    ).toBe("winner");
    expect(pool?.status).toBe("completed");

    // Second correction: tie → both eliminated → joint winners still completed.
    // To reopen Active: correct so both stay Alive (impossible with one game).
    // Use a two-alive reopen: flip to a pending-like unsettled by... actually
    // sole→multiple: add casey? Simpler path — correct score so Alex wins again
    // while we first make Blake winner, then correct to a state with 2 alive.
    // With only week-1 picks on the same game, one of them always loses.
    // Reopen path: sole winner → correction that leaves week unsettled (remove verify).
    // Spec: correction may return Completed→Active. Simulate by verifying a
    // second Alive scenario via joint→none: after joint winners at final week.
    // Practical reopen: sole winner completed, then correction changes outcome
    // to leave multiple Alive without terminal (needs later weeks).
    // Minimal: patch verified to CANC for Alex's game after lock → NCA keeps
    // Alex alive AND Blake's game win → both alive → reopen Active.
    await t.run(async (ctx) => {
      await ctx.db.patch(s.week1GameId, {
        resultAuthority: "verified",
        lifecycle: "canceled",
        homeScore: 0,
        awayScore: 0,
        priorVerifiedResult: {
          homeScore: 20,
          awayScore: 28,
          verifiedAtMs: t0 + CONFIRMATION_MIN_ELAPSED_MS,
          status: "FT",
          supersededAtMs: Date.now(),
        },
        verifiedResult: {
          homeScore: 0,
          awayScore: 0,
          verifiedAtMs: Date.now(),
          status: "CANC",
        },
      });
    });
    await t.mutation(internal.survivorScoring.applySurvivorScoringRevision, {
      poolId,
      week: 1,
    });
    pool = await t.run(async (ctx) => ctx.db.get(poolId));
    const after = await asAlex.query(api.survivorScoring.getSurvivorStandings, {
      poolId,
    });
    // Alex NCA alive, Blake win alive → multiple Alive, week settled, not final
    // → terminal none → Completed→Active.
    expect(
      after!.rows.find((r) => r.participantId === memberIds.alex)?.eligibility,
    ).toBe("alive");
    expect(
      after!.rows.find((r) => r.participantId === memberIds.blake)?.eligibility,
    ).toBe("alive");
    expect(pool?.status).toBe("active");
  });

  it("pool roles cannot invent, suppress, or force results (deny-by-default)", async () => {
    const t = convexTest(schema, modules);
    const s = await seedWorld(t);
    const { asAlex, poolId } = await createSurvivorPool(t, []);

    // Public module surface has no result-override mutations.
    expect("setGameResult" in api.pools).toBe(false);
    expect("forceVerifiedResult" in api.pools).toBe(false);
    expect("overrideOutcome" in api.survivorScoring).toBe(false);
    expect("syncLive" in api).toBe(false);

    // Owner rules update cannot touch NFL results.
    await asAlex.mutation(api.pools.updatePoolRules, {
      poolId,
      startWeek: 1,
      pickLockMode: "gameKickoff",
    });

    const game = await t.run(async (ctx) => ctx.db.get(s.week1GameId));
    expect(game?.resultAuthority ?? "none").toBe("none");
    expect(game?.verifiedResult).toBeUndefined();
  });

  it("correction confirmation is deterministic across matching observations", async () => {
    const t = convexTest(schema, modules);
    const s = await seedWorld(t);

    await t.run(async (ctx) => {
      await ctx.db.patch(s.week1GameId, {
        resultAuthority: "verified",
        lifecycle: "terminal",
        homeScore: 14,
        awayScore: 10,
        verifiedResult: {
          homeScore: 14,
          awayScore: 10,
          verifiedAtMs: Date.now(),
          status: "FT",
        },
      });
    });

    const t0 = 1_700_000_000_000;
    await t.mutation(internal.syncLive.applyConfirmationObservationMutation, {
      observation: {
        gameId: s.week1GameId,
        observedAtMs: t0,
        homeScore: 17,
        awayScore: 10,
        status: "FT",
      },
    });
    await t.mutation(internal.syncLive.applyConfirmationObservationMutation, {
      observation: {
        gameId: s.week1GameId,
        observedAtMs: t0 + CONFIRMATION_MIN_SPACING_MS,
        homeScore: 17,
        awayScore: 10,
        status: "FT",
      },
    });
    const mid = await t.run(async (ctx) => ctx.db.get(s.week1GameId));
    expect(mid?.resultAuthority).toBe("correction_candidate");
    expect(mid?.verifiedResult?.homeScore).toBe(14);

    const corrected = await t.mutation(
      internal.syncLive.applyConfirmationObservationMutation,
      {
        observation: {
          gameId: s.week1GameId,
          observedAtMs: t0 + CONFIRMATION_MIN_ELAPSED_MS,
          homeScore: 17,
          awayScore: 10,
          status: "FT",
        },
      },
    );
    expect(corrected.resultAuthority).toBe("verified");
    expect(corrected.justCorrected).toBe(true);
    expect(corrected.verifiedResult?.homeScore).toBe(17);

    const again = await t.mutation(
      internal.syncLive.applyConfirmationObservationMutation,
      {
        observation: {
          gameId: s.week1GameId,
          observedAtMs: t0 + CONFIRMATION_MIN_ELAPSED_MS + 1_000,
          homeScore: 17,
          awayScore: 10,
          status: "FT",
        },
      },
    );
    expect(again.justVerified).toBe(false);
    expect(again.justCorrected).toBe(false);
  });
});
