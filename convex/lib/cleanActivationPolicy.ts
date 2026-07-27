import type { TableNames } from "../_generated/dataModel";

type ActivationDisposition = "delete" | "rebuild" | "preserve";

type ActivationTablePolicy = Readonly<{
  disposition: ActivationDisposition;
  reason: string;
}>;

/**
 * A clean activation is intentionally small enough for one Convex mutation.
 * The final two writes are the request status patch and activation audit row.
 */
export const CLEAN_ACTIVATION_LIMITS = {
  maxDeletedRows: 2_500,
  maxDeletedBytes: 4 * 1_024 * 1_024,
  maxTransactionWrites: 4_096,
  confirmationTtlMs: 10 * 60 * 1_000,
} as const;

export const CLEAN_ACTIVATION_PRESERVED_CATEGORIES = [
  "sync_gate",
  "production_operator_audit_history",
  "authentication_and_operator_environment_configuration",
  "checked_in_nfl_team_catalog",
  "season_bootstrap_staging_history",
  "provider_reliability_state",
  "provider_evidence_and_recent_diagnostics",
] as const;

/**
 * Required only during the expand/contract window while legacy SportsDB
 * columns remain non-optional. These values are unique, visibly non-provider
 * sentinels; generic alias tables remain the only provider identity authority.
 */
export function legacySportsDbTeamSentinel(stableKey: string): string {
  return `legacy-unset:api-sports-team:${stableKey}`;
}

export function legacySportsDbGameSentinel(stableKey: string): string {
  return `legacy-unset:api-sports-game:${stableKey}`;
}

/**
 * Every application table must have an explicit clean-activation disposition.
 * `satisfies Record<TableNames, ...>` deliberately makes schema additions fail
 * typechecking until their destructive-data policy is reviewed.
 */
