import { v } from "convex/values";

import { env, query } from "./_generated/server";
import {
  CLEAN_ACTIVATION_POLICY,
  CLEAN_ACTIVATION_PRESERVED_CATEGORIES,
} from "./lib/cleanActivationPolicy";
import { requireProductionOperatorIdentity } from "./lib/operatorAuth";
import { SEASON_BOOTSTRAP_INVARIANTS } from "./providers/sportsData/seasonBootstrapValidation";

type CheckStatus = "pass" | "fail";

type VerificationCheck = Readonly<{
  id: string;
  status: CheckStatus;
  detail: string;
}>;

function check(
  id: string,
  passed: boolean,
  detail: string,
): VerificationCheck {
  return { id, status: passed ? "pass" : "fail", detail };
}

function nonEmpty(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0;
}

function explicitlyTrue(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

function detailsRecord(
  value: string | undefined,
): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function actionMatches(
  rows: readonly Readonly<{
    action: string;
    detailsJson?: string;
  }>[],
  action: string,
  input: {
    requestId: string | null;
    stageId: string | null;
  },
): boolean {
  return rows.some((row) => {
    if (row.action !== action) return false;
    const details = detailsRecord(row.detailsJson);
    if (details === null) return false;
    if (
      input.requestId !== null &&
      String(details.requestId ?? "") !== input.requestId
    ) {
      return false;
    }
    if (
      input.stageId !== null &&
      String(details.stageId ?? "") !== input.stageId
    ) {
      return false;
    }
    return true;
  });
}

function matchingActionDetails(
  rows: readonly Readonly<{
    action: string;
    detailsJson?: string;
  }>[],
  action: string,
  input: {
    requestId: string | null;
    stageId: string | null;
  },
): Record<string, unknown> | null {
  const row = rows.find((candidate) => {
    if (candidate.action !== action) return false;
    const details = detailsRecord(candidate.detailsJson);
    return (
      details !== null &&
      (input.requestId === null ||
        String(details.requestId ?? "") === input.requestId) &&
      (input.stageId === null ||
        String(details.stageId ?? "") === input.stageId)
    );
  });
  return row ? detailsRecord(row.detailsJson) : null;
}

function countRecord(value: unknown): Record<string, number> | null {
  const parsed =
    typeof value === "string" ? detailsRecord(value) : value;
  if (typeof parsed !== "object" || parsed === null) return null;
  const entries = Object.entries(parsed);
  if (
    entries.some(
      ([, count]) =>
        !Number.isSafeInteger(count) || (count as number) < 0,
    )
  ) {
    return null;
  }
  return Object.fromEntries(entries) as Record<string, number>;
}

function sameCountRecord(
  left: Record<string, number> | null,
  right: Record<string, number> | null,
): boolean {
  if (left === null || right === null) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] && left[key] === right[key],
    )
  );
}

function exactlyOneOwner(
  ownerIds: readonly string[],
  aliases: readonly Readonly<{
    ownerId: string;
    provider: string;
    externalId: string;
    isCurrent: boolean;
  }>[],
): boolean {
  if (aliases.length !== ownerIds.length) return false;
  const ownerSet = new Set(ownerIds);
  const externalIds = new Set<string>();
  const counts = new Map<string, number>();
  for (const alias of aliases) {
    if (
      !ownerSet.has(alias.ownerId) ||
      alias.provider !== "api-sports" ||
      !alias.isCurrent ||
      alias.externalId.trim().length === 0 ||
      externalIds.has(alias.externalId)
    ) {
      return false;
    }
    externalIds.add(alias.externalId);
    counts.set(alias.ownerId, (counts.get(alias.ownerId) ?? 0) + 1);
  }
  return ownerIds.every((id) => counts.get(id) === 1);
}

function smokeEvidence(
  observedAtMs: number | null,
): Readonly<{ observed: boolean; observedAtMs: number | null }> {
  return { observed: observedAtMs !== null, observedAtMs };
}

/**
 * Read-only, bounded cutover proof for the allowlisted Production Operator.
 *
 * This query never returns credentials, never mutates deployment state, and
 * never treats a production deployment as activation-ready. Its output is
 * deliberately JSON-safe so it can be saved as rehearsal evidence.
 */
