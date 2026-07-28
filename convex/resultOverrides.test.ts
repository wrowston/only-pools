/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, internal } from "./_generated/api";
import { scoringHoldCandidateKey } from "./lib/scoringHolds";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const NOW_MS = Date.UTC(2026, 8, 14, 20);

function identity(subject: string) {
  return {
    subject,
    issuer: "https://auth.example.test",
    tokenIdentifier: `https://auth.example.test|${subject}`,
    name: subject,
    email: `${subject}@example.test`,
    emailVerified: true,
    phoneNumber: "+15551234567",
    phoneNumberVerified: true,
    sid: `session_${subject}`,
  };
}

async function seedVerifiedGame(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const seasonId = await ctx.db.insert("poolSeasons", {
      label: "2026",
      year: 2026,
      status: "available",
      usableStartWeek: 1,
      bootstrappedAtMs: NOW_MS - 1_000,
    });
    const homeTeamId = await ctx.db.insert("nflTeams", {
      stableKey: "nfl-team:gb",
      name: "Green Bay Packers",
      abbreviation: "GB",
      sportsDbTeamId: "legacy-gb",
    });
    const awayTeamId = await ctx.db.insert("nflTeams", {
      stableKey: "nfl-team:det",
      name: "Detroit Lions",
      abbreviation: "DET",
      sportsDbTeamId: "legacy-det",
    });
    const gameId = await ctx.db.insert("nflGames", {
      stableKey: "nfl:2026:w1:det@gb",
      seasonId,
      seasonLabel: "2026",
      week: 1,
      homeTeamId,
      awayTeamId,
      scheduledKickoffMs: NOW_MS - 2 * 60 * 60 * 1_000,
      lifecycle: "terminal",
      kickoffLockReachedAtMs: NOW_MS - 2 * 60 * 60 * 1_000,
      homeScore: 27,
      awayScore: 24,
      sportsDbEventId: "legacy-game",
      resultAuthority: "verified",
      verifiedResult: {
        homeScore: 27,
        awayScore: 24,
        status: "FT",
        verifiedAtMs: NOW_MS - 60 * 60 * 1_000,
      },
      lastObservedAtMs: NOW_MS - 60 * 60 * 1_000,
      revision: 1,
    });
    await ctx.db.insert("nflGameAliases", {
      nflGameId: gameId,
      provider: "api-sports",
      externalId: "77779",
      isCurrent: true,
      firstObservedAtMs: NOW_MS - 2 * 60 * 60 * 1_000,
      lastObservedAtMs: NOW_MS,
    });
    return { seasonId, gameId };
  });
}

const replacedResult = {
  homeScore: 27,
  awayScore: 24,
  status: "FT" as const,
  verifiedAtMs: NOW_MS - 60 * 60 * 1_000,
};

const overrideResult = {
  homeScore: 30,
  awayScore: 24,
  status: "FT" as const,
};

async function steppedUpOperator(t: ReturnType<typeof convexTest>) {
  const asOperator = t.withIdentity(identity("operator"));
  await asOperator.mutation(api.participants.ensureMyParticipant, {});
  await t.run(async (ctx) => {
    const participant = (await ctx.db.query("participants").take(10)).find(
      (row) => row.clerkUserId === "operator",
    );
    await ctx.db.patch(participant!._id, {
      operatorStepUpVerifiedAtMs: NOW_MS,
      operatorStepUpSessionId: "session_operator",
    });
  });
  return asOperator;
}

