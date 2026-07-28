/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { scoringHoldCandidateKey, scoringHoldDedupeKey } from "./lib/scoringHolds";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const NOW_MS = Date.UTC(2026, 8, 20, 17);

function operatorIdentity() {
  return {
    subject: "clerk_scoring_operator",
    issuer: "https://clerk.example",
    name: "Scoring Operator",
    email: "scoring-ops@example.com",
    emailVerified: true,
    phoneNumber: "+15551234567",
    phoneNumberVerified: true,
    ageConfirmed: true,
    sid: "scoring_ops_session",
  };
}

async function seedHeldPools(t: ReturnType<typeof convexTest>) {
  const asOperator = t.withIdentity(operatorIdentity());
  const participant = await asOperator.mutation(
    api.participants.ensureMyParticipant,
    {},
  );
  const seeded = await t.run(async (ctx) => {
    const seasonId = await ctx.db.insert("poolSeasons", {
      label: "2026",
      year: 2026,
      status: "available",
      usableStartWeek: 1,
      bootstrappedAtMs: NOW_MS,
    });
    const homeTeamId = await ctx.db.insert("nflTeams", {
      stableKey: "team:home",
      name: "Home",
      abbreviation: "HOM",
      sportsDbTeamId: "legacy-home",
    });
    const awayTeamId = await ctx.db.insert("nflTeams", {
      stableKey: "team:away",
      name: "Away",
      abbreviation: "AWY",
      sportsDbTeamId: "legacy-away",
    });
    const gameId = await ctx.db.insert("nflGames", {
      stableKey: "game:held",
      seasonId,
      seasonLabel: "2026",
      week: 1,
      homeTeamId,
      awayTeamId,
      scheduledKickoffMs: NOW_MS - 2 * 60 * 60_000,
      lifecycle: "terminal",
      homeScore: 27,
      awayScore: 24,
      sportsDbEventId: "legacy-held",
      resultAuthority: "verified",
      verifiedResult: {
        homeScore: 27,
        awayScore: 24,
        status: "FT",
        verifiedAtMs: NOW_MS - 60_000,
      },
      correctionCandidate: {
        homeScore: 20,
        awayScore: 28,
        status: "FT",
        observedAtMs: NOW_MS,
      },
    });
    await ctx.db.insert("nflGames", {
      stableKey: "game:future",
      seasonId,
      seasonLabel: "2026",
      week: 2,
      homeTeamId,
      awayTeamId,
      scheduledKickoffMs: NOW_MS + 7 * 24 * 60 * 60_000,
      lifecycle: "scheduled",
      homeScore: null,
      awayScore: null,
      sportsDbEventId: "legacy-future",
      resultAuthority: "none",
    });
    const poolIds: Id<"pools">[] = [];
    const holdIds: Id<"scoringHolds">[] = [];
    for (const type of ["survivor", "confidence"] as const) {
      const poolId = await ctx.db.insert("pools", {
        name: `${type} held pool`,
        type,
        seasonId,
        startWeek: 1,
        pickLockMode: "gameKickoff",
        status: "active",
        rulesFrozen: true,
        ownerParticipantId: participant.participantId,
        createdAtMs: NOW_MS - 10_000,
      });
      const membershipId = await ctx.db.insert("poolMemberships", {
        poolId,
        participantId: participant.participantId,
        role: "owner",
        status: "active",
      });
      await ctx.db.insert("poolEntries", {
        poolId,
        participantId: participant.participantId,
        membershipId,
        entryNumber: 1,
        status: "active",
        createdAtMs: NOW_MS - 10_000,
      });
      const candidateKey = scoringHoldCandidateKey({
        gameId,
        homeScore: 20,
        awayScore: 28,
        status: "FT",
        observedAtMs: NOW_MS,
      });
      const holdId = await ctx.db.insert("scoringHolds", {
        poolId,
        gameId,
        poolType: type,
        gameWeek: 1,
        dependency:
          type === "survivor"
            ? "locked_survivor_pick"
            : "locked_confidence_pick",
        candidateKey,
        dedupeKey: scoringHoldDedupeKey({ poolId, candidateKey }),
        candidateHomeScore: 20,
        candidateAwayScore: 28,
        candidateObservedAtMs: NOW_MS,
        candidateStatus: "FT",
        officialHomeScore: 27,
        officialAwayScore: 24,
        officialVerifiedAtMs: NOW_MS - 60_000,
        officialStatus: "FT",
        status: "open",
        createdAtMs: NOW_MS,
      });
      poolIds.push(poolId);
      holdIds.push(holdId);
    }
    const unaffectedPoolId = await ctx.db.insert("pools", {
      name: "unaffected survivor pool",
      type: "survivor",
      seasonId,
      startWeek: 1,
      pickLockMode: "gameKickoff",
      status: "active",
      rulesFrozen: true,
      ownerParticipantId: participant.participantId,
      createdAtMs: NOW_MS - 10_000,
    });
    const unaffectedMembershipId = await ctx.db.insert("poolMemberships", {
      poolId: unaffectedPoolId,
      participantId: participant.participantId,
      role: "owner",
      status: "active",
    });
    await ctx.db.insert("poolEntries", {
      poolId: unaffectedPoolId,
      participantId: participant.participantId,
      membershipId: unaffectedMembershipId,
      entryNumber: 1,
      status: "active",
      createdAtMs: NOW_MS - 10_000,
    });
    return {
      participantId: participant.participantId,
      homeTeamId,
      gameId,
      survivorPoolId: poolIds[0]!,
      confidencePoolId: poolIds[1]!,
      unaffectedPoolId,
      survivorHoldId: holdIds[0]!,
    };
  });
  return { ...seeded, asOperator };
}

