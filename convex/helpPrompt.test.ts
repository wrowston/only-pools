/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { SEVEN_DAYS_MS } from "./helpPrompt";

const modules = import.meta.glob("./**/*.ts");

function fullyVerifiedIdentity(overrides: Record<string, unknown> = {}) {
  return {
    subject: "clerk_user_prompt",
    issuer: "https://viable-eagle-73.clerk.accounts.dev",
    name: "Prompt User",
    email: "prompt@example.com",
    emailVerified: true,
    phoneNumber: "+15551234567",
    phoneNumberVerified: true,
    ageConfirmed: true,
    sid: "sess_prompt_1",
    ...overrides,
  };
}

function blakeIdentity() {
  return fullyVerifiedIdentity({
    subject: "clerk_blake_prompt",
    email: "blake@example.com",
    name: "Blake Member",
    phoneNumber: "+15559876543",
    sid: "sess_blake_prompt",
  });
}

async function seedSurvivorSlate(t: ReturnType<typeof convexTest>) {
  const now = Date.now();
  const week1Kickoff = now + 7 * 24 * 60 * 60 * 1000;
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
    await ctx.db.insert("nflGames", {
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
    });
    return { seasonId, kc, buf, week1Kickoff };
  });
}

async function seedConfidenceSlate(t: ReturnType<typeof convexTest>) {
  const now = Date.now();
  const week1Kickoff = now + 7 * 24 * 60 * 60 * 1000;
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
      sportsDbEventId: "evt_w1",
    });
    const game2Id = await ctx.db.insert("nflGames", {
      stableKey: "nfl:2025:w1:dal@phi",
      seasonId,
      seasonLabel: "2025",
      week: 1,
      homeTeamId: phi,
      awayTeamId: dal,
      scheduledKickoffMs: week1Kickoff + 3_600_000,
      lifecycle: "scheduled",
      homeScore: null,
      awayScore: null,
      sportsDbEventId: "evt_w2",
    });
    return { seasonId, kc, buf, phi, dal, game1Id, game2Id, week1Kickoff };
  });
}

describe("helpPrompt owner milestone", () => {
  it("requires both pool creation and invite sharing before eligible", async () => {
    const t = convexTest(schema, modules);
    await seedSurvivorSlate(t);
    const asOwner = t.withIdentity(fullyVerifiedIdentity());
    await asOwner.mutation(api.participants.ensureMyParticipant, {});

    const now = Date.now();
    let state = await asOwner.query(api.helpPrompt.getPromptState, { nowMs: now });
    expect(state.eligible).toBe(false);
    expect(state.canShow).toBe(false);

    const created = await asOwner.mutation(api.pools.createPool, {
      name: "Owner Pool",
      type: "survivor",
      startWeek: 1,
      pickLockMode: "gameKickoff",
    });

    state = await asOwner.query(api.helpPrompt.getPromptState, { nowMs: now });
    expect(state.eligible).toBe(false);

    await asOwner.mutation(api.invites.confirmStepUp, {});
    await asOwner.mutation(api.invites.createOrRetrieveInvite, {
      poolId: created.poolId,
    });

    state = await asOwner.query(api.helpPrompt.getPromptState, { nowMs: now });
    expect(state.eligible).toBe(true);
    expect(state.canShow).toBe(true);
  });
});

describe("helpPrompt member milestones", () => {
  it("marks eligible after the first valid Survivor Pick", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedSurvivorSlate(t);
    const asAlex = t.withIdentity(fullyVerifiedIdentity());
    await asAlex.mutation(api.participants.ensureMyParticipant, {});
    const pool = await asAlex.mutation(api.pools.createPool, {
      name: "Survivor Pool",
      type: "survivor",
      startWeek: 1,
      pickLockMode: "gameKickoff",
    });

    const now = Date.now();
    let state = await asAlex.query(api.helpPrompt.getPromptState, { nowMs: now });
    expect(state.eligible).toBe(false);

    await asAlex.mutation(api.survivorPicks.autosaveSurvivorPick, {
      poolId: pool.poolId,
      week: 1,
      nflTeamId: seeded.kc,
    });

    state = await asAlex.query(api.helpPrompt.getPromptState, { nowMs: now });
    expect(state.eligible).toBe(true);
    expect(state.canShow).toBe(true);
  });

  it("marks eligible after the first complete Confidence Pick Set", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedConfidenceSlate(t);
    const asAlex = t.withIdentity(fullyVerifiedIdentity());
    await asAlex.mutation(api.participants.ensureMyParticipant, {});
    const pool = await asAlex.mutation(api.pools.createPool, {
      name: "Confidence Pool",
      type: "confidence",
      startWeek: 1,
      pickLockMode: "gameKickoff",
    });

    await asAlex.mutation(api.confidencePicks.ensurePickSheet, {
      poolId: pool.poolId,
      week: 1,
    });

    const now = Date.now();
    let state = await asAlex.query(api.helpPrompt.getPromptState, { nowMs: now });
    expect(state.eligible).toBe(false);

    await asAlex.mutation(api.confidencePicks.autosaveConfidence, {
      poolId: pool.poolId,
      week: 1,
      predictions: [
        { gameId: seeded.game1Id, pickedTeamId: seeded.kc },
        { gameId: seeded.game2Id, pickedTeamId: seeded.phi },
      ],
      confidenceReorder: [
        { gameId: seeded.game1Id, confidenceValue: 15 },
        { gameId: seeded.game2Id, confidenceValue: 16 },
      ],
      tiebreakerPrediction: 42,
    });

    state = await asAlex.query(api.helpPrompt.getPromptState, { nowMs: now });
    expect(state.eligible).toBe(true);
    expect(state.canShow).toBe(true);
  });
});