export const CLEAN_ACTIVATION_POLICY = {
  participants: {
    disposition: "delete",
    reason: "Application identity/profile rows are reset; auth config is external.",
  },
  poolSeasons: {
    disposition: "rebuild",
    reason: "Replace every Pool Season with the confirmed staged season.",
  },
  nflTeams: {
    disposition: "rebuild",
    reason: "Replace stored NFL Team rows from the validated canonical stage.",
  },
  nflGames: {
    disposition: "rebuild",
    reason: "Replace stored NFL Games from the validated regular-season stage.",
  },
  nflGameResultHistory: {
    disposition: "delete",
    reason: "Superseded results belong to NFL Games in the replaced sports dataset.",
  },
  nflGameResultReconciliationObservations: {
    disposition: "delete",
    reason: "Transient reconciliation rows are replaced with the active sports dataset.",
  },
  nflGameResultOverrides: {
    disposition: "preserve",
    reason: "Production Operator override history is a permanent audit record.",
  },
  nflGameResultOverrideEvidence: {
    disposition: "preserve",
    reason: "Self-contained exact-episode provider evidence is permanent audit history.",
  },
  nflTeamAliases: {
    disposition: "rebuild",
    reason: "Replace provider aliases with generic API-Sports aliases.",
  },
  nflGameAliases: {
    disposition: "rebuild",
    reason: "Replace provider aliases with generic API-Sports aliases.",
  },
  nflGameScheduleHistory: {
    disposition: "rebuild",
    reason: "Seed one validated schedule fact for every rebuilt NFL Game.",
  },
  sportsDataStatusEvidence: {
    disposition: "preserve",
    reason: "Recent status diagnostics survive activation and expire through bounded retention cleanup.",
  },
  providerGameEvidence: {
    disposition: "preserve",
    reason: "Self-contained normalized transitions are permanent competitive evidence.",
  },
  providerRequestDiagnostics: {
    disposition: "preserve",
    reason: "Recent diagnostics survive activation and age through bounded retention cleanup.",
  },
  providerDiagnosticCleanupRuns: {
    disposition: "preserve",
    reason: "Retention cleanup progress must remain resumable across activation.",
  },
  liveGameIngestionState: {
    disposition: "delete",
    reason: "Live ingestion state belongs to the replaced NFL Game dataset.",
  },
  seasonBootstrapStages: {
    disposition: "preserve",
    reason: "Immutable staging and validation history supports the activation audit.",
  },
  seasonBootstrapStagedTeams: {
    disposition: "preserve",
    reason: "Immutable staged source rows support reproducible activation reports.",
  },
  seasonBootstrapStagedGames: {
    disposition: "preserve",
    reason: "Immutable staged source rows support reproducible activation reports.",
  },
  seasonBootstrapStagedAliases: {
    disposition: "preserve",
    reason: "Immutable staged alias rows support reproducible activation reports.",
  },
  seasonBootstrapValidationFailures: {
    disposition: "preserve",
    reason: "Failed staging evidence remains available to Production Operators.",
  },
  seasonBootstrapActivationRequests: {
    disposition: "preserve",
    reason: "Deployment-bound confirmations are part of the operator audit trail.",
  },
  pools: {
    disposition: "delete",
    reason: "Pools are application/domain data covered by clean replacement.",
  },
  poolMemberships: {
    disposition: "delete",
    reason: "Pool membership is application/domain data.",
  },
  poolEntries: {
    disposition: "delete",
    reason: "Competitive entries are application/domain data.",
  },
  ownershipTransferOffers: {
    disposition: "delete",
    reason: "Pending Pool administration workflow belongs to deleted Pools.",
  },
  abuseReports: {
    disposition: "delete",
    reason: "Reports reference application identities and Pools being removed.",
  },
  syncGate: {
    disposition: "preserve",
    reason: "The deployment Sync Gate is service-level configuration.",
  },
  operatorAuditEvents: {
    disposition: "preserve",
    reason: "Production Operator audit history is permanently preserved.",
  },
  scoringHolds: {
    disposition: "delete",
    reason: "Scoring holds reference Pools and NFL Games being replaced.",
  },
  scoringDependencyEvents: {
    disposition: "delete",
    reason: "Dependency watermarks belong to the active Pool Season dataset.",
  },
  scoringHoldEvaluations: {
    disposition: "delete",
    reason: "Correction evaluations reference the active sports dataset.",
  },
  scoringHoldCleanups: {
    disposition: "delete",
    reason: "Correction cleanup workflows reference the active sports dataset.",
  },
  scoringHoldAcceptances: {
    disposition: "delete",
    reason: "Correction acceptance workflows reference the active sports dataset.",
  },
  scoringBlockedWork: {
    disposition: "delete",
    reason: "Blocked scoring work belongs to deleted Pools and correction evaluations.",
  },
  poolInvites: {
    disposition: "delete",
    reason: "Invite credentials belong to deleted Pools.",
  },
  returningParticipantInvites: {
    disposition: "delete",
    reason: "Returning invites reference deleted Pools and Participants.",
  },
  inviteThrottle: {
    disposition: "delete",
    reason: "Invite admission state is application data for deleted identities.",
  },
  poolAuditEvents: {
    disposition: "delete",
    reason: "Pool audit history belongs to deleted Pools.",
  },
  providerFetchClaims: {
    disposition: "preserve",
    reason: "Recent request-claim diagnostics survive activation and expire through bounded retention cleanup.",
  },
  providerReliabilityState: {
    disposition: "preserve",
    reason: "Quota and circuit state must survive clean activation so activation cannot reset provider safety fences.",
  },
  syncWorkItems: {
    disposition: "delete",
    reason: "Queued work may reference NFL Games and Pool Seasons being replaced.",
  },
  syncSurfaceHealth: {
    disposition: "delete",
    reason: "Freshness state belongs to the replaced active provider dataset.",
  },
  liveIngestionWatchdogState: {
    disposition: "delete",
    reason: "The expected-live episode anchor belongs to the replaced active provider dataset.",
  },
  providerExceptions: {
    disposition: "preserve",
    reason: "Recent sanitized provider exceptions survive activation and expire through bounded retention cleanup.",
  },
  operatorIncidents: {
    disposition: "delete",
    reason: "Operational incidents for the replaced dataset are application state.",
  },
  survivorPicks: {
    disposition: "delete",
    reason: "Competitive picks are application/domain data.",
  },
  survivorTeamReservations: {
    disposition: "delete",
    reason: "Team-use reservations belong to deleted competitive entries.",
  },
  confidencePickSheets: {
    disposition: "delete",
    reason: "Frozen Pick Sheets reference NFL Games being replaced.",
  },
  confidencePickSets: {
    disposition: "delete",
    reason: "Competitive Confidence state is application/domain data.",
  },
  confidencePicks: {
    disposition: "delete",
    reason: "Competitive picks are application/domain data.",
  },
  poolWeeks: {
    disposition: "delete",
    reason: "Pool Week lifecycle belongs to deleted Pools.",
  },
  scoringRevisions: {
    disposition: "delete",
    reason: "Competitive scoring history belongs to deleted Pools.",
  },
  survivorPickOutcomes: {
    disposition: "delete",
    reason: "Scoring projections belong to deleted Pools.",
  },
  confidencePickOutcomes: {
    disposition: "delete",
    reason: "Scoring projections belong to deleted Pools.",
  },
  weeklyStandings: {
    disposition: "delete",
    reason: "Standing projections belong to deleted Pools.",
  },
  seasonStandings: {
    disposition: "delete",
    reason: "Standing projections belong to deleted Pools.",
  },
} as const satisfies Record<TableNames, ActivationTablePolicy>;

