import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, env } from "./_generated/server";
import { createReliableApiSportsFetch } from "./effect/apiSports/reliableFetch";
import { runEffect } from "./effect/run";
import { qualificationCandidateRejection } from "./lib/providerQualificationCandidate";
import {
  createApiSportsProviderFactory,
  selectSportsDataProvider,
} from "./providers/sportsData/config";
import type { SportsDataGameObservation } from "./providers/sportsData/types";

function terminalStatus(
  game: SportsDataGameObservation,
): "FT" | "AOT" | "CANC" | undefined {
  if (game.lifecycle === "canceled") return "CANC";
  if (game.lifecycle !== "terminal") return undefined;
  const short = game.providerStatus.rawShort.toUpperCase();
  if (short === "AOT") return "AOT";
  return "FT";
}

type QualificationPollTarget = {
  runId: Id<"operatorAuditEvents">;
  seasonId: Id<"poolSeasons">;
  seasonYear: number;
  game: {
    stableKey: string;
    apiSportsExternalId?: string;
    homeTeamAbbreviation: string;
    awayTeamAbbreviation: string;
    scheduledKickoffMs: number;
  };
  pollable: boolean;
};

type QualificationPollResult =
  | {
      ok: false;
      reason:
        | "provider_candidate_missing"
        | "external_id_mismatch"
        | "season_year_mismatch"
        | "kickoff_mismatch"
        | "identity_mismatch"
        | "home_away_reversal"
        | "phase_mismatch";
    }
  | { ok: true; recorded: false }
  | {
      ok: true;
      recorded: boolean;
      eventSequence: number | null;
      overflowed?: boolean;
      sequence?: number;
      visibleAppliedAtMs?: number;
    };

/**
 * Operator-authorized, run-bound qualification poll. It uses the production
 * API-Sports adapter and reliability fence but writes only run-local evidence.
 */
export const pollQualificationGame = action({
  args: {
    runId: v.id("operatorAuditEvents"),
    gameKey: v.string(),
  },
  handler: async (ctx, args): Promise<QualificationPollResult> => {
    const target: QualificationPollTarget = await ctx.runQuery(
      internal.providerQualification.getQualificationPollTarget,
      args,
    );
    if (!target.pollable || !target.game.apiSportsExternalId) {
      return { ok: false as const, reason: "provider_candidate_missing" };
    }
    const reliable = createReliableApiSportsFetch({
      ctx,
      surface: "operator",
      traffic: "protected",
      intent: "qualification",
      qualificationRunId: target.runId,
      expectedSeasonId: target.seasonId,
      jitterKey: `qualification:${target.runId}:${target.game.stableKey}`,
      scopeKey: `qualification:${target.runId}`,
    });
    try {
      const provider = selectSportsDataProvider({
        config: {
          provider: env.SPORTS_DATA_PROVIDER,
          apiSportsKey: env.API_SPORTS_KEY,
        },
        providers: {
          "api-sports": createApiSportsProviderFactory({
            requestFence: reliable.fence,
          }),
        },
      });
      const game = await runEffect(
        provider.getGame({
          provider: "api-sports",
          id: target.game.apiSportsExternalId,
        }),
      );
      const rejectionReason = game
        ? qualificationCandidateRejection({
            expectedExternalId: target.game.apiSportsExternalId,
            expectedSeasonYear: target.seasonYear,
            expectedKickoffMs: target.game.scheduledKickoffMs,
            expectedHomeTeam: target.game.homeTeamAbbreviation,
            expectedAwayTeam: target.game.awayTeamAbbreviation,
            game,
          })
        : null;
      if (game && rejectionReason) {
        await Promise.all([
          ctx.runMutation(
            internal.providerQualification.recordQualificationPollRejection,
            {
              runId: target.runId,
              gameKey: target.game.stableKey,
              reason: rejectionReason,
              evidence: {
                actualExternalId:
                  game.providerAliases
                    .find((alias) => alias.provider === "api-sports")
                    ?.id.slice(0, 80) ?? null,
                actualSeasonYear: game.seasonYear,
                actualScheduledKickoffMs: game.scheduledKickoffMs,
                actualSeasonPhase: game.seasonPhase,
                actualProviderStage: game.providerStage.slice(0, 80),
                actualHomeTeamAbbreviation:
                  game.homeTeamAbbreviation,
                actualAwayTeamAbbreviation:
                  game.awayTeamAbbreviation,
                actualHomeScore: game.homeScore,
                actualAwayScore: game.awayScore,
                actualStatus:
                  game.providerStatus.rawShort.slice(0, 40),
                providerObservedAtMs: game.observedAtMs,
              },
            },
          ),
          ctx.runMutation(
            internal.providerEvidence.recordApiSportsDiagnostic,
            {
              surface: "operator",
              scopeKey: `qualification:${target.runId}`,
              endpoint: "/games",
              parameters: { id: target.game.apiSportsExternalId },
              outcome: "quarantined",
              providerStatus: game
                ? {
                    short: game.providerStatus.rawShort,
                    long: game.providerStatus.rawLong,
                  }
                : undefined,
            },
          ),
        ]);
        await reliable.recordOutcome({
          success: true,
          attempt: 0,
          nowMs: Date.now(),
        });
        return { ok: false as const, reason: rejectionReason };
      }
      if (
        !game ||
        game.homeScore === null ||
        game.awayScore === null
      ) {
        await reliable.recordOutcome({
          success: true,
          attempt: 0,
          nowMs: Date.now(),
        });
        return { ok: true as const, recorded: false as const };
      }
      const result: {
        recorded: boolean;
        eventSequence: number | null;
        overflowed?: boolean;
        sequence?: number;
        visibleAppliedAtMs?: number;
      } = await ctx.runMutation(
        internal.providerQualification.recordQualificationProviderEvent,
        {
          runId: target.runId,
          gameKey: target.game.stableKey,
          externalId: target.game.apiSportsExternalId,
          homeTeamAbbreviation: game.homeTeamAbbreviation,
          awayTeamAbbreviation: game.awayTeamAbbreviation,
          homeScore: game.homeScore,
          awayScore: game.awayScore,
          status: terminalStatus(game),
          providerIngestedAtMs: game.observedAtMs,
        },
      );
      await reliable.recordOutcome({
        success: true,
        attempt: 0,
        nowMs: Date.now(),
      });
      return { ok: true as const, ...result };
    } catch (error) {
      await reliable.recordOutcome({
        success: false,
        attempt: 0,
        nowMs: Date.now(),
        error,
        failureReason: "qualification_poll_failed",
      });
      throw error;
    }
  },
});