describe("pinned Production Operator NFL Game result overrides", () => {
  const previousOperator =
    process.env.PRODUCTION_OPERATOR_CLERK_USER_ID;
  const previousDeploymentKind = process.env.DEPLOYMENT_KIND;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
    process.env.PRODUCTION_OPERATOR_CLERK_USER_ID = "operator";
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

  it("denies pool owners and requires a separately completed fresh step-up", async () => {
    const t = convexTest(schema, modules);
    const { gameId } = await seedVerifiedGame(t);
    const asOwner = t.withIdentity(identity("owner"));
    await asOwner.mutation(api.participants.ensureMyParticipant, {});
    await asOwner.mutation(api.invites.confirmStepUp, {});

    await expect(
      asOwner.query(api.resultOverrides.listOperatorResultOverrides, {
        status: "active",
        paginationOpts: { numItems: 20, cursor: null },
      }),
    ).rejects.toThrow(/Production Operator required/);
    await expect(
      asOwner.mutation(api.resultOverrides.pinNflGameResultOverride, {
        gameId,
        reason: "Provider reported the wrong final.",
        replacedResult,
        overrideResult,
      }),
    ).rejects.toThrow(/Production Operator required/);

    const asOperator = t.withIdentity(identity("operator"));
    await asOperator.mutation(api.participants.ensureMyParticipant, {});
    await asOperator.mutation(api.invites.confirmStepUp, {});
    await expect(
      asOperator.mutation(api.resultOverrides.pinNflGameResultOverride, {
        gameId,
        reason: "Provider reported the wrong final.",
        replacedResult,
        overrideResult,
      }),
    ).rejects.toThrow(/Step-up/i);
  });

  it("requires a reason and the exact result being replaced", async () => {
    const t = convexTest(schema, modules);
    const { gameId } = await seedVerifiedGame(t);
    const asOperator = await steppedUpOperator(t);

    await expect(
      asOperator.mutation(api.resultOverrides.pinNflGameResultOverride, {
        gameId,
        reason: "   ",
        replacedResult,
        overrideResult,
      }),
    ).rejects.toThrow(/reason/i);
    await expect(
      asOperator.mutation(api.resultOverrides.pinNflGameResultOverride, {
        gameId,
        reason: "Provider reported the wrong final.",
        replacedResult: { ...replacedResult, homeScore: 28 },
        overrideResult,
      }),
    ).rejects.toThrow(/replaced result/i);
  });

  it("queries active pins independently from more recent released history", async () => {
    const t = convexTest(schema, modules);
    const { gameId } = await seedVerifiedGame(t);
    const activeOverrideId = await t.run(async (ctx) => {
      const activeId = await ctx.db.insert("nflGameResultOverrides", {
        nflGameId: gameId,
        gameStableKey: "nfl:2026:w1:det@gb",
        seasonLabel: "2026",
        gameWeek: 1,
        homeTeamAbbreviation: "GB",
        awayTeamAbbreviation: "DET",
        status: "active",
        reason: "Older active pin",
        replacedResult,
        overrideResult: { ...overrideResult, verifiedAtMs: NOW_MS - 100 },
        actorTokenIdentifier: "https://auth.example.test|operator",
        actorClerkUserId: "operator",
        pinnedAtMs: NOW_MS - 100,
      });
      for (let index = 0; index < 35; index++) {
        await ctx.db.insert("nflGameResultOverrides", {
          nflGameId: gameId,
          gameStableKey: "nfl:2026:w1:det@gb",
          seasonLabel: "2026",
          gameWeek: 1,
          homeTeamAbbreviation: "GB",
          awayTeamAbbreviation: "DET",
          status: "released",
          reason: `Released override ${index}`,
          replacedResult,
          overrideResult: {
            ...overrideResult,
            verifiedAtMs: NOW_MS + index,
          },
          actorTokenIdentifier: "https://auth.example.test|operator",
          actorClerkUserId: "operator",
          pinnedAtMs: NOW_MS + index,
          releaseReason: "Released",
          releasedAtMs: NOW_MS + index + 1,
          releasedByTokenIdentifier:
            "https://auth.example.test|operator",
          releasedByClerkUserId: "operator",
        });
      }
      return activeId;
    });
    const asOperator = t.withIdentity(identity("operator"));
    const result = await asOperator.query(
      api.resultOverrides.listOperatorResultOverrides,
      {
        status: "active",
        paginationOpts: { numItems: 30, cursor: null },
      },
    );
    expect(result.page.map((row) => row._id)).toEqual([
      activeOverrideId,
    ]);
  });

  it("pins the result, retains conflicting provider evidence, and never lets it overwrite", async () => {
    const t = convexTest(schema, modules);
    const { gameId } = await seedVerifiedGame(t);
    const asOperator = await steppedUpOperator(t);

    const pinned = await asOperator.mutation(
      api.resultOverrides.pinNflGameResultOverride,
      {
        gameId,
        reason: "League gamebook confirms a 30-24 final.",
        replacedResult,
        overrideResult,
      },
    );
    const providerResult = await t.mutation(
      internal.syncApiSportsLive.applyReconciliationObservation,
      {
        gameId,
        observation: {
          externalId: "77779",
          observedAtMs: NOW_MS - 500,
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

    expect(providerResult).toEqual({ result: "pinned_conflicting" });
    expect(
      await t.mutation(
        internal.syncApiSportsLive.applyReconciliationObservation,
        {
          gameId,
          observation: {
            externalId: "77779",
            observedAtMs: NOW_MS + 10_500,
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
      ),
    ).toEqual({ result: "pinned_conflicting" });
    const state = await t.run(async (ctx) => {
      const game = await ctx.db.get(gameId);
      const override = await ctx.db.get(pinned.overrideId);
      const evidenceRows = await ctx.db
        .query("nflGameResultReconciliationObservations")
        .withIndex("by_pinnedOverrideId_and_observedAtMs", (q) =>
          q.eq("pinnedOverrideId", pinned.overrideId),
        )
        .collect();
      return { game, override, evidenceRows };
    });
    expect(state.game?.verifiedResult).toMatchObject(overrideResult);
    expect(state.game?.pinnedResultOverrideId).toBe(pinned.overrideId);
    expect(state.override?.status).toBe("active");
    expect(state.evidenceRows).toHaveLength(1);
    expect(state.evidenceRows[0]?.disposition).toBe("pinned_conflicting");
    expect(state.evidenceRows[0]?.pinnedOverrideId).toBe(pinned.overrideId);
  });

  it("enqueues episode-scoped targeted API-Sports evidence and retries until a late pin receives terminal evidence", async () => {
    const t = convexTest(schema, modules);
    const { gameId } = await seedVerifiedGame(t);
    const lateReplacedResult = {
      ...replacedResult,
      verifiedAtMs: NOW_MS - 7 * 24 * 60 * 60_000,
    };
    await t.run(async (ctx) => {
      await ctx.db.patch(gameId, {
        verifiedResult: lateReplacedResult,
        lastObservedAtMs: lateReplacedResult.verifiedAtMs,
      });
      await ctx.db.insert("syncGate", {
        key: "deployment",
        enabled: true,
        updatedAtMs: NOW_MS,
      });
    });
    const asOperator = await steppedUpOperator(t);
    const pin = await asOperator.mutation(
      api.resultOverrides.pinNflGameResultOverride,
      {
        gameId,
        reason: "Late independent gamebook correction.",
        replacedResult: lateReplacedResult,
        overrideResult,
      },
    );
    const workItem = await t.run(async (ctx) =>
      ctx.db
        .query("syncWorkItems")
        .withIndex("by_scopeKey", (q) =>
          q.eq(
            "scopeKey",
            `pinned-result-evidence:${pin.overrideId}`,
          ),
        )
        .unique(),
    );
    expect(workItem).toMatchObject({
      surface: "correction",
      priority: "confirmation",
      status: "due",
      dueAtMs: NOW_MS,
      gameId,
      pinnedResultOverrideId: pin.overrideId,
      purpose: "pinned_result_evidence",
    });

    const dispatched = await t.mutation(
      internal.syncLive.dispatchSyncWork,
      { nowMs: NOW_MS, maxClaims: 20 },
    );
    expect(dispatched.claimed).toContainEqual(
      expect.objectContaining({
        workItemId: workItem!._id,
        surface: "correction",
      }),
    );
    expect(
      await t.action(
        internal.syncApiSportsLive.applyReconciliationLookupResult,
        {
          workItemId: workItem!._id,
          gameId,
          expectedPinnedOverrideId: pin.overrideId,
          requestedExternalId: "77779",
          observation: null,
          nowMs: NOW_MS + 1_000,
        },
      ),
    ).toMatchObject({ ok: false, reason: "empty_lookup" });
    const afterFailure = await t.run(async (ctx) =>
      ctx.db.get(workItem!._id),
    );
    expect(afterFailure).toMatchObject({
      status: "due",
      dueAtMs: NOW_MS + 61_000,
    });

    expect(
      await t.action(
        internal.syncApiSportsLive.applyReconciliationLookupResult,
        {
          workItemId: workItem!._id,
          gameId,
          expectedPinnedOverrideId: pin.overrideId,
          requestedExternalId: "77779",
          observation: {
            externalId: "77779",
            observedAtMs: NOW_MS + 62_000,
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
          nowMs: NOW_MS + 62_000,
        },
      ),
    ).toMatchObject({ ok: true, result: "pinned_conflicting" });
    const finalState = await t.run(async (ctx) => ({
      workItem: await ctx.db.get(workItem!._id),
      evidence: await ctx.db
        .query("nflGameResultOverrideEvidence")
        .withIndex(
          "by_overrideId_and_disposition_and_observedAtMs",
          (q) =>
            q
              .eq("overrideId", pin.overrideId)
              .eq("disposition", "pinned_conflicting"),
        )
        .collect(),
    }));
    expect(finalState.workItem).toMatchObject({
      status: "due",
      dueAtMs: NOW_MS + 62_000 + 6 * 60 * 60_000,
    });
    expect(finalState.evidence).toHaveLength(1);
    expect(
      await t.action(
        internal.syncApiSportsLive.applyReconciliationLookupResult,
        {
          workItemId: workItem!._id,
          gameId,
          expectedPinnedOverrideId: pin.overrideId,
          requestedExternalId: "77779",
          observation: {
            externalId: "77779",
            observedAtMs: NOW_MS + 61_000,
            lifecycle: "terminal",
            homeScore: 24,
            awayScore: 21,
            providerStatus: {
              rawShort: "FT",
              rawLong: "Finished",
              recognized: true,
              terminal: true,
            },
          },
          nowMs: NOW_MS + 63_000,
        },
      ),
    ).toMatchObject({ ok: true, result: "stale" });
    expect(
      await t.run(async (ctx) => ctx.db.get(workItem!._id)),
    ).toMatchObject({
      status: "due",
      dueAtMs: NOW_MS + 63_000 + 6 * 60 * 60_000,
    });
    await asOperator.mutation(
      api.resultOverrides.releaseNflGameResultOverride,
      {
        overrideId: pin.overrideId,
        reason: "Provider evidence is now retained.",
      },
    );
    expect(
      await t.run(async (ctx) => ctx.db.get(workItem!._id)),
    ).toMatchObject({ status: "done" });
    expect(
      await t.action(
        internal.syncApiSportsLive.applyReconciliationLookupResult,
        {
          workItemId: workItem!._id,
          gameId,
          expectedPinnedOverrideId: pin.overrideId,
          requestedExternalId: "77779",
          observation: {
            externalId: "77779",
            observedAtMs: NOW_MS + 64_000,
            lifecycle: "terminal",
            homeScore: 3,
            awayScore: 0,
            providerStatus: {
              rawShort: "FT",
              rawLong: "Finished",
              recognized: true,
              terminal: true,
            },
          },
          nowMs: NOW_MS + 64_000,
        },
      ),
    ).toMatchObject({ ok: true, result: "pin_episode_ended" });
    const afterStaleAction = await t.run(async (ctx) => ({
      game: await ctx.db.get(gameId),
      workItem: await ctx.db.get(workItem!._id),
    }));
    expect(afterStaleAction.game?.verifiedResult).toMatchObject(
      overrideResult,
    );
    expect(afterStaleAction.workItem?.status).toBe("done");
    expect(
      await t.mutation(internal.syncLive.requeueFailedWork, {
        workItemId: workItem!._id,
        dueAtMs: NOW_MS + 65_000,
        gameId,
        expectedPinnedOverrideId: pin.overrideId,
      }),
    ).toEqual({ requeued: false });
    expect(
      await t.run(async (ctx) => ctx.db.get(workItem!._id)),
    ).toMatchObject({ status: "done" });
  });

  it("keeps pinned live-ingestion freshness while deduplicating polls and rejecting stale evidence", async () => {
    const t = convexTest(schema, modules);
    const { gameId } = await seedVerifiedGame(t);
    const asOperator = await steppedUpOperator(t);
    const pin = await asOperator.mutation(
      api.resultOverrides.pinNflGameResultOverride,
      {
        gameId,
        reason: "League gamebook confirms a 30-24 final.",
        replacedResult,
        overrideResult,
      },
    );
    const terminalLiveObservation = (
      observedAtMs: number,
      homeScore: number,
    ) => ({
      externalId: "77779",
      observedAtMs,
      lifecycle: "terminal" as const,
      homeScore,
      awayScore: 24,
      providerStatus: {
        rawShort: "FT",
        rawLong: "Finished",
        recognized: true,
        terminal: true,
      },
    });

    expect(
      await t.mutation(internal.syncApiSportsLive.applyObservation, {
        observation: terminalLiveObservation(NOW_MS + 1_000, 27),
      }),
    ).toMatchObject({ status: "pinned" });
    expect(
      await t.mutation(internal.syncApiSportsLive.applyObservation, {
        observation: terminalLiveObservation(NOW_MS + 2_000, 27),
      }),
    ).toMatchObject({ status: "duplicate" });
    expect(
      await t.mutation(internal.syncApiSportsLive.applyObservation, {
        observation: terminalLiveObservation(NOW_MS + 1_500, 28),
      }),
    ).toMatchObject({ status: "stale" });
    expect(
      await t.mutation(internal.syncApiSportsLive.applyObservation, {
        observation: terminalLiveObservation(NOW_MS + 3_000, 28),
      }),
    ).toMatchObject({ status: "pinned" });

    const state = await t.run(async (ctx) => ({
      game: await ctx.db.get(gameId),
      ingestion: await ctx.db
        .query("liveGameIngestionState")
        .withIndex("by_nflGameId", (q) => q.eq("nflGameId", gameId))
        .unique(),
      evidence: await ctx.db
        .query("nflGameResultReconciliationObservations")
        .withIndex("by_pinnedOverrideId_and_observedAtMs", (q) =>
          q.eq("pinnedOverrideId", pin.overrideId),
        )
        .collect(),
    }));
    expect(state.game?.verifiedResult).toMatchObject(overrideResult);
    expect(state.ingestion?.lastAppliedObservedAtMs).toBe(NOW_MS + 3_000);
    expect(state.evidence).toHaveLength(2);
    expect(state.evidence.map((row) => row.homeScore)).toEqual([27, 28]);
  });

  it("neutralizes legacy live and confirmation writers, retains their evidence, and retires queued confirmation work", async () => {
    const t = convexTest(schema, modules);
    const { gameId, seasonId } = await seedVerifiedGame(t);
    await t.run(async (ctx) => {
      for (const [purpose, status] of [
        ["confirmation_15", "due"],
        ["confirmation_60", "claimed"],
      ] as const) {
        await ctx.db.insert("syncWorkItems", {
          surface: "confirmation",
          scopeKey: `confirmation:${gameId}:${purpose}`,
          priority: "confirmation",
          status,
          dueAtMs: NOW_MS,
          attemptCount: 0,
          claimedAtMs: status === "claimed" ? NOW_MS : undefined,
          leaseExpiresAtMs:
            status === "claimed" ? NOW_MS + 60_000 : undefined,
          gameId,
          seasonId,
          purpose,
        });
      }
    });
    const asOperator = await steppedUpOperator(t);
    const pin = await asOperator.mutation(
      api.resultOverrides.pinNflGameResultOverride,
      {
        gameId,
        reason: "Legacy ingestion must not bypass the pin.",
        replacedResult,
        overrideResult,
      },
    );

    expect(
      await t.mutation(internal.syncLive.applyLiveObservation, {
        observation: {
          gameId,
          observedAtMs: NOW_MS + 1_000,
          lifecycle: "terminal",
          homeScore: 26,
          awayScore: 24,
          terminalStatus: "FT",
        },
      }),
    ).toMatchObject({ resultAuthority: "verified" });
    expect(
      await t.mutation(
        internal.syncLive.applyConfirmationObservationMutation,
        {
          observation: {
            gameId,
            observedAtMs: NOW_MS + 2_000,
            homeScore: 27,
            awayScore: 24,
            status: "FT",
          },
        },
      ),
    ).toMatchObject({ resultAuthority: "verified" });

    const state = await t.run(async (ctx) => ({
      game: await ctx.db.get(gameId),
      evidence: await ctx.db
        .query("nflGameResultReconciliationObservations")
        .withIndex("by_pinnedOverrideId_and_observedAtMs", (q) =>
          q.eq("pinnedOverrideId", pin.overrideId),
        )
        .collect(),
      confirmationWork: await ctx.db
        .query("syncWorkItems")
        .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
        .filter((q) => q.eq(q.field("surface"), "confirmation"))
        .collect(),
    }));
    expect(state.game?.verifiedResult).toMatchObject(overrideResult);
    expect(state.evidence.map((row) => row.homeScore)).toEqual([26, 27]);
    expect(
      state.confirmationWork.every((item) => item.status === "done"),
    ).toBe(true);
  });

  it("retires post-apply open holds and acceptance even after the correction candidate was cleared", async () => {
    const t = convexTest(schema, modules);
    const { gameId, seasonId } = await seedVerifiedGame(t);
    const asOperator = await steppedUpOperator(t);
    const workflow = await t.run(async (ctx) => {
      const candidate = {
        homeScore: 28,
        awayScore: 24,
        status: "FT" as const,
        observedAtMs: NOW_MS - 1_000,
      };
      const candidateKey = scoringHoldCandidateKey({
        gameId,
        ...candidate,
      });
      const participantId = await ctx.db.insert("participants", {
        clerkUserId: "workflow-member",
        tokenIdentifier: "https://auth.example.test|workflow-member",
        displayName: "Workflow Member",
        emailVerified: true,
        phoneVerified: true,
        ageConfirmed: true,
        suspended: false,
      });
      const poolId = await ctx.db.insert("pools", {
        name: "Workflow Pool",
        type: "survivor",
        seasonId,
        startWeek: 1,
        pickLockMode: "gameKickoff",
        status: "active",
        rulesFrozen: true,
        ownerParticipantId: participantId,
        createdAtMs: NOW_MS,
      });
      const holdId = await ctx.db.insert("scoringHolds", {
        poolId,
        gameId,
        poolType: "survivor",
        gameWeek: 1,
        dependency: "later_game_lock",
        candidateKey,
        dedupeKey: `test:${candidateKey}`,
        candidateHomeScore: 28,
        candidateAwayScore: 24,
        candidateObservedAtMs: candidate.observedAtMs,
        candidateStatus: "FT",
        officialHomeScore: 27,
        officialAwayScore: 24,
        officialVerifiedAtMs: replacedResult.verifiedAtMs,
        officialStatus: "FT",
        status: "open",
        createdAtMs: candidate.observedAtMs,
      });
      const acceptanceId = await ctx.db.insert(
        "scoringHoldAcceptances",
        {
          seasonId,
          gameId,
          gameWeek: 1,
          candidateKey,
          status: "resolving_holds",
          validatedHolds: 1,
          processedHolds: 0,
          actorTokenIdentifier: "https://auth.example.test|operator",
          actorClerkUserId: "operator",
          startedAtMs: NOW_MS - 500,
          appliedAtMs: NOW_MS - 500,
        },
      );
      return { acceptanceId, holdId, candidateKey };
    });

    const pin = await asOperator.mutation(
      api.resultOverrides.pinNflGameResultOverride,
      {
        gameId,
        reason: "League gamebook supersedes the pending provider candidate.",
        replacedResult,
        overrideResult,
      },
    );
    const state = await t.run(async (ctx) => ({
      game: await ctx.db.get(gameId),
      acceptance: await ctx.db.get(workflow.acceptanceId),
      hold: await ctx.db.get(workflow.holdId),
      pinAudit: (
        await ctx.db
          .query("operatorAuditEvents")
          .withIndex("by_atMs")
          .order("desc")
          .take(2)
      ).find((row) => row.action === "nfl_game_result_override_pinned"),
    }));
    expect(state.game?.pinnedResultOverrideId).toBe(pin.overrideId);
    expect(state.game?.correctionCandidate).toBeUndefined();
    expect(state.acceptance?.status).toBe("abandoned");
    expect(state.hold).toMatchObject({
      status: "resolved",
      resolution: "superseded_candidate",
    });
    expect(JSON.parse(state.pinAudit!.detailsJson!)).toMatchObject({
      retiredCandidateKey: workflow.candidateKey,
    });
  });

  it("blocks release until cursor-batched cleanup retires 201 old holds", async () => {
    const t = convexTest(schema, modules);
    const { gameId, seasonId } = await seedVerifiedGame(t);
    const candidate = {
      homeScore: 28,
      awayScore: 24,
      status: "FT" as const,
      observedAtMs: NOW_MS - 1_000,
    };
    const candidateKey = scoringHoldCandidateKey({
      gameId,
      ...candidate,
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(gameId, { correctionCandidate: candidate });
      const participantId = await ctx.db.insert("participants", {
        clerkUserId: "cleanup-owner",
        tokenIdentifier: "https://auth.example.test|cleanup-owner",
        displayName: "Cleanup Owner",
        emailVerified: true,
        phoneVerified: true,
        ageConfirmed: true,
        suspended: false,
      });
      for (let index = 0; index < 201; index++) {
        const poolId = await ctx.db.insert("pools", {
          name: `Cleanup Pool ${index}`,
          type: "survivor",
          seasonId,
          startWeek: 1,
          pickLockMode: "gameKickoff",
          status: "active",
          rulesFrozen: true,
          ownerParticipantId: participantId,
          createdAtMs: NOW_MS + index,
        });
        await ctx.db.insert("scoringHolds", {
          poolId,
          gameId,
          poolType: "survivor",
          gameWeek: 1,
          dependency: "later_game_lock",
          candidateKey,
          dedupeKey: `${poolId}:${candidateKey}`,
          candidateHomeScore: candidate.homeScore,
          candidateAwayScore: candidate.awayScore,
          candidateObservedAtMs: candidate.observedAtMs,
          candidateStatus: candidate.status,
          officialHomeScore: replacedResult.homeScore,
          officialAwayScore: replacedResult.awayScore,
          officialVerifiedAtMs: replacedResult.verifiedAtMs,
          officialStatus: replacedResult.status,
          status: "open",
          createdAtMs: NOW_MS + index,
        });
      }
    });
    const asOperator = await steppedUpOperator(t);
    const pin = await asOperator.mutation(
      api.resultOverrides.pinNflGameResultOverride,
      {
        gameId,
        reason: "Large hold cleanup must complete before release.",
        replacedResult,
        overrideResult,
      },
    );
    await t.mutation(
      internal.syncApiSportsLive.applyReconciliationObservation,
      {
        gameId,
        observation: {
          externalId: "77779",
          observedAtMs: NOW_MS + 1_000,
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

    await expect(
      asOperator.mutation(
        api.resultOverrides.releaseNflGameResultOverride,
        {
          overrideId: pin.overrideId,
          reason: "Release only after cleanup.",
        },
      ),
    ).rejects.toThrow(/cleanup.*processing|processing.*cleanup/i);
    const beforeDrain = await t.run(async (ctx) => ({
      override: await ctx.db.get(pin.overrideId),
      cleanup: (
        await ctx.db
          .query("scoringHoldCleanups")
          .withIndex(
            "by_gameId_and_candidateKey_and_status",
            (q) =>
              q
                .eq("gameId", gameId)
                .eq("candidateKey", candidateKey)
                .eq("status", "pending"),
          )
          .unique()
      ),
    }));
    expect(beforeDrain.override?.status).toBe("active");
    expect(beforeDrain.cleanup?.status).toBe("pending");

    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    await asOperator.mutation(
      api.resultOverrides.releaseNflGameResultOverride,
      {
        overrideId: pin.overrideId,
        reason: "Cleanup complete; return to provider policy.",
      },
    );
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const afterDrain = await t.run(async (ctx) => ({
      override: await ctx.db.get(pin.overrideId),
      openHolds: await ctx.db
        .query("scoringHolds")
        .withIndex("by_gameId_and_status", (q) =>
          q.eq("gameId", gameId).eq("status", "open"),
        )
        .collect(),
    }));
    expect(afterDrain.override?.status).toBe("released");
    expect(afterDrain.openHolds).toEqual([]);
  });

  it("defers release when no provider evidence was received during the pin episode", async () => {
    const t = convexTest(schema, modules);
    const { gameId } = await seedVerifiedGame(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(gameId, { lastObservedAtMs: NOW_MS - 1_000 });
    });
    const asOperator = await steppedUpOperator(t);
    const pin = await asOperator.mutation(
      api.resultOverrides.pinNflGameResultOverride,
      {
        gameId,
        reason: "Temporary independent result authority.",
        replacedResult,
        overrideResult,
      },
    );
    await expect(
      asOperator.mutation(
        api.resultOverrides.releaseNflGameResultOverride,
        {
          overrideId: pin.overrideId,
          reason: "Return to provider authority.",
        },
      ),
    ).rejects.toThrow(/provider evidence.*pin|pin.*provider evidence/i);
    const state = await t.run(async (ctx) => ({
      game: await ctx.db.get(gameId),
      override: await ctx.db.get(pin.overrideId),
    }));
    expect(state.game?.pinnedResultOverrideId).toBe(pin.overrideId);
    expect(state.override?.status).toBe("active");
    expect(state.game?.verifiedResult).toMatchObject(overrideResult);
  });

  it("uses creation order to choose the latest evidence when matching and conflicting rows share an observation time", async () => {
    const t = convexTest(schema, modules);
    const { gameId } = await seedVerifiedGame(t);
    const asOperator = await steppedUpOperator(t);
    const pin = await asOperator.mutation(
      api.resultOverrides.pinNflGameResultOverride,
      {
        gameId,
        reason: "Equal provider timestamps need deterministic ordering.",
        replacedResult,
        overrideResult,
      },
    );
    const observationAtMs = NOW_MS + 1_000;
    await t.mutation(
      internal.syncApiSportsLive.applyReconciliationObservation,
      {
        gameId,
        expectedPinnedOverrideId: pin.overrideId,
        observation: {
          externalId: "77779",
          observedAtMs: observationAtMs,
          lifecycle: "terminal",
          homeScore: 30,
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
    await t.mutation(
      internal.syncApiSportsLive.applyReconciliationObservation,
      {
        gameId,
        expectedPinnedOverrideId: pin.overrideId,
        observation: {
          externalId: "77779",
          observedAtMs: observationAtMs,
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
    await asOperator.mutation(
      api.resultOverrides.releaseNflGameResultOverride,
      {
        overrideId: pin.overrideId,
        reason: "Use the later-created conflicting evidence.",
      },
    );
    const releaseAudit = await t.run(async (ctx) =>
      (
        await ctx.db
          .query("operatorAuditEvents")
          .withIndex("by_atMs")
          .order("desc")
          .take(10)
      ).find(
        (event) =>
          event.action === "nfl_game_result_override_released",
      ),
    );
    expect(JSON.parse(releaseAudit!.detailsJson!)).toMatchObject({
      releaseEvidence: {
      observedAtMs: NOW_MS + 1_000,
      homeScore: 27,
      },
    });
  });

  it("records the first terminal poll in a new pin episode even when the global fingerprint is duplicate", async () => {
    const t = convexTest(schema, modules);
    const { gameId } = await seedVerifiedGame(t);
    const providerObservation = {
      externalId: "77779",
      observedAtMs: NOW_MS - 500,
      lifecycle: "terminal" as const,
      homeScore: 27,
      awayScore: 24,
      providerStatus: {
        rawShort: "FT",
        rawLong: "Finished",
        recognized: true,
        terminal: true,
      },
    };
    await t.run(async (ctx) => {
      await ctx.db.insert("liveGameIngestionState", {
        nflGameId: gameId,
        lastFingerprint: JSON.stringify({
          provider: "api-sports",
          externalId: providerObservation.externalId,
          lifecycle: providerObservation.lifecycle,
          homeScore: providerObservation.homeScore,
          awayScore: providerObservation.awayScore,
          providerStatus: providerObservation.providerStatus,
        }),
        lastAppliedObservedAtMs: NOW_MS - 1_000,
        consecutiveSuccessfulSlateMisses: 0,
      });
    });
    const asOperator = await steppedUpOperator(t);
    const pin = await asOperator.mutation(
      api.resultOverrides.pinNflGameResultOverride,
      {
        gameId,
        reason: "New episode must retain its own provider evidence.",
        replacedResult,
        overrideResult,
      },
    );
    expect(
      await t.mutation(internal.syncApiSportsLive.applyObservation, {
        observation: providerObservation,
      }),
    ).toMatchObject({ status: "pinned" });
    const evidence = await t.run(async (ctx) =>
      ctx.db
        .query("nflGameResultReconciliationObservations")
        .withIndex("by_pinnedOverrideId_and_observedAtMs", (q) =>
          q.eq("pinnedOverrideId", pin.overrideId),
        )
        .collect(),
    );
    expect(evidence).toHaveLength(1);
  });

  it("replays pinned scoring across more than one 200-Pool discovery page", async () => {
    const t = convexTest(schema, modules);
    const { gameId, seasonId } = await seedVerifiedGame(t);
    const asOperator = await steppedUpOperator(t);
    await t.run(async (ctx) => {
      const participantId = await ctx.db.insert("participants", {
        clerkUserId: "replay-owner",
        tokenIdentifier: "https://auth.example.test|replay-owner",
        displayName: "Replay Owner",
        emailVerified: true,
        phoneVerified: true,
        ageConfirmed: true,
        suspended: false,
      });
      for (let index = 0; index < 201; index++) {
        await ctx.db.insert("pools", {
          name: `Replay Pool ${index}`,
          type: "survivor",
          seasonId,
          startWeek: 1,
          pickLockMode: "gameKickoff",
          status: "active",
          rulesFrozen: false,
          ownerParticipantId: participantId,
          createdAtMs: NOW_MS + index,
        });
      }
    });
    await asOperator.mutation(
      api.resultOverrides.pinNflGameResultOverride,
      {
        gameId,
        reason: "League gamebook requires deterministic replay.",
        replacedResult,
        overrideResult,
      },
    );
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const revisions = await t.run(async (ctx) =>
      ctx.db.query("scoringRevisions").collect(),
    );
    expect(revisions).toHaveLength(201);
  });

  it("releases through normal correction policy and creates a Scoring Hold when dependencies exist", async () => {
    const t = convexTest(schema, modules);
    const { gameId, seasonId } = await seedVerifiedGame(t);
    const asOperator = await steppedUpOperator(t);
    const override = await asOperator.mutation(
      api.resultOverrides.pinNflGameResultOverride,
      {
        gameId,
        reason: "League gamebook confirms a 30-24 final.",
        replacedResult,
        overrideResult,
      },
    );
    await t.run(async (ctx) => {
      const participantId = await ctx.db.insert("participants", {
        clerkUserId: "member",
        tokenIdentifier: "https://auth.example.test|member",
        displayName: "Member",
        email: "member@example.test",
        phone: "+15550000000",
        emailVerified: true,
        phoneVerified: true,
        ageConfirmed: true,
        suspended: false,
      });
      const poolId = await ctx.db.insert("pools", {
        name: "Dependent Pool",
        type: "survivor",
        startWeek: 1,
        pickLockMode: "gameKickoff",
        seasonId,
        status: "active",
        rulesFrozen: true,
        ownerParticipantId: participantId,
        createdAtMs: NOW_MS,
      });
      const membershipId = await ctx.db.insert("poolMemberships", {
        poolId,
        participantId,
        role: "owner",
        status: "active",
      });
      const entryId = await ctx.db.insert("poolEntries", {
        poolId,
        participantId,
        membershipId,
        entryNumber: 1,
        status: "active",
        createdAtMs: NOW_MS,
      });
      await ctx.db.insert("survivorPicks", {
        poolId,
        participantId,
        entryId,
        week: 2,
        nflTeamId: (
          await ctx.db
            .query("nflTeams")
            .withIndex("by_stableKey", (q) =>
              q.eq("stableKey", "nfl-team:gb"),
            )
            .unique()
        )!._id,
        locked: true,
        provenance: "authored",
        provisional: false,
        updatedAtMs: NOW_MS,
      });
    });
    await t.mutation(
      internal.syncApiSportsLive.applyReconciliationObservation,
      {
        gameId,
        observation: {
          externalId: "77779",
          observedAtMs: NOW_MS + 20_000,
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

    const released = await asOperator.mutation(
      api.resultOverrides.releaseNflGameResultOverride,
      {
        overrideId: override.overrideId,
        reason: "Provider evidence has been independently confirmed.",
      },
    );
    expect(released.reconciliationResult).toBe("submitted");
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    const state = await t.run(async (ctx) => {
      const game = await ctx.db.get(gameId);
      const holds = await ctx.db
        .query("scoringHolds")
        .withIndex("by_gameId_and_candidateKey", (q) =>
          q.eq("gameId", gameId),
        )
        .collect();
      return { game, holds };
    });
    expect(state.game?.pinnedResultOverrideId).toBeUndefined();
    expect(state.game?.verifiedResult).toMatchObject(overrideResult);
    expect(state.game?.correctionCandidate).toMatchObject({
      homeScore: replacedResult.homeScore,
      awayScore: replacedResult.awayScore,
      status: replacedResult.status,
    });
    expect(state.holds.some((hold) => hold.status === "open")).toBe(true);
  });

  it("writes append-only audits without exposing recovery secrets", async () => {
    const t = convexTest(schema, modules);
    const { gameId } = await seedVerifiedGame(t);
    const asOperator = await steppedUpOperator(t);
    const pin = await asOperator.mutation(
      api.resultOverrides.pinNflGameResultOverride,
      {
        gameId,
        reason: "League gamebook confirms a 30-24 final.",
        replacedResult,
        overrideResult,
      },
    );
    await t.mutation(
      internal.syncApiSportsLive.applyReconciliationObservation,
      {
        gameId,
        observation: {
          externalId: "77779",
          observedAtMs: NOW_MS + 10_000,
          lifecycle: "terminal",
          homeScore: 30,
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
    await asOperator.mutation(
      api.resultOverrides.releaseNflGameResultOverride,
      {
        overrideId: pin.overrideId,
        reason: "Provider now agrees.",
      },
    );

    const rows = await t.run(async (ctx) => {
      const audits = await ctx.db
        .query("operatorAuditEvents")
        .withIndex("by_atMs")
        .collect();
      const override = await ctx.db.get(pin.overrideId);
      return { audits, override };
    });
    expect(rows.override).toMatchObject({
      status: "released",
      actorClerkUserId: "operator",
      releasedByClerkUserId: "operator",
      reason: "League gamebook confirms a 30-24 final.",
      releaseReason: "Provider now agrees.",
    });
    expect(rows.override?.nflGameId).toBeUndefined();
    expect(rows.override?.workflowCleanupId).toBeUndefined();
    const permanentEvidence = await t.run(async (ctx) =>
      ctx.db
        .query("nflGameResultOverrideEvidence")
        .withIndex(
          "by_overrideId_and_disposition_and_observedAtMs",
          (q) =>
            q
              .eq("overrideId", pin.overrideId)
              .eq("disposition", "pinned_matching"),
        )
        .unique(),
    );
    expect(permanentEvidence).toMatchObject({
      overrideId: pin.overrideId,
      source: "api_sports_targeted",
    });
    expect(permanentEvidence).not.toHaveProperty("nflGameId");
    expect(rows.audits.map((row) => row.action)).toEqual([
      "nfl_game_result_override_pinned",
      "nfl_game_result_override_released",
    ]);
    const pinDetails = JSON.parse(rows.audits[0]!.detailsJson!);
    expect(pinDetails).toMatchObject({
      replacedResult,
      overrideResult,
    });
    const auditText = JSON.stringify(rows.audits);
    expect(auditText).not.toMatch(/api.?key|authorization|secret/i);
  });
});