/** Leaf-to-parent deletion order for the tables not preserved by activation. */
export const CLEAN_ACTIVATION_DELETE_ORDER = [
  "confidencePickOutcomes",
  "survivorPickOutcomes",
  "weeklyStandings",
  "seasonStandings",
  "confidencePicks",
  "confidencePickSets",
  "confidencePickSheets",
  "survivorPicks",
  "survivorTeamReservations",
  "poolWeeks",
  "scoringRevisions",
  "scoringBlockedWork",
  "scoringHolds",
  "scoringHoldEvaluations",
  "scoringHoldCleanups",
  "scoringHoldAcceptances",
  "scoringDependencyEvents",
  "poolAuditEvents",
  "poolInvites",
  "returningParticipantInvites",
  "ownershipTransferOffers",
  "poolEntries",
  "poolMemberships",
  "abuseReports",
  "pools",
  "syncWorkItems",
  "syncSurfaceHealth",
  "liveIngestionWatchdogState",
  "operatorIncidents",
  "liveGameIngestionState",
  "nflGameScheduleHistory",
  "nflGameResultReconciliationObservations",
  "nflGameResultHistory",
  "nflGameAliases",
  "nflTeamAliases",
  "nflGames",
  "nflTeams",
  "poolSeasons",
  "inviteThrottle",
  "participants",
] as const satisfies readonly TableNames[];

type DestructiveTableName = {
  [TableName in TableNames]: (typeof CLEAN_ACTIVATION_POLICY)[TableName]["disposition"] extends "preserve"
    ? never
    : TableName;
}[TableNames];
type MissingDestructiveTable = Exclude<
  DestructiveTableName,
  (typeof CLEAN_ACTIVATION_DELETE_ORDER)[number]
>;
type UnexpectedOrderedTable = Exclude<
  (typeof CLEAN_ACTIVATION_DELETE_ORDER)[number],
  DestructiveTableName
>;
const allDestructiveTablesAreOrdered: MissingDestructiveTable extends never
  ? true
  : never = true;
const allOrderedTablesAreDestructive: UnexpectedOrderedTable extends never
  ? true
  : never = true;
void allDestructiveTablesAreOrdered;
void allOrderedTablesAreDestructive;