describe("Scoring Holds", () => {
  const previousOperator = process.env.PRODUCTION_OPERATOR_CLERK_USER_ID;
  const previousDeploymentKind = process.env.DEPLOYMENT_KIND;

  beforeEach(() => {
    process.env.PRODUCTION_OPERATOR_CLERK_USER_ID =
      "clerk_scoring_operator";
    process.env.DEPLOYMENT_KIND = "development";
  });

  afterEach(() => {
    vi.useRealTimers();
    if (previousOperator === undefined) {
      delete process.env.PRODUCTION_OPERATOR_CLERK_USER_ID;
    } else {
      process.env.PRODUCTION_OPERATOR_CLERK_USER_ID = previousOperator;
    }
    if (previousDeploymentKind === undefined) {
      delete process.env.DEPLOYMENT_KIND;
    } else {
      process.env.DEPLOYMENT_KIND = previousDeploymentKind;
    }
  });

  it("gates revisions only for affected pools and labels retained official standings", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedHeldPools(t);

    const survivor = await t.mutation(
      internal.survivorScoring.applySurvivorScoringRevision,
      { poolId: seeded.survivorPoolId, week: 1, nowMs: NOW_MS },
    );
    const confidence = await t.mutation(
      internal.confidenceScoring.applyConfidenceScoringRevision,
      { poolId: seeded.confidencePoolId, week: 1, nowMs: NOW_MS },
    );
    const unaffected = await t.mutation(
      internal.survivorScoring.applySurvivorScoringRevision,
      { poolId: seeded.unaffectedPoolId, week: 1, nowMs: NOW_MS },
    );

    expect(survivor).toMatchObject({
      status: "held",
      holdId: seeded.survivorHoldId,
    });
    expect(confidence.status).toBe("held");
    expect(unaffected.status).toBe("published");
    const revisions = await t.run(async (ctx) =>
      ctx.db.query("scoringRevisions").collect(),
    );
    expect(revisions).toHaveLength(1);
    expect(revisions[0]?.poolId).toBe(seeded.unaffectedPoolId);
    const pick = await seeded.asOperator.mutation(
      api.survivorPicks.autosaveSurvivorPick,
      {
        poolId: seeded.survivorPoolId,
        week: 2,
        nflTeamId: seeded.homeTeamId,
      },
    );
    expect(pick).toMatchObject({ week: 2, locked: false });

    const survivorView = await seeded.asOperator.query(
      api.survivorScoring.getSurvivorStandingsGrid,
      { poolId: seeded.survivorPoolId },
    );
    const confidenceView = await seeded.asOperator.query(
      api.confidenceScoring.getConfidenceStandings,
      { poolId: seeded.confidencePoolId, week: 1 },
    );
    expect(survivorView?.scoringHold?.label).toBe(
      "Official result under review",
    );
    expect(confidenceView?.scoringHold?.label).toBe(
      "Official result under review",
    );
  });

  it("allows only the Production Operator to accept and replay a correction", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS + 60_000);
    const t = convexTest(schema, modules);
    const seeded = await seedHeldPools(t);
    await t.run(async (ctx) => {
      const holds = await ctx.db.query("scoringHolds").collect();
      for (const hold of holds) {
        await ctx.db.patch(hold._id, {
          status: "resolved",
          resolution: "superseded_candidate",
          resolvedAtMs: NOW_MS - 1,
        });
      }
    });
    await t.mutation(
      internal.survivorScoring.applySurvivorScoringRevision,
      { poolId: seeded.survivorPoolId, week: 1, nowMs: NOW_MS },
    );
    await t.mutation(
      internal.confidenceScoring.applyConfidenceScoringRevision,
      { poolId: seeded.confidencePoolId, week: 1, nowMs: NOW_MS },
    );
    await t.run(async (ctx) => {
      const holds = await ctx.db.query("scoringHolds").collect();
      for (const hold of holds) {
        await ctx.db.patch(hold._id, {
          status: "open",
          resolution: undefined,
          resolvedAtMs: undefined,
        });
      }
    });
    const nonOperator = t.withIdentity({
      ...operatorIdentity(),
      subject: "clerk_not_operator",
      email: "member@example.com",
    });
    await nonOperator.mutation(api.participants.ensureMyParticipant, {});
    await expect(
      nonOperator.mutation(api.scoringHolds.resolveScoringHold, {
        holdId: seeded.survivorHoldId,
      }),
    ).rejects.toThrow(/Production Operator required/);
    const resolved = await seeded.asOperator.mutation(
      api.scoringHolds.resolveScoringHold,
      {
        holdId: seeded.survivorHoldId,
      },
    );
    expect(resolved).toEqual({
      resolution: "accepted_correction",
      resolvedHoldCount: 2,
      scoringScheduled: true,
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    const state = await t.run(async (ctx) => ({
      game: await ctx.db.get(seeded.gameId),
      holds: await ctx.db.query("scoringHolds").collect(),
      history: await ctx.db.query("nflGameResultHistory").collect(),
      revisions: await ctx.db.query("scoringRevisions").collect(),
      audits: (
        await ctx.db.query("operatorAuditEvents").collect()
      ).filter((event) => event.action === "scoring_hold_resolved"),
    }));
    expect(state.game?.verifiedResult).toMatchObject({
      homeScore: 20,
      awayScore: 28,
      status: "FT",
    });
    expect(state.game?.correctionCandidate).toBeUndefined();
    expect(state.holds.every((hold) => hold.status === "resolved")).toBe(true);
    expect(state.history).toHaveLength(1);
    expect(state.audits).toHaveLength(2);
    for (const poolId of [
      seeded.survivorPoolId,
      seeded.confidencePoolId,
    ]) {
      const revisions = state.revisions.filter(
        (revision) => revision.poolId === poolId,
      );
      expect(revisions.map((revision) => revision.revisionNumber)).toEqual([
        1, 2,
      ]);
    }
  });

  it("keeps accepted correction history visible after its evaluation is applied", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS + 60_000);
    const t = convexTest(schema, modules);
    const seeded = await seedHeldPools(t);
    await t.run(async (ctx) => {
      const game = (await ctx.db.get(seeded.gameId))!;
      const candidate = game.correctionCandidate!;
      const candidateKey = scoringHoldCandidateKey({
        gameId: game._id,
        ...candidate,
      });
      const evaluationId = await ctx.db.insert(
        "scoringHoldEvaluations",
        {
          seasonId: game.seasonId,
          gameId: game._id,
          gameWeek: game.week,
          candidateKey,
          candidateHomeScore: candidate.homeScore,
          candidateAwayScore: candidate.awayScore,
          candidateObservedAtMs: candidate.observedAtMs,
          candidateStatus: candidate.status,
          status: "complete",
          processedPools: 3,
          holdCount: 2,
          startedAtMs: candidate.observedAtMs,
          completedAtMs: candidate.observedAtMs,
        },
      );
      const holds = await ctx.db.query("scoringHolds").collect();
      for (const hold of holds) {
        await ctx.db.patch(hold._id, { evaluationId });
      }
    });

    await seeded.asOperator.mutation(
      api.scoringHolds.resolveScoringHold,
      { holdId: seeded.survivorHoldId },
    );
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const page = await seeded.asOperator.query(
      api.scoringHolds.listOperatorScoringHolds,
      {
        status: "resolved",
        paginationOpts: { numItems: 20, cursor: null },
      },
    );
    expect(page.page).toHaveLength(2);
    expect(
      page.page.every(
        (hold) =>
          hold.resolution === "accepted_correction" &&
          hold.evaluationStatus === "applied",
      ),
    ).toBe(true);
  });

  it("restarts a complete evaluation across multiple appended dependency events before acceptance", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS + 60_000);
    const t = convexTest(schema, modules);
    const seeded = await seedHeldPools(t);
    const evaluationId = await t.run(async (ctx) => {
      const game = (await ctx.db.get(seeded.gameId))!;
      const candidate = game.correctionCandidate!;
      const candidateKey = scoringHoldCandidateKey({
        gameId: game._id,
        ...candidate,
      });
      const id = await ctx.db.insert("scoringHoldEvaluations", {
        seasonId: game.seasonId,
        gameId: game._id,
        gameWeek: game.week,
        candidateKey,
        candidateHomeScore: candidate.homeScore,
        candidateAwayScore: candidate.awayScore,
        candidateObservedAtMs: candidate.observedAtMs,
        candidateStatus: candidate.status,
        status: "complete",
        processedPools: 3,
        holdCount: 2,
        startedAtMs: candidate.observedAtMs,
        completedAtMs: candidate.observedAtMs,
      });
      for (const hold of await ctx.db.query("scoringHolds").collect()) {
        await ctx.db.patch(hold._id, { evaluationId: id });
      }
      return id;
    });

    await seeded.asOperator.mutation(
      api.survivorPicks.autosaveSurvivorPick,
      {
        poolId: seeded.survivorPoolId,
        week: 2,
        nflTeamId: seeded.homeTeamId,
      },
    );
    vi.setSystemTime(NOW_MS + 8 * 24 * 60 * 60_000);
    const locked = await seeded.asOperator.mutation(
      api.survivorPicks.materializeSurvivorLocks,
      { poolId: seeded.survivorPoolId, week: 2 },
    );
    expect(locked.lockedCount).toBe(1);

    const refused = await seeded.asOperator.mutation(
      api.scoringHolds.resolveScoringHold,
      { holdId: seeded.survivorHoldId },
    );
    expect(refused).toEqual({
      resolution: "evaluation_restarted",
      resolvedHoldCount: 0,
      scoringScheduled: false,
    });
    const beforeRescan = await t.run(async (ctx) => {
      const evaluation = (await ctx.db.get(evaluationId))!;
      const firstEvents = await ctx.db
        .query("scoringDependencyEvents")
        .withIndex("by_seasonId", (q) =>
          q.eq("seasonId", evaluation.seasonId),
        )
        .collect();
      expect(firstEvents).toHaveLength(1);
      const secondEventId = await ctx.db.insert(
        "scoringDependencyEvents",
        {
          seasonId: evaluation.seasonId,
          recordedAtMs: NOW_MS + 8 * 24 * 60 * 60_000 + 1,
        },
      );
      return {
        game: await ctx.db.get(seeded.gameId),
        evaluation,
        firstEventId: firstEvents[0]!._id,
        secondEventId,
        acceptances: await ctx.db
          .query("scoringHoldAcceptances")
          .collect(),
        history: await ctx.db.query("nflGameResultHistory").collect(),
      };
    });
    expect(beforeRescan.game?.verifiedResult).toMatchObject({
      homeScore: 27,
      awayScore: 24,
    });
    expect(beforeRescan.evaluation).toMatchObject({
      status: "building",
      processedPools: 0,
      holdCount: 2,
      dependencyEventId: beforeRescan.firstEventId,
    });
    expect(beforeRescan.acceptances).toHaveLength(0);
    expect(beforeRescan.history).toHaveLength(0);

    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const afterRescan = await t.run(async (ctx) => ({
      game: await ctx.db.get(seeded.gameId),
      evaluation: await ctx.db.get(evaluationId),
      holds: await ctx.db
        .query("scoringHolds")
        .withIndex("by_gameId_and_status", (q) =>
          q.eq("gameId", seeded.gameId).eq("status", "open"),
        )
        .collect(),
      events: await ctx.db
        .query("scoringDependencyEvents")
        .collect(),
    }));
    expect(afterRescan.game?.verifiedResult).toMatchObject({
      homeScore: 27,
      awayScore: 24,
    });
    expect(afterRescan.evaluation).toMatchObject({
      status: "complete",
      processedPools: 3,
      holdCount: 3,
      dependencyEventId: beforeRescan.secondEventId,
    });
    expect(afterRescan.events).toHaveLength(2);
    expect(afterRescan.holds).toHaveLength(3);
    expect(afterRescan.holds.map((hold) => hold.poolId)).toContain(
      seeded.unaffectedPoolId,
    );
  });

  it("accepts more than 500 matching holds in durable batches and applies exactly once", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS + 60_000);
    const t = convexTest(schema, modules);
    const seeded = await seedHeldPools(t);
    await t.run(async (ctx) => {
      const game = (await ctx.db.get(seeded.gameId))!;
      const candidate = game.correctionCandidate!;
      const candidateKey = scoringHoldCandidateKey({
        gameId: game._id,
        ...candidate,
      });
      const evaluationId = await ctx.db.insert(
        "scoringHoldEvaluations",
        {
          seasonId: game.seasonId,
          gameId: game._id,
          gameWeek: game.week,
          candidateKey,
          candidateHomeScore: candidate.homeScore,
          candidateAwayScore: candidate.awayScore,
          candidateObservedAtMs: candidate.observedAtMs,
          candidateStatus: candidate.status,
          status: "complete",
          processedPools: 503,
          holdCount: 503,
          startedAtMs: candidate.observedAtMs,
          completedAtMs: candidate.observedAtMs,
        },
      );
      for (const hold of await ctx.db.query("scoringHolds").collect()) {
        await ctx.db.patch(hold._id, { evaluationId });
      }
      for (let index = 0; index < 501; index++) {
        await ctx.db.insert("scoringHolds", {
          evaluationId,
          poolId: seeded.survivorPoolId,
          gameId: game._id,
          poolType: "survivor",
          gameWeek: game.week,
          dependency: "later_game_lock",
          candidateKey,
          dedupeKey: `${seeded.survivorPoolId}:${candidateKey}:accept:${index}`,
          candidateHomeScore: candidate.homeScore,
          candidateAwayScore: candidate.awayScore,
          candidateObservedAtMs: candidate.observedAtMs,
          candidateStatus: candidate.status,
          officialHomeScore: game.verifiedResult!.homeScore,
          officialAwayScore: game.verifiedResult!.awayScore,
          officialVerifiedAtMs: game.verifiedResult!.verifiedAtMs,
          officialStatus: game.verifiedResult!.status,
          status: "open",
          createdAtMs: NOW_MS + index,
        });
      }
    });

    const started = await seeded.asOperator.mutation(
      api.scoringHolds.resolveScoringHold,
      { holdId: seeded.survivorHoldId },
    );
    expect(started.scoringScheduled).toBe(false);
    const partial = await t.run(async (ctx) => ({
      history: await ctx.db.query("nflGameResultHistory").collect(),
      acceptance: (
        await ctx.db.query("scoringHoldAcceptances").collect()
      )[0],
    }));
    expect(partial.history).toHaveLength(0);
    expect(partial.acceptance?.status).not.toBe("complete");
    const unrelated = await t.mutation(
      internal.survivorScoring.applySurvivorScoringRevision,
      {
        poolId: seeded.unaffectedPoolId,
        week: 1,
        nowMs: NOW_MS + 60_000,
      },
    );
    expect(unrelated.status).toBe("published");
    const unrelatedView = await seeded.asOperator.query(
      api.survivorScoring.getSurvivorStandingsGrid,
      { poolId: seeded.unaffectedPoolId },
    );
    expect(unrelatedView?.scoringHold).toBeNull();
    for (let step = 0; step < 4; step++) {
      vi.runOnlyPendingTimers();
      await t.finishInProgressScheduledFunctions();
    }
    const interrupted = await t.run(async (ctx) => ({
      game: await ctx.db.get(seeded.gameId),
      history: await ctx.db.query("nflGameResultHistory").collect(),
      acceptance: (
        await ctx.db.query("scoringHoldAcceptances").collect()
      )[0],
      acceptedCount: (
        await ctx.db.query("scoringHolds").collect()
      ).filter((hold) => hold.resolution === "accepted_correction")
        .length,
    }));
    expect(interrupted.history).toHaveLength(1);
    expect(interrupted.acceptance?.status).toBe("resolving_holds");
    expect(interrupted.acceptedCount).toBeGreaterThan(0);
    expect(interrupted.game?.verifiedResult).toMatchObject({
      homeScore: 20,
      awayScore: 28,
    });
    const processingPage = await seeded.asOperator.query(
      api.scoringHolds.listOperatorScoringHolds,
      {
        status: "open",
        paginationOpts: { numItems: 20, cursor: null },
      },
    );
    expect(processingPage.page.length).toBeGreaterThan(0);
    expect(
      processingPage.page.every(
        (hold) =>
          hold.evaluationStatus === "applied" &&
          hold.acceptanceStatus === "resolving_holds",
      ),
    ).toBe(true);

    const newer = await t.mutation(
      internal.syncApiSportsLive.applyReconciliationObservation,
      {
        gameId: seeded.gameId,
        observation: {
          externalId: "newer-during-acceptance",
          observedAtMs: NOW_MS + 120_000,
          lifecycle: "terminal",
          homeScore: 17,
          awayScore: 31,
          providerStatus: {
            rawShort: "FT",
            rawLong: "Finished",
            recognized: true,
            terminal: true,
          },
        },
      },
    );
    expect(newer.result).toBe("corrected");
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    const state = await t.run(async (ctx) => ({
      game: await ctx.db.get(seeded.gameId),
      holds: await ctx.db.query("scoringHolds").collect(),
      history: await ctx.db.query("nflGameResultHistory").collect(),
      acceptances: await ctx.db.query("scoringHoldAcceptances").collect(),
    }));
    const acceptedCandidateHolds = state.holds.filter(
      (hold) =>
        hold.candidateHomeScore === 20 &&
        hold.candidateAwayScore === 28,
    );
    expect(acceptedCandidateHolds).toHaveLength(503);
    expect(
      acceptedCandidateHolds.every(
        (hold) =>
          hold.status === "resolved" &&
          hold.resolution === "accepted_correction",
      ),
    ).toBe(true);
    expect(state.history).toHaveLength(2);
    expect(state.game?.verifiedResult).toMatchObject({
      homeScore: 17,
      awayScore: 31,
    });
    expect(state.game?.correctionCandidate).toBeUndefined();
    expect(state.acceptances).toEqual([
      expect.objectContaining({
        status: "complete",
        processedHolds: 503,
      }),
    ]);
  });

  it("routes large FT-to-CANC and CANC-to-FT acceptances from the applied result", async () => {
    for (const direction of ["ft_to_canc", "canc_to_ft"] as const) {
      vi.useFakeTimers();
      vi.setSystemTime(NOW_MS + 60_000);
      const t = convexTest(schema, modules);
      const seeded = await seedHeldPools(t);
      const pickId = await t.run(async (ctx) => {
        const game = (await ctx.db.get(seeded.gameId))!;
        const entry = (
          await ctx.db
            .query("poolEntries")
            .withIndex("by_poolId", (q) =>
              q.eq("poolId", seeded.survivorPoolId),
            )
            .first()
        )!;
        const candidate =
          direction === "ft_to_canc"
            ? {
                homeScore: 0,
                awayScore: 0,
                status: "CANC" as const,
                observedAtMs: NOW_MS,
              }
            : {
                homeScore: 20,
                awayScore: 28,
                status: "FT" as const,
                observedAtMs: NOW_MS,
              };
        if (direction === "canc_to_ft") {
          await ctx.db.patch(game._id, {
            lifecycle: "canceled",
            homeScore: 0,
            awayScore: 0,
            verifiedResult: {
              homeScore: 0,
              awayScore: 0,
              status: "CANC",
              verifiedAtMs: NOW_MS - 60_000,
            },
          });
        }
        await ctx.db.patch(game._id, { correctionCandidate: candidate });
        const candidateKey = scoringHoldCandidateKey({
          gameId: game._id,
          ...candidate,
        });
        for (const hold of await ctx.db.query("scoringHolds").collect()) {
          await ctx.db.patch(hold._id, {
            candidateKey,
            dedupeKey: `${hold.poolId}:${candidateKey}`,
            candidateHomeScore: candidate.homeScore,
            candidateAwayScore: candidate.awayScore,
            candidateStatus: candidate.status,
          });
        }
        for (let index = 0; index < 201; index++) {
          await ctx.db.insert("scoringHolds", {
            poolId: seeded.survivorPoolId,
            gameId: game._id,
            poolType: "survivor",
            gameWeek: game.week,
            dependency: "later_game_lock",
            candidateKey,
            dedupeKey: `${seeded.survivorPoolId}:${candidateKey}:route:${index}`,
            candidateHomeScore: candidate.homeScore,
            candidateAwayScore: candidate.awayScore,
            candidateObservedAtMs: candidate.observedAtMs,
            candidateStatus: candidate.status,
            officialHomeScore:
              direction === "canc_to_ft" ? 0 : 27,
            officialAwayScore:
              direction === "canc_to_ft" ? 0 : 24,
            officialVerifiedAtMs: NOW_MS - 60_000,
            officialStatus:
              direction === "canc_to_ft" ? "CANC" : "FT",
            status: "open",
            createdAtMs: NOW_MS + index,
          });
        }
        return await ctx.db.insert("survivorPicks", {
          poolId: seeded.survivorPoolId,
          participantId: seeded.participantId,
          entryId: entry._id,
          week: 1,
          nflTeamId: seeded.homeTeamId,
          gameId: game._id,
          locked: false,
          provenance: "authored",
          provisional: false,
          updatedAtMs: NOW_MS,
        });
      });

      const started = await seeded.asOperator.mutation(
        api.scoringHolds.resolveScoringHold,
        { holdId: seeded.survivorHoldId },
      );
      expect(started.scoringScheduled).toBe(false);
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());
      const state = await t.run(async (ctx) => ({
        game: await ctx.db.get(seeded.gameId),
        pick: await ctx.db.get(pickId),
        histories: await ctx.db.query("nflGameResultHistory").collect(),
      }));
      expect(state.histories).toHaveLength(1);
      if (direction === "ft_to_canc") {
        expect(state.game?.verifiedResult?.status).toBe("CANC");
        expect(state.pick).toMatchObject({
          invalidated: true,
          invalidationReason: "pre_lock_cancellation",
        });
      } else {
        expect(state.game?.verifiedResult?.status).toBe("FT");
        expect(state.pick?.invalidated).not.toBe(true);
      }
      vi.useRealTimers();
    }
  });

  it("refuses acceptance while cursor-batched evaluation is still building", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedHeldPools(t);
    await t.run(async (ctx) => {
      const game = (await ctx.db.get(seeded.gameId))!;
      const candidate = game.correctionCandidate!;
      const candidateKey = scoringHoldCandidateKey({
        gameId: game._id,
        ...candidate,
      });
      const evaluationId = await ctx.db.insert(
        "scoringHoldEvaluations",
        {
          seasonId: game.seasonId,
          gameId: game._id,
          gameWeek: game.week,
          candidateKey,
          candidateHomeScore: candidate.homeScore,
          candidateAwayScore: candidate.awayScore,
          candidateObservedAtMs: candidate.observedAtMs,
          candidateStatus: candidate.status,
          status: "building",
          cursor: "next-pool-page",
          processedPools: 200,
          holdCount: 1,
          startedAtMs: candidate.observedAtMs,
        },
      );
      await ctx.db.patch(seeded.survivorHoldId, { evaluationId });
    });

    await expect(
      seeded.asOperator.mutation(api.scoringHolds.resolveScoringHold, {
        holdId: seeded.survivorHoldId,
      }),
    ).rejects.toThrow(/complete before acceptance/i);
    const game = await t.run(async (ctx) => ctx.db.get(seeded.gameId));
    expect(game?.verifiedResult).toMatchObject({
      homeScore: 27,
      awayScore: 24,
    });
  });

  it("rejects multiple active evaluation episodes for one NFL Game", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedHeldPools(t);
    await t.run(async (ctx) => {
      const game = (await ctx.db.get(seeded.gameId))!;
      const candidate = game.correctionCandidate!;
      const candidateKey = scoringHoldCandidateKey({
        gameId: game._id,
        ...candidate,
      });
      for (const status of ["building", "complete"] as const) {
        await ctx.db.insert("scoringHoldEvaluations", {
          seasonId: game.seasonId,
          gameId: game._id,
          gameWeek: game.week,
          candidateKey,
          candidateHomeScore: candidate.homeScore,
          candidateAwayScore: candidate.awayScore,
          candidateObservedAtMs: candidate.observedAtMs,
          candidateStatus: candidate.status,
          status,
          processedPools: 1,
          holdCount: 1,
          startedAtMs: candidate.observedAtMs,
          completedAtMs:
            status === "complete" ? candidate.observedAtMs : undefined,
        });
      }
    });

    await expect(
      t.mutation(
        internal.syncApiSportsLive.applyReconciliationObservation,
        {
          gameId: seeded.gameId,
          observation: {
            externalId: "duplicate-evaluation-invariant",
            observedAtMs: NOW_MS + 1,
            lifecycle: "terminal",
            homeScore: 20,
            awayScore: 28,
            providerStatus: {
              rawShort: "FT",
              rawLong: "Finished",
              recognized: true,
              terminal: true,
            },
          },
        },
      ),
    ).rejects.toThrow(/multiple active evaluations/i);
  });

  it("rejects multiple active acceptances for one candidate", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedHeldPools(t);
    await t.run(async (ctx) => {
      const game = (await ctx.db.get(seeded.gameId))!;
      const candidateKey = scoringHoldCandidateKey({
        gameId: game._id,
        ...game.correctionCandidate!,
      });
      for (const status of [
        "validating_holds",
        "resolving_holds",
      ] as const) {
        await ctx.db.insert("scoringHoldAcceptances", {
          seasonId: game.seasonId,
          gameId: game._id,
          gameWeek: game.week,
          candidateKey,
          status,
          validatedHolds: 0,
          processedHolds: 0,
          actorTokenIdentifier: "test:operator",
          actorClerkUserId: "clerk_scoring_operator",
          startedAtMs: NOW_MS,
          appliedAtMs:
            status === "resolving_holds" ? NOW_MS : undefined,
        });
      }
    });

    await expect(
      seeded.asOperator.mutation(api.scoringHolds.resolveScoringHold, {
        holdId: seeded.survivorHoldId,
      }),
    ).rejects.toThrow(/multiple active acceptances/i);
  });

  it("gates only evaluations applicable to the Pool start week", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedHeldPools(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(seeded.unaffectedPoolId, { startWeek: 5 });
      await ctx.db.insert("poolWeeks", {
        poolId: seeded.unaffectedPoolId,
        week: 11,
        settled: true,
        updatedAtMs: NOW_MS,
      });
      await ctx.db.insert("scoringHoldEvaluations", {
        seasonId: (await ctx.db.get(seeded.gameId))!.seasonId,
        gameId: seeded.gameId,
        gameWeek: 1,
        candidateKey: "week-1-candidate",
        candidateHomeScore: 20,
        candidateAwayScore: 28,
        candidateObservedAtMs: NOW_MS,
        candidateStatus: "FT",
        status: "building",
        processedPools: 10,
        holdCount: 0,
        startedAtMs: NOW_MS,
      });
    });

    const unaffected = await t.mutation(
      internal.survivorScoring.applySurvivorScoringRevision,
      { poolId: seeded.unaffectedPoolId, week: 5, nowMs: NOW_MS },
    );
    expect(unaffected.status).toBe("published");

    const unrelatedPoolId = await t.run(async (ctx) => {
      const baseGame = (await ctx.db.get(seeded.gameId))!;
      const game10Id = await ctx.db.insert("nflGames", {
        stableKey: "game:week-10-correction",
        seasonId: baseGame.seasonId,
        seasonLabel: baseGame.seasonLabel,
        week: 10,
        homeTeamId: baseGame.homeTeamId,
        awayTeamId: baseGame.awayTeamId,
        scheduledKickoffMs: NOW_MS - 1_000,
        lifecycle: "scheduled",
        homeScore: 10,
        awayScore: 7,
        sportsDbEventId: "week-10-correction",
        resultAuthority: "verified",
        verifiedResult: {
          homeScore: 10,
          awayScore: 7,
          status: "FT",
          verifiedAtMs: NOW_MS,
        },
        correctionCandidate: {
          homeScore: 13,
          awayScore: 7,
          status: "FT",
          observedAtMs: NOW_MS + 1,
        },
      });
      await ctx.db.insert("scoringHoldEvaluations", {
        seasonId: baseGame.seasonId,
        gameId: game10Id,
        gameWeek: 10,
        candidateKey: scoringHoldCandidateKey({
          gameId: game10Id,
          homeScore: 13,
          awayScore: 7,
          status: "FT",
          observedAtMs: NOW_MS + 1,
        }),
        candidateHomeScore: 13,
        candidateAwayScore: 7,
        candidateObservedAtMs: NOW_MS + 1,
        candidateStatus: "FT",
        status: "building",
        processedPools: 10,
        holdCount: 0,
        startedAtMs: NOW_MS + 1,
      });
      const game12Id = await ctx.db.insert("nflGames", {
        stableKey: "game:week-12-correction",
        seasonId: baseGame.seasonId,
        seasonLabel: baseGame.seasonLabel,
        week: 12,
        homeTeamId: baseGame.homeTeamId,
        awayTeamId: baseGame.awayTeamId,
        scheduledKickoffMs: NOW_MS + 1_000,
        lifecycle: "scheduled",
        homeScore: 14,
        awayScore: 10,
        sportsDbEventId: "week-12-correction",
        resultAuthority: "verified",
        verifiedResult: {
          homeScore: 14,
          awayScore: 10,
          status: "FT",
          verifiedAtMs: NOW_MS,
        },
        correctionCandidate: {
          homeScore: 14,
          awayScore: 13,
          status: "FT",
          observedAtMs: NOW_MS + 2,
        },
      });
      await ctx.db.insert("scoringHoldEvaluations", {
        seasonId: baseGame.seasonId,
        gameId: game12Id,
        gameWeek: 12,
        candidateKey: scoringHoldCandidateKey({
          gameId: game12Id,
          homeScore: 14,
          awayScore: 13,
          status: "FT",
          observedAtMs: NOW_MS + 2,
        }),
        candidateHomeScore: 14,
        candidateAwayScore: 13,
        candidateObservedAtMs: NOW_MS + 2,
        candidateStatus: "FT",
        status: "building",
        processedPools: 10,
        holdCount: 0,
        startedAtMs: NOW_MS + 2,
      });
      for (let week = 13; week <= 31; week++) {
        const gameId = await ctx.db.insert("nflGames", {
          stableKey: `game:week-${week}-unrelated-correction`,
          seasonId: baseGame.seasonId,
          seasonLabel: baseGame.seasonLabel,
          week,
          homeTeamId: baseGame.homeTeamId,
          awayTeamId: baseGame.awayTeamId,
          scheduledKickoffMs: NOW_MS + week * 1_000,
          lifecycle: "scheduled",
          homeScore: 14,
          awayScore: 10,
          sportsDbEventId: `week-${week}-unrelated-correction`,
          resultAuthority: "verified",
          verifiedResult: {
            homeScore: 14,
            awayScore: 10,
            status: "FT",
            verifiedAtMs: NOW_MS,
          },
          correctionCandidate: {
            homeScore: 14,
            awayScore: 13,
            status: "FT",
            observedAtMs: NOW_MS + week,
          },
        });
        await ctx.db.insert("scoringHoldEvaluations", {
          seasonId: baseGame.seasonId,
          gameId,
          gameWeek: week,
          candidateKey: scoringHoldCandidateKey({
            gameId,
            homeScore: 14,
            awayScore: 13,
            status: "FT",
            observedAtMs: NOW_MS + week,
          }),
          candidateHomeScore: 14,
          candidateAwayScore: 13,
          candidateObservedAtMs: NOW_MS + week,
          candidateStatus: "FT",
          status: "building",
          processedPools: 10,
          holdCount: 0,
          startedAtMs: NOW_MS + week,
        });
      }
      return await ctx.db.insert("pools", {
        name: "Unrelated across 21 active evaluations",
        type: "survivor",
        seasonId: baseGame.seasonId,
        startWeek: 5,
        pickLockMode: "gameKickoff",
        status: "active",
        rulesFrozen: false,
        ownerParticipantId: seeded.participantId,
        createdAtMs: NOW_MS + 100,
      });
    });
    const affected = await t.mutation(
      internal.survivorScoring.applySurvivorScoringRevision,
      { poolId: seeded.unaffectedPoolId, week: 5, nowMs: NOW_MS + 1 },
    );
    expect(affected.status).toBe("held");
    expect(affected).toMatchObject({ evaluationId: expect.any(String) });
    const unrelated = await t.mutation(
      internal.survivorScoring.applySurvivorScoringRevision,
      { poolId: unrelatedPoolId, week: 5, nowMs: NOW_MS + 2 },
    );
    expect(unrelated.status).toBe("published");
  });

  it("replays a blocked Pool beyond page 200 after its on-demand evaluation hold is withdrawn", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS + 60_000);
    const t = convexTest(schema, modules);
    const seeded = await seedHeldPools(t);
    const targetPoolId = await t.run(async (ctx) => {
      const basePool = (await ctx.db.get(seeded.survivorPoolId))!;
      for (const hold of await ctx.db.query("scoringHolds").collect()) {
        await ctx.db.patch(hold._id, {
          status: "resolved",
          resolution: "withdrawn_candidate",
          resolvedAtMs: NOW_MS - 1,
        });
      }
      for (let index = 0; index < 200; index++) {
        await ctx.db.insert("pools", {
          name: `Replay filler ${index}`,
          type: "survivor",
          seasonId: basePool.seasonId,
          startWeek: 1,
          pickLockMode: "gameKickoff",
          status: "active",
          rulesFrozen: false,
          ownerParticipantId: seeded.participantId,
          createdAtMs: NOW_MS + index,
        });
      }
      const poolId = await ctx.db.insert("pools", {
        name: "Pool after replay page 200",
        type: "survivor",
        seasonId: basePool.seasonId,
        startWeek: 1,
        pickLockMode: "gameKickoff",
        status: "active",
        rulesFrozen: false,
        ownerParticipantId: seeded.participantId,
        createdAtMs: NOW_MS + 201,
      });
      await ctx.db.insert("poolWeeks", {
        poolId,
        week: 2,
        settled: true,
        updatedAtMs: NOW_MS,
      });
      const game = (await ctx.db.get(seeded.gameId))!;
      const candidate = game.correctionCandidate!;
      await ctx.db.insert("scoringHoldEvaluations", {
        seasonId: game.seasonId,
        gameId: game._id,
        gameWeek: game.week,
        candidateKey: scoringHoldCandidateKey({
          gameId: game._id,
          ...candidate,
        }),
        candidateHomeScore: candidate.homeScore,
        candidateAwayScore: candidate.awayScore,
        candidateObservedAtMs: candidate.observedAtMs,
        candidateStatus: candidate.status,
        status: "building",
        cursor: "after-200-pools",
        processedPools: 200,
        holdCount: 0,
        startedAtMs: candidate.observedAtMs,
      });
      return poolId;
    });

    const held = await t.mutation(
      internal.survivorScoring.applySurvivorScoringRevision,
      { poolId: targetPoolId, week: 1, nowMs: NOW_MS },
    );
    expect(held.status).toBe("held");
    await t.mutation(
      internal.syncApiSportsLive.applyReconciliationObservation,
      {
        gameId: seeded.gameId,
        observation: {
          externalId: "withdraw-zero-hold-evaluation",
          observedAtMs: NOW_MS + 60_000,
          lifecycle: "terminal",
          homeScore: 27,
          awayScore: 24,
          providerStatus: {
            rawShort: "FT",
            rawLong: "Finished",
            recognized: true,
            terminal: true,
          },
        },
      },
    );
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    const state = await t.run(async (ctx) => ({
      revisions: await ctx.db
        .query("scoringRevisions")
        .withIndex("by_poolId_and_week", (q) =>
          q.eq("poolId", targetPoolId).eq("week", 1),
        )
        .filter((q) => q.eq(q.field("kind"), "survivor"))
        .collect(),
      blocked: await ctx.db
        .query("scoringBlockedWork")
        .withIndex("by_poolId_and_kind_and_status", (q) =>
          q
            .eq("poolId", targetPoolId)
            .eq("kind", "survivor")
            .eq("status", "replayed"),
        )
        .collect(),
      cleanup: (
        await ctx.db.query("scoringHoldCleanups").collect()
      )[0],
    }));
    expect(state.revisions).toHaveLength(1);
    expect(state.blocked).toHaveLength(1);
    expect(state.cleanup).toMatchObject({
      status: "complete",
      resolvedHolds: 1,
    });
  });

  it("replays scoring after slow supersession cleanup retires more than 200 old holds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS + 60_000);
    const t = convexTest(schema, modules);
    const seeded = await seedHeldPools(t);
    await t.run(async (ctx) => {
      const game = (await ctx.db.get(seeded.gameId))!;
      const candidate = game.correctionCandidate!;
      const candidateKey = scoringHoldCandidateKey({
        gameId: game._id,
        ...candidate,
      });
      for (let index = 0; index < 199; index++) {
        await ctx.db.insert("scoringHolds", {
          poolId: seeded.survivorPoolId,
          gameId: game._id,
          poolType: "survivor",
          gameWeek: game.week,
          dependency: "later_game_lock",
          candidateKey,
          dedupeKey: `${seeded.survivorPoolId}:${candidateKey}:supersede:${index}`,
          candidateHomeScore: candidate.homeScore,
          candidateAwayScore: candidate.awayScore,
          candidateObservedAtMs: candidate.observedAtMs,
          candidateStatus: candidate.status,
          officialHomeScore: game.verifiedResult!.homeScore,
          officialAwayScore: game.verifiedResult!.awayScore,
          officialVerifiedAtMs: game.verifiedResult!.verifiedAtMs,
          officialStatus: game.verifiedResult!.status,
          status: "open",
          createdAtMs: NOW_MS + index,
        });
      }
    });

    const corrected = await t.mutation(
      internal.syncApiSportsLive.applyReconciliationObservation,
      {
        gameId: seeded.gameId,
        observation: {
          externalId: "new-no-hold-candidate",
          observedAtMs: NOW_MS + 60_000,
          lifecycle: "terminal",
          homeScore: 17,
          awayScore: 31,
          providerStatus: {
            rawShort: "FT",
            rawLong: "Finished",
            recognized: true,
            terminal: true,
          },
        },
      },
    );
    expect(corrected.result).toBe("corrected");
    const interruptedSurvivor = await t.mutation(
      internal.survivorScoring.applySurvivorScoringRevision,
      {
        poolId: seeded.survivorPoolId,
        week: 1,
        nowMs: NOW_MS + 60_000,
      },
    );
    const interruptedConfidence = await t.mutation(
      internal.confidenceScoring.applyConfidenceScoringRevision,
      {
        poolId: seeded.confidencePoolId,
        week: 1,
        nowMs: NOW_MS + 60_000,
      },
    );
    expect(interruptedSurvivor.status).toBe("held");
    expect(interruptedConfidence.status).toBe("held");

    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const state = await t.run(async (ctx) => ({
      game: await ctx.db.get(seeded.gameId),
      openHolds: await ctx.db
        .query("scoringHolds")
        .withIndex("by_gameId_and_status", (q) =>
          q.eq("gameId", seeded.gameId).eq("status", "open"),
        )
        .collect(),
      revisions: await ctx.db.query("scoringRevisions").collect(),
      pendingWork: await ctx.db
        .query("scoringBlockedWork")
        .filter((q) => q.eq(q.field("status"), "pending"))
        .collect(),
      cleanup: (
        await ctx.db.query("scoringHoldCleanups").collect()
      )[0],
    }));
    expect(state.game?.verifiedResult).toMatchObject({
      homeScore: 17,
      awayScore: 31,
    });
    expect(state.openHolds).toHaveLength(0);
    expect(state.cleanup).toMatchObject({
      status: "complete",
      reason: "superseded_candidate",
      resolvedHolds: 201,
    });
    expect(state.pendingWork).toHaveLength(0);
    expect(
      state.revisions.map((revision) => ({
        poolId: revision.poolId,
        kind: revision.kind,
      })),
    ).toEqual(
      expect.arrayContaining([
        { poolId: seeded.survivorPoolId, kind: "survivor" },
        { poolId: seeded.confidencePoolId, kind: "confidence" },
      ]),
    );
  });

  it("withdrawal retires 201 holds and its single active evaluation before replay", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS + 60_000);
    const t = convexTest(schema, modules);
    const seeded = await seedHeldPools(t);
    await t.run(async (ctx) => {
      const game = (await ctx.db.get(seeded.gameId))!;
      const candidate = game.correctionCandidate!;
      const candidateKey = scoringHoldCandidateKey({
        gameId: game._id,
        ...candidate,
      });
      await ctx.db.insert("scoringHoldEvaluations", {
        seasonId: game.seasonId,
        gameId: game._id,
        gameWeek: game.week,
        candidateKey,
        candidateHomeScore: candidate.homeScore,
        candidateAwayScore: candidate.awayScore,
        candidateObservedAtMs: candidate.observedAtMs,
        candidateStatus: candidate.status,
        status: "building",
        cursor: "evaluation-after-page-200",
        processedPools: 200,
        holdCount: 0,
        startedAtMs: NOW_MS,
      });
      for (let index = 0; index < 199; index++) {
        await ctx.db.insert("scoringHolds", {
          poolId: seeded.survivorPoolId,
          gameId: game._id,
          poolType: "survivor",
          gameWeek: game.week,
          dependency: "later_game_lock",
          candidateKey,
          dedupeKey: `${seeded.survivorPoolId}:${candidateKey}:${index}`,
          candidateHomeScore: candidate.homeScore,
          candidateAwayScore: candidate.awayScore,
          candidateObservedAtMs: candidate.observedAtMs,
          candidateStatus: candidate.status,
          officialHomeScore: game.verifiedResult!.homeScore,
          officialAwayScore: game.verifiedResult!.awayScore,
          officialVerifiedAtMs: game.verifiedResult!.verifiedAtMs,
          officialStatus: game.verifiedResult!.status,
          status: "open",
          createdAtMs: NOW_MS + index,
        });
      }
    });

    await t.mutation(
      internal.syncApiSportsLive.applyReconciliationObservation,
      {
        gameId: seeded.gameId,
        observation: {
          externalId: "withdraw-large-candidate",
          observedAtMs: NOW_MS + 60_000,
          lifecycle: "terminal",
          homeScore: 27,
          awayScore: 24,
          providerStatus: {
            rawShort: "FT",
            rawLong: "Finished",
            recognized: true,
            terminal: true,
          },
        },
      },
    );
    const partialCleanup = await t.run(async (ctx) =>
      (
        await ctx.db.query("scoringHoldCleanups").collect()
      )[0],
    );
    expect(partialCleanup?.status).toBe("pending");
    const unrelated = await t.mutation(
      internal.survivorScoring.applySurvivorScoringRevision,
      {
        poolId: seeded.unaffectedPoolId,
        week: 1,
        nowMs: NOW_MS + 60_000,
      },
    );
    expect(unrelated.status).toBe("published");
    const unrelatedView = await seeded.asOperator.query(
      api.survivorScoring.getSurvivorStandingsGrid,
      { poolId: seeded.unaffectedPoolId },
    );
    expect(unrelatedView?.scoringHold).toBeNull();
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    const state = await t.run(async (ctx) => ({
      holds: await ctx.db.query("scoringHolds").collect(),
      evaluations: await ctx.db
        .query("scoringHoldEvaluations")
        .collect(),
      cleanups: await ctx.db.query("scoringHoldCleanups").collect(),
    }));
    expect(state.holds).toHaveLength(201);
    expect(
      state.holds.every((hold) => hold.status === "resolved"),
    ).toBe(true);
    expect(
      state.evaluations.every(
        (evaluation) => evaluation.status === "abandoned",
      ),
    ).toBe(true);
    expect(state.cleanups).toEqual([
      expect.objectContaining({ status: "complete" }),
    ]);
  });

  it("paginates every open hold without silently truncating the operator queue", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedHeldPools(t);
    await t.run(async (ctx) => {
      const game = (await ctx.db.get(seeded.gameId))!;
      const pool = (await ctx.db.get(seeded.survivorPoolId))!;
      for (let index = 0; index < 105; index++) {
        const gameId = await ctx.db.insert("nflGames", {
          stableKey: `game:queue:${index}`,
          seasonId: game.seasonId,
          seasonLabel: game.seasonLabel,
          week: 1,
          homeTeamId: game.homeTeamId,
          awayTeamId: game.awayTeamId,
          scheduledKickoffMs: game.scheduledKickoffMs,
          lifecycle: "terminal",
          homeScore: 10,
          awayScore: 7,
          sportsDbEventId: `legacy-queue-${index}`,
          resultAuthority: "verified",
          verifiedResult: {
            homeScore: 10,
            awayScore: 7,
            status: "FT",
            verifiedAtMs: NOW_MS,
          },
        });
        const candidateKey = scoringHoldCandidateKey({
          gameId,
          homeScore: 13,
          awayScore: 7,
          observedAtMs: NOW_MS + index,
          status: "FT",
        });
        await ctx.db.insert("scoringHolds", {
          poolId: pool._id,
          gameId,
          poolType: "survivor",
          gameWeek: 1,
          dependency: "settled_pool_week",
          candidateKey,
          dedupeKey: scoringHoldDedupeKey({
            poolId: pool._id,
            candidateKey,
          }),
          candidateHomeScore: 13,
          candidateAwayScore: 7,
          candidateObservedAtMs: NOW_MS + index,
          candidateStatus: "FT",
          officialHomeScore: 10,
          officialAwayScore: 7,
          officialVerifiedAtMs: NOW_MS,
          officialStatus: "FT",
          status: "open",
          createdAtMs: NOW_MS + index,
        });
      }
    });

    const first = await seeded.asOperator.query(
      api.scoringHolds.listOperatorScoringHolds,
      {
        status: "open",
        paginationOpts: { numItems: 50, cursor: null },
      },
    );
    const second = await seeded.asOperator.query(
      api.scoringHolds.listOperatorScoringHolds,
      {
        status: "open",
        paginationOpts: {
          numItems: 50,
          cursor: first.continueCursor,
        },
      },
    );
    const third = await seeded.asOperator.query(
      api.scoringHolds.listOperatorScoringHolds,
      {
        status: "open",
        paginationOpts: {
          numItems: 50,
          cursor: second.continueCursor,
        },
      },
    );
    expect([
      ...first.page,
      ...second.page,
      ...third.page,
    ]).toHaveLength(107);
  });
});