export const getOperatorCutoverVerification = query({
  args: { seasonYear: v.number() },
  handler: async (ctx, args) => {
    await requireProductionOperatorIdentity(ctx, {
      PRODUCTION_OPERATOR_CLERK_USER_ID:
        env.PRODUCTION_OPERATOR_CLERK_USER_ID,
      PRODUCTION_OPERATOR_TOKEN_IDENTIFIER:
        env.PRODUCTION_OPERATOR_TOKEN_IDENTIFIER,
    });

    const deploymentKind = env.DEPLOYMENT_KIND?.trim().toLowerCase();
    const stage = await ctx.db
      .query("seasonBootstrapStages")
      .withIndex("by_seasonYear_and_stagedAtMs", (q) =>
        q.eq("seasonYear", args.seasonYear),
      )
      .order("desc")
      .first();
    const seasons = await ctx.db
      .query("poolSeasons")
      .withIndex("by_label", (q) => q.eq("label", String(args.seasonYear)))
      .take(2);
    const season =
      seasons.length === 1 && seasons[0]?.year === args.seasonYear
        ? seasons[0]
        : null;

    const [
      teams,
      teamAliases,
      gameAliases,
      gate,
      activationRequests,
      audits,
      providerEvidence,
      statusEvidence,
      providerReliability,
      surfaceHealth,
      cleanupRun,
    ] = await Promise.all([
      ctx.db
        .query("nflTeams")
        .take(SEASON_BOOTSTRAP_INVARIANTS.teamCount + 1),
      ctx.db
        .query("nflTeamAliases")
        .take(SEASON_BOOTSTRAP_INVARIANTS.teamCount + 1),
      ctx.db
        .query("nflGameAliases")
        .take(SEASON_BOOTSTRAP_INVARIANTS.regularSeasonGameCount + 1),
      ctx.db
        .query("syncGate")
        .withIndex("by_key", (q) => q.eq("key", "deployment"))
        .unique(),
      ctx.db
        .query("seasonBootstrapActivationRequests")
        .order("desc")
        .take(51),
      ctx.db
        .query("operatorAuditEvents")
        .withIndex("by_atMs", (q) =>
          q.gte("atMs", stage?.stagedAtMs ?? 0),
        )
        .order("desc")
        .take(501),
      ctx.db.query("providerGameEvidence").order("desc").take(501),
      ctx.db.query("sportsDataStatusEvidence").take(101),
      ctx.db
        .query("providerReliabilityState")
        .withIndex("by_key", (q) => q.eq("key", "api-sports"))
        .unique(),
      ctx.db.query("syncSurfaceHealth").take(100),
      ctx.db
        .query("providerDiagnosticCleanupRuns")
        .withIndex("by_key", (q) => q.eq("key", "provider-diagnostics"))
        .unique(),
    ]);

    const games = season
      ? await ctx.db
          .query("nflGames")
          .withIndex("by_seasonId", (q) => q.eq("seasonId", season._id))
          .take(SEASON_BOOTSTRAP_INVARIANTS.regularSeasonGameCount + 1)
      : [];
    const scheduleHistory = season
      ? await ctx.db
          .query("nflGameScheduleHistory")
          .withIndex("by_seasonId_and_week", (q) =>
            q.eq("seasonId", season._id),
          )
          .take(SEASON_BOOTSTRAP_INVARIANTS.regularSeasonGameCount + 1)
      : [];
    const activation = activationRequests.find(
      (request) =>
        request.seasonYear === args.seasonYear &&
        request.status === "activated" &&
        request.deploymentKind === deploymentKind &&
        request.deploymentId ===
          env.CLEAN_ACTIVATION_DEPLOYMENT_ID?.trim(),
    );
    const activatedAtMs = activation?.activatedAtMs ?? null;
    const stageId = activation ? String(activation.stageId) : null;
    const requestId = activation ? String(activation._id) : null;
    const weeks = [...new Set(games.map((game) => game.week))].sort(
      (left, right) => left - right,
    );
    const expectedWeeks = [...SEASON_BOOTSTRAP_INVARIANTS.weeks];

    const teamAliasRows = teamAliases.map((alias) => ({
      ownerId: String(alias.nflTeamId),
      provider: alias.provider,
      externalId: alias.externalId,
      isCurrent: alias.isCurrent,
    }));
    const gameAliasRows = gameAliases.map((alias) => ({
      ownerId: String(alias.nflGameId),
      provider: alias.provider,
      externalId: alias.externalId,
      isCurrent: alias.isCurrent,
    }));
    const teamAliasesExact = exactlyOneOwner(
      teams.map((team) => String(team._id)),
      teamAliasRows,
    );
    const gameAliasesExact = exactlyOneOwner(
      games.map((game) => String(game._id)),
      gameAliasRows,
    );
    const gamesById = new Map(
      games.map((game) => [String(game._id), game]),
    );
    const historyCounts = new Map<string, number>();
    const scheduleHistoryExact =
      scheduleHistory.length === games.length &&
      scheduleHistory.every((history) => {
        const game = gamesById.get(String(history.nflGameId));
        if (!game) return false;
        const id = String(history.nflGameId);
        historyCounts.set(id, (historyCounts.get(id) ?? 0) + 1);
        return (
          history.seasonId === game.seasonId &&
          history.week === game.week &&
          history.homeTeamId === game.homeTeamId &&
          history.awayTeamId === game.awayTeamId &&
          history.scheduledKickoffMs === game.scheduledKickoffMs
        );
      }) &&
      games.every((game) => historyCounts.get(String(game._id)) === 1);

    const preservedCategories = new Set(
      activation?.preservedCategories ?? [],
    );
    const preservationDeclared =
      CLEAN_ACTIVATION_PRESERVED_CATEGORIES.every((category) =>
        preservedCategories.has(category),
      );
    const activationAudited =
      actionMatches(audits, "season_bootstrap_activation_requested", {
        requestId,
        stageId,
      }) &&
      actionMatches(audits, "season_bootstrap_clean_activated", {
        requestId,
        stageId,
      });
    const requestAuditDetails = matchingActionDetails(
      audits,
      "season_bootstrap_activation_requested",
      { requestId, stageId },
    );
    const activationAuditDetails = matchingActionDetails(
      audits,
      "season_bootstrap_clean_activated",
      { requestId, stageId },
    );
    const requestDeletedCounts = countRecord(
      activation?.deletedCountsJson,
    );
    const requestRebuiltCounts = countRecord(
      activation?.rebuiltCountsJson,
    );
    const expectedDeletedKeys = Object.entries(
      CLEAN_ACTIVATION_POLICY,
    )
      .filter(([, policy]) => policy.disposition !== "preserve")
      .map(([tableName]) => tableName)
      .sort();
    const expectedRebuiltCounts = {
      poolSeasons: 1,
      nflTeams: SEASON_BOOTSTRAP_INVARIANTS.teamCount,
      nflGames: SEASON_BOOTSTRAP_INVARIANTS.regularSeasonGameCount,
      nflTeamAliases: SEASON_BOOTSTRAP_INVARIANTS.teamCount,
      nflGameAliases:
        SEASON_BOOTSTRAP_INVARIANTS.regularSeasonGameCount,
      nflGameScheduleHistory:
        SEASON_BOOTSTRAP_INVARIANTS.regularSeasonGameCount,
    };
    const requestDeletedKeys = Object.keys(
      requestDeletedCounts ?? {},
    ).sort();
    const activationPlanExact =
      requestDeletedCounts !== null &&
      requestDeletedKeys.length === expectedDeletedKeys.length &&
      requestDeletedKeys.every(
        (key, index) => key === expectedDeletedKeys[index],
      ) &&
      sameCountRecord(requestRebuiltCounts, expectedRebuiltCounts) &&
      sameCountRecord(
        countRecord(requestAuditDetails?.deletedCounts),
        requestDeletedCounts,
      ) &&
      sameCountRecord(
        countRecord(requestAuditDetails?.rebuiltCounts),
        requestRebuiltCounts,
      ) &&
      sameCountRecord(
        countRecord(activationAuditDetails?.deletedCounts),
        requestDeletedCounts,
      ) &&
      sameCountRecord(
        countRecord(activationAuditDetails?.rebuiltCounts),
        requestRebuiltCounts,
      );
    const stageAudited = audits.some((row) => {
      if (row.action !== "season_bootstrap_staged") return false;
      return String(detailsRecord(row.detailsJson)?.stageId ?? "") === stageId;
    });

    const incompatibleOperationalResidue =
      teamAliases.filter((alias) => alias.provider !== "api-sports").length +
      gameAliases.filter((alias) => alias.provider !== "api-sports").length +
      statusEvidence.filter((row) => row.provider !== "api-sports").length +
      providerEvidence.filter(
        (row) =>
          activatedAtMs !== null &&
          row.recordedAtMs >= activatedAtMs &&
          row.provider !== "api-sports" &&
          row.provider !== "operator",
      ).length;
    const statusInspectionComplete = statusEvidence.length <= 100;
    const latestInspectedProviderEvidence =
      providerEvidence[providerEvidence.length - 1];
    const postActivationEvidenceInspectionComplete =
      providerEvidence.length <= 500 ||
      activatedAtMs === null ||
      latestInspectedProviderEvidence === undefined ||
      latestInspectedProviderEvidence.recordedAtMs < activatedAtMs;
    const operationalInspectionComplete =
      statusInspectionComplete &&
      postActivationEvidenceInspectionComplete;
    const evidenceAfterActivation = providerEvidence.filter(
      (row) =>
        activatedAtMs !== null &&
        row.recordedAtMs >= activatedAtMs &&
        row.seasonLabel === String(args.seasonYear),
    );
    const auditsAfterActivation = audits.filter(
      (row) => activatedAtMs !== null && row.atMs >= activatedAtMs,
    );
    const latestEvidenceAt = (
      predicate: (row: (typeof evidenceAfterActivation)[number]) => boolean,
    ): number | null =>
      evidenceAfterActivation
        .filter(predicate)
        .reduce<number | null>(
          (latest, row) =>
            latest === null ? row.recordedAtMs : Math.max(latest, row.recordedAtMs),
          null,
        );
    const latestCompletedWorkflowAt = (input: {
      startAction: string;
      completionActions: readonly string[];
      idField: "holdId" | "overrideId";
    }): number | null => {
      const starts = new Map<
        string,
        { gameId: string; atMs: number }
      >();
      for (const row of auditsAfterActivation) {
        if (row.action !== input.startAction) continue;
        const details = detailsRecord(row.detailsJson);
        const workflowId = String(details?.[input.idField] ?? "");
        const gameId = String(details?.gameId ?? "");
        if (!workflowId || !gamesById.has(gameId)) continue;
        const prior = starts.get(workflowId);
        if (prior === undefined || row.atMs < prior.atMs) {
          starts.set(workflowId, { gameId, atMs: row.atMs });
        }
      }
      let latest: number | null = null;
      for (const row of auditsAfterActivation) {
        if (!input.completionActions.includes(row.action)) continue;
        const details = detailsRecord(row.detailsJson);
        const workflowId = String(details?.[input.idField] ?? "");
        const gameId = String(details?.gameId ?? "");
        const start = starts.get(workflowId);
        if (
          start === undefined ||
          start.gameId !== gameId ||
          row.atMs < start.atMs
        ) {
          continue;
        }
        latest = latest === null ? row.atMs : Math.max(latest, row.atMs);
      }
      return latest;
    };
    const scoringHoldCompletedAtMs = latestCompletedWorkflowAt({
      startAction: "scoring_hold_created",
      completionActions: [
        "scoring_hold_resolved",
        "scoring_hold_superseded",
        "scoring_hold_withdrawn",
      ],
      idField: "holdId",
    });
    const pinnedOverrideCompletedAtMs = latestCompletedWorkflowAt({
      startAction: "nfl_game_result_override_pinned",
      completionActions: ["nfl_game_result_override_released"],
      idField: "overrideId",
    });

    const smoke = {
      schedule: smokeEvidence(
        latestEvidenceAt((row) => row.source === "schedule"),
      ),
      live: smokeEvidence(
        latestEvidenceAt((row) => row.source === "live"),
      ),
      immediateResult: smokeEvidence(
        latestEvidenceAt(
          (row) =>
            row.transitionKind === "terminal" &&
            row.after.resultAuthority === "verified" &&
            row.after.verifiedResult !== null,
        ),
      ),
      correction: smokeEvidence(
        latestEvidenceAt(
          (row) =>
            (row.source === "correction" ||
              row.transitionKind === "correction") &&
            row.after.resultAuthority === "verified" &&
            row.after.verifiedResult !== null,
        ),
      ),
      scoringHold: smokeEvidence(
        scoringHoldCompletedAtMs,
      ),
      pinnedOverride: smokeEvidence(
        pinnedOverrideCompletedAtMs,
      ),
      quota: smokeEvidence(
        activatedAtMs !== null &&
          providerReliability?.lastSuccessAtMs !== undefined &&
          providerReliability.lastSuccessAtMs >= activatedAtMs
          ? providerReliability.lastSuccessAtMs
          : null,
      ),
      freshness: smokeEvidence(
        surfaceHealth.reduce<number | null>((latest, row) => {
          if (
            activatedAtMs === null ||
            row.lastSuccessAtMs === undefined ||
            row.lastSuccessAtMs < activatedAtMs
          ) {
            return latest;
          }
          return latest === null
            ? row.lastSuccessAtMs
            : Math.max(latest, row.lastSuccessAtMs);
        }, null),
      ),
      retention: smokeEvidence(
        activatedAtMs !== null &&
          cleanupRun?.status === "complete" &&
          cleanupRun.completedAtMs !== undefined &&
          cleanupRun.completedAtMs >= activatedAtMs
          ? cleanupRun.completedAtMs
          : null,
      ),
    };
    const smokeComplete = Object.values(smoke).every(
      (evidence) => evidence.observed,
    );
    const environmentConfigured =
      deploymentKind === "development" &&
      nonEmpty(env.CLEAN_ACTIVATION_DEPLOYMENT_ID) &&
      env.SPORTS_DATA_PROVIDER?.trim() === "api-sports" &&
      nonEmpty(env.API_SPORTS_KEY) &&
      (nonEmpty(env.PRODUCTION_OPERATOR_CLERK_USER_ID) ||
        nonEmpty(env.PRODUCTION_OPERATOR_TOKEN_IDENTIFIER)) &&
      explicitlyTrue(env.SENTRY_INCIDENT_EMAIL_ENABLED);
    const stageValid =
      stage !== null &&
      activation !== undefined &&
      stage._id === activation.stageId &&
      stage.invariantsVersion === SEASON_BOOTSTRAP_INVARIANTS.version &&
      stage.validationStatus === "valid" &&
      stage.activationEligible &&
      stage.failureCount === 0 &&
      stage.storedFailureCount === 0 &&
      !stage.failuresTruncated &&
      stage.teamCount === SEASON_BOOTSTRAP_INVARIANTS.teamCount &&
      stage.gameCount ===
        SEASON_BOOTSTRAP_INVARIANTS.regularSeasonGameCount &&
      stage.weekCount === SEASON_BOOTSTRAP_INVARIANTS.weeks.length;
    const datasetExact =
      seasons.length === 1 &&
      season?.status === "available" &&
      teams.length === SEASON_BOOTSTRAP_INVARIANTS.teamCount &&
      games.length === SEASON_BOOTSTRAP_INVARIANTS.regularSeasonGameCount;
    const weeksExact =
      weeks.length === expectedWeeks.length &&
      weeks.every((week, index) => week === expectedWeeks[index]);
    const syncGateOff = gate === null || gate.enabled === false;
    const protectedStatePresent =
      gate !== null &&
      providerReliability !== null &&
      preservationDeclared &&
      activationPlanExact &&
      stageAudited &&
      activationAudited &&
      audits.length <= 500;

    const checks: VerificationCheck[] = [
      check(
        "development_environment_configured",
        environmentConfigured,
        "Development deployment id, API-Sports selector/key presence, operator allowlist, and Sentry incident email must be configured.",
      ),
      check(
        "staged_snapshot_activated",
        stageValid,
        "Latest activated request must reference the current valid 32-team/272-game/18-week API-Sports stage.",
      ),
      check(
        "activation_plan_exact",
        activationPlanExact,
        "Durable request and audit plans must contain only authorized deletion keys and exact 1/32/272/32/272/272 rebuild counts.",
      ),
      check(
        "dataset_exact",
        datasetExact,
        `${teams.length} teams and ${games.length} games found for ${args.seasonYear}.`,
      ),
      check(
        "weeks_exact",
        weeksExact,
        `Observed weeks: ${weeks.join(",") || "none"}.`,
      ),
      check(
        "team_aliases_exact",
        teamAliasesExact,
        `${teamAliases.length} current, unique API-Sports team aliases must map one-to-one to NFL Teams.`,
      ),
      check(
        "game_aliases_exact",
        gameAliasesExact,
        `${gameAliases.length} current, unique API-Sports game aliases must map one-to-one to NFL Games.`,
      ),
      check(
        "schedule_history_exact",
        scheduleHistoryExact,
        `${scheduleHistory.length} exact schedule-history rows must map one-to-one to NFL Games.`,
      ),
      check(
        "sync_gate_off",
        syncGateOff,
        gate === null
          ? "Sync Gate has no row and therefore defaults OFF."
          : `Sync Gate is ${gate.enabled ? "ON" : "OFF"}.`,
      ),
      check(
        "protected_state_preserved",
        protectedStatePresent,
        "Activation declaration, stage/request/activation audit chain, Sync Gate row, and provider reliability state must remain present.",
      ),
      check(
        "incompatible_operational_residue",
        incompatibleOperationalResidue === 0 &&
          operationalInspectionComplete,
        operationalInspectionComplete
          ? `${incompatibleOperationalResidue} incompatible operational provider rows found.`
          : "Operational residue inspection exceeded its safe bound; cutover fails closed.",
      ),
      check(
        "post_activation_smoke_evidence",
        smokeComplete,
        "Schedule, live, immediate result, correction, scoring hold, pinned override, quota, freshness, and retention evidence must all postdate activation.",
      ),
    ];
    const status: CheckStatus = checks.every(
      (item) => item.status === "pass",
    )
      ? "pass"
      : "fail";

    return {
      reportVersion: "api-sports-cutover-v1" as const,
      generatedAtMs: Date.now(),
      seasonYear: args.seasonYear,
      deployment: {
        kind:
          deploymentKind === "development" ||
          deploymentKind === "production"
            ? deploymentKind
            : "unconfigured",
        idConfigured: nonEmpty(env.CLEAN_ACTIVATION_DEPLOYMENT_ID),
      },
      status,
      developmentCutoverReady:
        status === "pass" && deploymentKind === "development",
      productionActivationAllowed: false as const,
      productionBlock:
        "Production activation and Sync Gate enablement remain prohibited until a human-observed preseason qualification window passes.",
      stageId,
      activationRequestId: requestId,
      activatedAtMs,
      dataset: {
        teams: teams.length,
        games: games.length,
        weeks,
        teamAliases: teamAliases.length,
        gameAliases: gameAliases.length,
        scheduleHistoryRows: scheduleHistory.length,
      },
      protectedState: {
        syncGateRowPresent: gate !== null,
        providerReliabilityStatePresent: providerReliability !== null,
        preservationDeclared,
        activationPlanExact,
        stageAuditPresent: stageAudited,
        activationRequestAuditPresent: activationAudited,
      },
      incompatibleOperationalResidue,
      smokeEvidence: smoke,
      checks,
      inspectionBounds: {
        activationRequests: {
          maximum: 50,
          complete: activationRequests.length <= 50,
        },
        operatorAuditEvents: {
          maximum: 500,
          complete: audits.length <= 500,
        },
        providerGameEvidence: {
          maximum: 500,
          postActivationComplete:
            postActivationEvidenceInspectionComplete,
        },
        sportsDataStatusEvidence: {
          maximum: 100,
          complete: statusInspectionComplete,
        },
        syncSurfaceHealth: 100,
      },
    };
  },
});