export type CleanActivationRebuiltCounts = Readonly<{
  poolSeasons: number;
  nflTeams: number;
  nflGames: number;
  nflTeamAliases: number;
  nflGameAliases: number;
  nflGameScheduleHistory: number;
}>;

export type CleanActivationPlan = Readonly<{
  deletedCounts: Partial<Record<TableNames, number>>;
  rebuiltCounts: CleanActivationRebuiltCounts;
  totalDeleted: number;
  totalRebuilt: number;
  totalTransactionWrites: number;
  preservedCategories: typeof CLEAN_ACTIVATION_PRESERVED_CATEGORIES;
}>;

export type CleanActivationDeployment = Readonly<{
  kind: "development" | "production";
  id: string;
}>;

export function resolveCleanActivationDeployment(
  env: Record<string, string | undefined>,
): CleanActivationDeployment {
  const rawKind = env.DEPLOYMENT_KIND?.trim().toLowerCase();
  const kind =
    rawKind === "dev" || rawKind === "development"
      ? "development"
      : rawKind === "production"
        ? "production"
        : null;
  if (kind === null) {
    throw new Error(
      "Clean activation requires DEPLOYMENT_KIND=development or production",
    );
  }

  const id = env.CLEAN_ACTIVATION_DEPLOYMENT_ID?.trim();
  if (!id) {
    throw new Error(
      "Clean activation requires a deployment identity configuration",
    );
  }
  return { kind, id };
}

export function cleanActivationConfirmationText(input: {
  deployment: CleanActivationDeployment;
  seasonYear: number;
  stageId: string;
}): string {
  return [
    "ACTIVATE CLEAN POOL SEASON",
    String(input.seasonYear),
    "FROM STAGE",
    input.stageId,
    "ON",
    `${input.deployment.kind}:${input.deployment.id}`,
  ].join(" ");
}

export function buildActivationPlan(input: {
  currentCounts: Record<TableNames, number>;
  rebuiltCounts: CleanActivationRebuiltCounts;
}): CleanActivationPlan {
  const deletedCounts: Partial<Record<TableNames, number>> = {};
  let totalDeleted = 0;

  for (const tableName of Object.keys(CLEAN_ACTIVATION_POLICY) as TableNames[]) {
    const count = input.currentCounts[tableName];
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error(`Invalid clean activation count for ${tableName}`);
    }
    const policy = CLEAN_ACTIVATION_POLICY[tableName];
    if (policy.disposition === "preserve") continue;
    deletedCounts[tableName] = count;
    totalDeleted += count;
  }

  if (totalDeleted > CLEAN_ACTIVATION_LIMITS.maxDeletedRows) {
    throw new Error(
      `Clean activation exceeds the transaction-safe deletion limit: ${totalDeleted} > ${CLEAN_ACTIVATION_LIMITS.maxDeletedRows}`,
    );
  }

  const totalRebuilt = Object.values(input.rebuiltCounts).reduce(
    (total, count) => {
      if (!Number.isSafeInteger(count) || count < 0) {
        throw new Error("Invalid clean activation rebuild count");
      }
      return total + count;
    },
    0,
  );
  // Final writes: Pool Season Available patch, request status patch, audit
  // row, and worst-case provider recovery-work reseed.
  const totalTransactionWrites = totalDeleted + totalRebuilt + 4;
  if (
    totalTransactionWrites >
    CLEAN_ACTIVATION_LIMITS.maxTransactionWrites
  ) {
    throw new Error(
      `Clean activation exceeds the transaction-safe write limit: ${totalTransactionWrites} > ${CLEAN_ACTIVATION_LIMITS.maxTransactionWrites}`,
    );
  }

  return {
    deletedCounts,
    rebuiltCounts: input.rebuiltCounts,
    totalDeleted,
    totalRebuilt,
    totalTransactionWrites,
    preservedCategories: CLEAN_ACTIVATION_PRESERVED_CATEGORIES,
  };
}