describe("helpPrompt display, snooze, and retirement", () => {
  it("snoozes for seven days after Not now and allows a final display", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedSurvivorSlate(t);
    const asAlex = t.withIdentity(fullyVerifiedIdentity());
    await asAlex.mutation(api.participants.ensureMyParticipant, {});
    const pool = await asAlex.mutation(api.pools.createPool, {
      name: "Snooze Pool",
      type: "survivor",
      startWeek: 1,
      pickLockMode: "gameKickoff",
    });
    await asAlex.mutation(api.survivorPicks.autosaveSurvivorPick, {
      poolId: pool.poolId,
      week: 1,
      nflTeamId: seeded.kc,
    });

    const showAt = Date.now();
    await asAlex.mutation(api.helpPrompt.recordPromptShown, {
      nowMs: showAt,
    });

    const snoozeAt = showAt + 1_000;
    const snoozed = await asAlex.mutation(api.helpPrompt.snoozePrompt, {
      nowMs: snoozeAt,
    });
    expect(snoozed.displayCount).toBe(1);
    expect(snoozed.snoozeUntilMs).toBe(snoozeAt + SEVEN_DAYS_MS);
    expect(snoozed.canShow).toBe(false);

    const beforeSnoozeEnds = snoozeAt + SEVEN_DAYS_MS - 1;
    const blocked = await asAlex.query(api.helpPrompt.getPromptState, {
      nowMs: beforeSnoozeEnds,
    });
    expect(blocked.canShow).toBe(false);

    const afterSnooze = snoozeAt + SEVEN_DAYS_MS + 1;
    const ready = await asAlex.query(api.helpPrompt.getPromptState, {
      nowMs: afterSnooze,
    });
    expect(ready.canShow).toBe(true);
  });

  it("retires after the second display and on Don't ask again", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedSurvivorSlate(t);
    const asAlex = t.withIdentity(fullyVerifiedIdentity());
    await asAlex.mutation(api.participants.ensureMyParticipant, {});
    const pool = await asAlex.mutation(api.pools.createPool, {
      name: "Retire Pool",
      type: "survivor",
      startWeek: 1,
      pickLockMode: "gameKickoff",
    });
    await asAlex.mutation(api.survivorPicks.autosaveSurvivorPick, {
      poolId: pool.poolId,
      week: 1,
      nflTeamId: seeded.kc,
    });

    const now = Date.now();
    const first = await asAlex.mutation(api.helpPrompt.recordPromptShown, {
      nowMs: now,
    });
    expect(first.displayCount).toBe(1);
    expect(first.retired).toBe(false);

    const second = await asAlex.mutation(api.helpPrompt.recordPromptShown, {
      nowMs: now + 1,
    });
    expect(second.displayCount).toBe(2);
    expect(second.retired).toBe(true);
    expect(second.canShow).toBe(false);

    const asOther = t.withIdentity(blakeIdentity());
    await asOther.mutation(api.participants.ensureMyParticipant, {});
    const retired = await asOther.mutation(api.helpPrompt.retirePrompt, {
      nowMs: now,
    });
    expect(retired.retired).toBe(true);
    expect(retired.canShow).toBe(false);
  });
});

describe("helpPrompt cross-device state", () => {
  it("stores prompt state on the participant account", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedSurvivorSlate(t);
    const asAlex = t.withIdentity(fullyVerifiedIdentity());
    const { participantId } = await asAlex.mutation(
      api.participants.ensureMyParticipant,
      {},
    );
    const pool = await asAlex.mutation(api.pools.createPool, {
      name: "Cross Device Pool",
      type: "survivor",
      startWeek: 1,
      pickLockMode: "gameKickoff",
    });
    await asAlex.mutation(api.survivorPicks.autosaveSurvivorPick, {
      poolId: pool.poolId,
      week: 1,
      nflTeamId: seeded.kc,
    });

    const now = Date.now();
    await asAlex.mutation(api.helpPrompt.recordPromptShown, { nowMs: now });
    await asAlex.mutation(api.helpPrompt.snoozePrompt, { nowMs: now + 10 });

    const sameAccount = t.withIdentity(
      fullyVerifiedIdentity({ sid: "sess_prompt_2" }),
    );
    const state = await sameAccount.query(api.helpPrompt.getPromptState, {
      nowMs: now + 10,
    });
    expect(state.displayCount).toBe(1);
    expect(state.snoozeUntilMs).toBe(now + 10 + SEVEN_DAYS_MS);

    const row = await t.run(async (ctx) =>
      ctx.db
        .query("feedbackPromptState")
        .withIndex("by_participantId", (q) =>
          q.eq("participantId", participantId),
        )
        .unique(),
    );
    expect(row?.participantId).toEqual(participantId);
    expect(row?.displayCount).toBe(1);
  });
});
