import { v } from "convex/values";
import * as Schema from "effect/Schema";

import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import {
  assessQualificationWindow,
  canRunAutomatedProviderSync,
  type QualificationReferenceEvent,
} from "./lib/providerQualificationPolicy";
import {
  requireProductionOperatorIdentity,
  requireProductionOperatorWithStepUp,
} from "./lib/operatorAuth";
import { providerDiagnosticExpiry } from "./lib/providerEvidencePolicy";
import {
  assertLegacyContractionUnlocked,
  isLegacyContractionLocked,
} from "./lib/legacyContractionLock";
import {
  CANONICAL_NFL_TEAM_ABBREVIATIONS,
} from "./providers/sportsData/catalog";

export const PROVIDER_QUALIFICATION_POLICY_VERSION =
  "api-sports-qualification-v1" as const;
const MAX_GAMES = 64;
const MAX_REFERENCES = 256;
const MAX_PROVIDER_EVENTS = 512;
const MAX_CANDIDATE_REJECTIONS = MAX_GAMES * 6;
const MAX_STORED_FINDINGS = 512;
const MAX_QUALIFICATION_PAYLOAD_BYTES = 900_000;
export const QUALIFICATION_COVERAGE_ATTESTATION =
  "I recorded every observed scoring change and final.";

const teamValidator = v.union(
  ...CANONICAL_NFL_TEAM_ABBREVIATIONS.map((team) => v.literal(team)),
);
const terminalStatusValidator = v.union(
  v.literal("FT"),
  v.literal("AOT"),
  v.literal("CANC"),
);
const qualificationSurfaceValidator = v.union(
  v.literal("schedule"),
  v.literal("live"),
  v.literal("confirmation"),
  v.literal("bootstrap"),
);

export const productionQualificationFenceValidator = v.object({
  provider: v.literal("api-sports"),
  seasonId: v.id("poolSeasons"),
  datasetFingerprint: v.string(),
  policyVersion: v.literal(PROVIDER_QUALIFICATION_POLICY_VERSION),
  generation: v.number(),
  decisionRunId: v.id("operatorAuditEvents"),
});

export type ProductionQualificationFence = Readonly<{
  provider: "api-sports";
  seasonId: Id<"poolSeasons">;
  datasetFingerprint: string;
  policyVersion: typeof PROVIDER_QUALIFICATION_POLICY_VERSION;
  generation: number;
  decisionRunId: Id<"operatorAuditEvents">;
}>;

type QualificationGame = {
  ordinal: number;
  stableKey: string;
  homeTeamAbbreviation: string;
  awayTeamAbbreviation: string;
  scheduledKickoffMs: number;
  apiSportsExternalId?: string;
  registeredAtMs: number;
};
type QualificationEvent = {
  eventType: "reference" | "provider";
  gameKey: string;
  sequence: number;
  kind: "score" | "final";
  ordinal?: number;
  referenceAtMs?: number;
  source?: "official_nfl_view";
  clientNonce?: string;
  referenceHomeTeam?: string;
  referenceAwayTeam?: string;
  referenceHomeScore?: number;
  referenceAwayScore?: number;
  referenceStatus?: "FT" | "AOT" | "CANC";
  recordedAtMs?: number;
  provider?: "api-sports";
  externalId?: string;
  homeTeamAbbreviation?: string;
  awayTeamAbbreviation?: string;
  homeScore?: number;
  awayScore?: number;
  status?: "FT" | "AOT" | "CANC";
  providerIngestedAtMs?: number;
  visibleAppliedAtMs?: number;
  matchedProviderSequence?: number;
  ingestionDelayMs?: number;
  applicationDelayMs?: number;
  outcome?:
    | "matched"
    | "missing_game"
    | "identity_mismatch"
    | "home_away_reversal"
    | "score_error"
    | "final_status_error"
    | "timestamp_mismatch"
    | "freshness_breach";
};
type QualificationFinding = {
  eventOrdinal?: number;
  gameOrdinal?: number;
  code:
    | "no_reference_events"
    | "missing_final_reference"
    | "missing_game"
    | "identity_mismatch"
    | "home_away_reversal"
    | "score_error"
    | "final_status_error"
    | "timestamp_mismatch"
    | "freshness_breach"
    | "coverage_overflow"
    | "unused_provider_transition"
    | "external_id_mismatch"
    | "season_year_mismatch"
    | "kickoff_mismatch"
    | "phase_mismatch"
    | "findings_truncated";
  message: string;
};
type QualificationCandidateRejection = {
  gameKey: string;
  code:
    | "external_id_mismatch"
    | "season_year_mismatch"
    | "kickoff_mismatch"
    | "identity_mismatch"
    | "home_away_reversal"
    | "phase_mismatch";
  recordedAtMs: number;
  actualExternalId: string | null;
  actualSeasonYear: number;
  actualScheduledKickoffMs: number;
  actualSeasonPhase:
    | "preseason"
    | "regular_season"
    | "postseason"
    | "unknown";
  actualProviderStage: string;
  actualHomeTeamAbbreviation: string;
  actualAwayTeamAbbreviation: string;
  actualHomeScore: number | null;
  actualAwayScore: number | null;
  actualStatus: string;
  providerObservedAtMs: number;
};
type QualificationRunState = {
  qualificationRunKey: string;
  provider: "api-sports";
  seasonId: Id<"poolSeasons">;
  seasonLabel: string;
  datasetFingerprint: string;
  policyVersion: typeof PROVIDER_QUALIFICATION_POLICY_VERSION;
  generation: number;
  status: "collecting" | "passed" | "failed";
  startedAtMs: number;
  completedAtMs?: number;
  nextSequence: number;
  registeredGameCount: number;
  referenceEventCount: number;
  games: QualificationGame[];
  events: QualificationEvent[];
  observedEvents?: number;
  correctnessErrors?: number;
  freshnessBreaches?: number;
  missingGames?: number;
  identityMismatches?: number;
  homeAwayReversals?: number;
  scoreErrors?: number;
  finalStatusErrors?: number;
  maxIngestionDelayMs?: number;
  maxApplicationDelayMs?: number;
  explanation?: string;
  coverageAttested?: boolean;
  coverageAttestationText?: string;
  coverageOverflowed?: boolean;
  candidateRejections?: QualificationCandidateRejection[];
  findingsTruncated?: boolean;
  findings?: QualificationFinding[];
};

const terminalStatusSchema = Schema.Literal("FT", "AOT", "CANC");
const qualificationGameSchema = Schema.Struct({
  ordinal: Schema.Number,
  stableKey: Schema.String,
  homeTeamAbbreviation: Schema.String,
  awayTeamAbbreviation: Schema.String,
  scheduledKickoffMs: Schema.Number,
  apiSportsExternalId: Schema.optional(Schema.String),
  registeredAtMs: Schema.Number,
});
const qualificationEventSchema = Schema.Struct({
  eventType: Schema.Literal("reference", "provider"),
  gameKey: Schema.String,
  sequence: Schema.Number,
  kind: Schema.Literal("score", "final"),
  ordinal: Schema.optional(Schema.Number),
  referenceAtMs: Schema.optional(Schema.Number),
  source: Schema.optional(Schema.Literal("official_nfl_view")),
  clientNonce: Schema.optional(Schema.String),
  referenceHomeTeam: Schema.optional(Schema.String),
  referenceAwayTeam: Schema.optional(Schema.String),
  referenceHomeScore: Schema.optional(Schema.Number),
  referenceAwayScore: Schema.optional(Schema.Number),
  referenceStatus: Schema.optional(terminalStatusSchema),
  recordedAtMs: Schema.optional(Schema.Number),
  provider: Schema.optional(Schema.Literal("api-sports")),
  externalId: Schema.optional(Schema.String),
  homeTeamAbbreviation: Schema.optional(Schema.String),
  awayTeamAbbreviation: Schema.optional(Schema.String),
  homeScore: Schema.optional(Schema.Number),
  awayScore: Schema.optional(Schema.Number),
  status: Schema.optional(terminalStatusSchema),
  providerIngestedAtMs: Schema.optional(Schema.Number),
  visibleAppliedAtMs: Schema.optional(Schema.Number),
  matchedProviderSequence: Schema.optional(Schema.Number),
  ingestionDelayMs: Schema.optional(Schema.Number),
  applicationDelayMs: Schema.optional(Schema.Number),
  outcome: Schema.optional(
    Schema.Literal(
      "matched",
      "missing_game",
      "identity_mismatch",
      "home_away_reversal",
      "score_error",
      "final_status_error",
      "timestamp_mismatch",
      "freshness_breach",
    ),
  ),
});
const qualificationFindingSchema = Schema.Struct({
  eventOrdinal: Schema.optional(Schema.Number),
  gameOrdinal: Schema.optional(Schema.Number),
  code: Schema.Literal(
    "no_reference_events",
    "missing_final_reference",
    "missing_game",
    "identity_mismatch",
    "home_away_reversal",
    "score_error",
    "final_status_error",
    "timestamp_mismatch",
    "freshness_breach",
    "coverage_overflow",
    "unused_provider_transition",
    "external_id_mismatch",
    "season_year_mismatch",
    "kickoff_mismatch",
    "phase_mismatch",
    "findings_truncated",
  ),
  message: Schema.String,
});
const qualificationCandidateRejectionSchema = Schema.Struct({
  gameKey: Schema.String,
  code: Schema.Literal(
    "external_id_mismatch",
    "season_year_mismatch",
    "kickoff_mismatch",
    "identity_mismatch",
    "home_away_reversal",
    "phase_mismatch",
  ),
  recordedAtMs: Schema.Number,
  actualExternalId: Schema.NullOr(Schema.String),
  actualSeasonYear: Schema.Number,
  actualScheduledKickoffMs: Schema.Number,
  actualSeasonPhase: Schema.Literal(
    "preseason",
    "regular_season",
    "postseason",
    "unknown",
  ),
  actualProviderStage: Schema.String,
  actualHomeTeamAbbreviation: Schema.String,
  actualAwayTeamAbbreviation: Schema.String,
  actualHomeScore: Schema.NullOr(Schema.Number),
  actualAwayScore: Schema.NullOr(Schema.Number),
  actualStatus: Schema.String,
  providerObservedAtMs: Schema.Number,
});
const qualificationRunStateSchema = Schema.Struct({
  qualificationRunKey: Schema.String,
  provider: Schema.Literal("api-sports"),
  seasonId: Schema.String,
  seasonLabel: Schema.String,
  datasetFingerprint: Schema.String,
  policyVersion: Schema.Literal(PROVIDER_QUALIFICATION_POLICY_VERSION),
  generation: Schema.Number,
  status: Schema.Literal("collecting", "passed", "failed"),
  startedAtMs: Schema.Number,
  completedAtMs: Schema.optional(Schema.Number),
  nextSequence: Schema.Number,
  registeredGameCount: Schema.Number,
  referenceEventCount: Schema.Number,
  games: Schema.Array(qualificationGameSchema),
  events: Schema.Array(qualificationEventSchema),
  observedEvents: Schema.optional(Schema.Number),
  correctnessErrors: Schema.optional(Schema.Number),
  freshnessBreaches: Schema.optional(Schema.Number),
  missingGames: Schema.optional(Schema.Number),
  identityMismatches: Schema.optional(Schema.Number),
  homeAwayReversals: Schema.optional(Schema.Number),
  scoreErrors: Schema.optional(Schema.Number),
  finalStatusErrors: Schema.optional(Schema.Number),
  maxIngestionDelayMs: Schema.optional(Schema.Number),
  maxApplicationDelayMs: Schema.optional(Schema.Number),
  explanation: Schema.optional(Schema.String),
  coverageAttested: Schema.optional(Schema.Boolean),
  coverageAttestationText: Schema.optional(Schema.String),
  coverageOverflowed: Schema.optional(Schema.Boolean),
  candidateRejections: Schema.optional(
    Schema.Array(qualificationCandidateRejectionSchema),
  ),
  findingsTruncated: Schema.optional(Schema.Boolean),
  findings: Schema.optional(Schema.Array(qualificationFindingSchema)),
});

function encodeQualificationRun(state: QualificationRunState): string {
  const decoded = Schema.decodeUnknownSync(qualificationRunStateSchema)(
    state,
  ) as QualificationRunState;
  if (!validQualificationRunState(decoded)) {
    throw new Error("Invalid bounded qualification run state");
  }
  const encoded = JSON.stringify(decoded);
  if (new TextEncoder().encode(encoded).byteLength > MAX_QUALIFICATION_PAYLOAD_BYTES) {
    throw new Error("Qualification payload capacity exceeded");
  }
  return encoded;
}

function decodeQualificationRun(value: string): QualificationRunState | null {
  try {
    if (
      new TextEncoder().encode(value).byteLength >
      MAX_QUALIFICATION_PAYLOAD_BYTES
    ) {
      return null;
    }
    const decoded = Schema.decodeUnknownSync(qualificationRunStateSchema)(
      JSON.parse(value) as unknown,
    ) as QualificationRunState;
    return validQualificationRunState(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function validQualificationRunState(state: QualificationRunState): boolean {
  if (
    state.games.length > MAX_GAMES ||
    state.events.length > MAX_REFERENCES + MAX_PROVIDER_EVENTS ||
    (state.candidateRejections?.length ?? 0) >
      MAX_CANDIDATE_REJECTIONS ||
    (state.findings?.length ?? 0) > MAX_STORED_FINDINGS ||
    state.registeredGameCount !== state.games.length ||
    state.referenceEventCount !==
      state.events.filter((event) => event.eventType === "reference").length ||
    state.events.filter((event) => event.eventType === "reference").length >
      MAX_REFERENCES ||
    state.events.filter((event) => event.eventType === "provider").length >
      MAX_PROVIDER_EVENTS
  ) {
    return false;
  }
  const gameKeys = new Set(state.games.map((game) => game.stableKey));
  const candidateRejectionKeys = new Set<string>();
  for (const rejection of state.candidateRejections ?? []) {
    const key = `${rejection.gameKey}:${rejection.code}`;
    if (
      !gameKeys.has(rejection.gameKey) ||
      candidateRejectionKeys.has(key) ||
      !Number.isFinite(rejection.recordedAtMs) ||
      !Number.isFinite(rejection.actualSeasonYear) ||
      !Number.isFinite(rejection.actualScheduledKickoffMs) ||
      !Number.isFinite(rejection.providerObservedAtMs) ||
      (rejection.actualExternalId?.length ?? 0) > 80 ||
      rejection.actualProviderStage.length > 80 ||
      rejection.actualStatus.length > 40 ||
      (rejection.actualHomeScore !== null &&
        (!Number.isInteger(rejection.actualHomeScore) ||
          rejection.actualHomeScore < 0)) ||
      (rejection.actualAwayScore !== null &&
        (!Number.isInteger(rejection.actualAwayScore) ||
          rejection.actualAwayScore < 0))
    ) {
      return false;
    }
    candidateRejectionKeys.add(key);
  }
  const sequences = new Set<number>();
  const nonces = new Set<string>();
  for (const event of state.events) {
    if (
      !gameKeys.has(event.gameKey) ||
      sequences.has(event.sequence) ||
      !Number.isInteger(event.sequence) ||
      event.sequence < 1
    ) {
      return false;
    }
    sequences.add(event.sequence);
    if (event.eventType === "reference") {
      if (
        event.ordinal === undefined ||
        event.referenceAtMs === undefined ||
        event.source !== "official_nfl_view" ||
        event.clientNonce === undefined ||
        event.referenceHomeTeam === undefined ||
        event.referenceAwayTeam === undefined ||
        event.referenceHomeScore === undefined ||
        event.referenceAwayScore === undefined ||
        event.recordedAtMs === undefined ||
        nonces.has(event.clientNonce) ||
        (event.kind === "final" && event.referenceStatus === undefined) ||
        (event.kind === "score" && event.referenceStatus !== undefined)
      ) {
        return false;
      }
      nonces.add(event.clientNonce);
    } else if (
      event.provider !== "api-sports" ||
      event.externalId === undefined ||
      event.homeTeamAbbreviation === undefined ||
      event.awayTeamAbbreviation === undefined ||
      event.homeScore === undefined ||
      event.awayScore === undefined ||
      event.providerIngestedAtMs === undefined ||
      event.visibleAppliedAtMs === undefined
    ) {
      return false;
    }
  }
  return state.nextSequence > Math.max(0, ...sequences);
}

type QualificationRunRecord = QualificationRunState & {
  _id: Id<"operatorAuditEvents">;
  _creationTime: number;
  recordActorTokenIdentifier: string;
  recordActorClerkUserId: string;
};

const QUALIFICATION_RUN_ACTION_PREFIX = "provider_qualification_run:";
const MAX_QUALIFICATION_AUDIT_SCAN = 1_000;

/**
 * Qualification run records deliberately reuse operatorAuditEvents. Adding a
 * table or even widening the schema crosses this repository's Convex/TS
 * inference ceiling. The action prefix discriminates the one mutable record
 * variant; all operator actions and decisions remain separate append-only rows.
 */
function qualificationRunFromRow(
  row: Doc<"operatorAuditEvents"> | null,
): QualificationRunRecord | null {
  if (
    !row ||
    !row.action.startsWith(QUALIFICATION_RUN_ACTION_PREFIX) ||
    !row.detailsJson
  ) {
    return null;
  }
  const state = decodeQualificationRun(row.detailsJson);
  if (
    !state ||
    row.action !== `${QUALIFICATION_RUN_ACTION_PREFIX}${state.seasonId}`
  ) {
    return null;
  }
  return {
    _id: row._id,
    _creationTime: row._creationTime,
    recordActorTokenIdentifier: row.actorTokenIdentifier,
    recordActorClerkUserId: row.actorClerkUserId,
    ...state,
  };
}

async function getQualificationRun(
  ctx: QueryCtx | MutationCtx,
  runId: Id<"operatorAuditEvents">,
): Promise<QualificationRunRecord | null> {
  return qualificationRunFromRow(await ctx.db.get(runId));
}

async function patchQualificationRun(
  ctx: MutationCtx,
  run: QualificationRunRecord,
  patch: Partial<QualificationRunState>,
): Promise<void> {
  const next = { ...run, ...patch };
  const {
    _id,
    _creationTime,
    recordActorTokenIdentifier,
    recordActorClerkUserId,
    ...qualificationRun
  } = next;
  void _id;
  void _creationTime;
  void recordActorTokenIdentifier;
  void recordActorClerkUserId;
  await ctx.db.patch(run._id, {
    detailsJson: encodeQualificationRun(qualificationRun),
  });
}

type ProductionQualificationReceipt = {
  provider: "api-sports";
  seasonId: Id<"poolSeasons">;
  qualificationRunId: Id<"operatorAuditEvents">;
  datasetFingerprint: string;
  policyVersion: typeof PROVIDER_QUALIFICATION_POLICY_VERSION;
  generation: number;
  gateUpdatedAtMs: number;
};

const productionQualificationReceiptSchema = Schema.Struct({
  provider: Schema.Literal("api-sports"),
  seasonId: Schema.String,
  qualificationRunId: Schema.String,
  datasetFingerprint: Schema.String,
  policyVersion: Schema.Literal(PROVIDER_QUALIFICATION_POLICY_VERSION),
  generation: Schema.Number,
  gateUpdatedAtMs: Schema.Number,
});

function decodeProductionQualificationReceipt(
  value: string | undefined,
): ProductionQualificationReceipt | null {
  if (!value) return null;
  try {
    return Schema.decodeUnknownSync(productionQualificationReceiptSchema)(
      JSON.parse(value) as unknown,
    ) as ProductionQualificationReceipt;
  } catch {
    return null;
  }
}

async function currentProductionQualificationReceipt(
  ctx: QueryCtx | MutationCtx,
  gate: Doc<"syncGate"> | null,
): Promise<ProductionQualificationReceipt | null> {
  if (!gate?.enabled) return null;
  const rows = await ctx.db
    .query("operatorAuditEvents")
    .withIndex("by_atMs", (q) => q.eq("atMs", gate.updatedAtMs))
    .order("desc")
    .take(32);
  for (const row of rows) {
    if (
      row.action !== "production_competitive_sync_enabled" ||
      row.actorTokenIdentifier !== gate.updatedByTokenIdentifier
    ) {
      continue;
    }
    const receipt = decodeProductionQualificationReceipt(row.detailsJson);
    if (receipt?.gateUpdatedAtMs === gate.updatedAtMs) return receipt;
  }
  return null;
}

function deploymentKind(): string {
  return process.env.DEPLOYMENT_KIND?.trim().toLowerCase() ?? "";
}

function datasetFingerprint(
  season: Pick<Doc<"poolSeasons">, "_id" | "year" | "bootstrappedAtMs">,
): string {
  return `${season._id}:${season.year}:${season.bootstrappedAtMs ?? 0}`;
}

async function operatorActor(ctx: QueryCtx | MutationCtx) {
  return await requireProductionOperatorIdentity(
    ctx,
    process.env as Record<string, string | undefined>,
  );
}

async function writeAudit(
  ctx: MutationCtx,
  input: {
    action: string;
    actor: { tokenIdentifier: string; clerkUserId: string };
    nowMs: number;
    details: Record<string, string | number | boolean | null>;
  },
) {
  await ctx.db.insert("operatorAuditEvents", {
    action: input.action,
    actorTokenIdentifier: input.actor.tokenIdentifier,
    actorClerkUserId: input.actor.clerkUserId,
    atMs: input.nowMs,
    detailsJson: JSON.stringify(input.details),
  });
}

async function latestRun(
  ctx: QueryCtx | MutationCtx,
  seasonId: Id<"poolSeasons">,
) {
  const rows = await ctx.db
    .query("operatorAuditEvents")
    .withIndex("by_atMs")
    .order("desc")
    .take(MAX_QUALIFICATION_AUDIT_SCAN);
  for (const row of rows) {
    const run = qualificationRunFromRow(row);
    if (run?.seasonId === seasonId) return run;
  }
  return null;
}

async function disableMatchingProductionGate(
  ctx: MutationCtx,
  seasonId: Id<"poolSeasons">,
  nowMs: number,
  actorTokenIdentifier: string,
) {
  const gate = await ctx.db
    .query("syncGate")
    .withIndex("by_key", (q) => q.eq("key", "deployment"))
    .unique();
  if (gate?.enabled) {
    await ctx.db.patch(gate._id, {
      enabled: false,
      updatedAtMs: nowMs,
      updatedByTokenIdentifier: actorTokenIdentifier,
    });
  }
}

export const listQualificationSeasons = query({
  args: {},
  handler: async (ctx) => {
    await operatorActor(ctx);
    const rows = await ctx.db
      .query("poolSeasons")
      .withIndex("by_status", (q) => q.eq("status", "available"))
      .order("desc")
      .take(20);
    return rows.map((season) => ({
      seasonId: season._id,
      label: season.label,
      year: season.year,
      datasetFingerprint: datasetFingerprint(season),
    }));
  },
});

export const createQualificationRun = mutation({
  args: {
    provider: v.literal("api-sports"),
    seasonId: v.id("poolSeasons"),
  },
  handler: async (ctx, args) => {
    await assertLegacyContractionUnlocked(ctx);
    const nowMs = Date.now();
    const actor = await requireProductionOperatorWithStepUp(
      ctx,
      nowMs,
      process.env as Record<string, string | undefined>,
    );
    const season = await ctx.db.get(args.seasonId);
    if (!season || season.status !== "available") {
      throw new Error("Selected Pool Season is not available");
    }
    const previous = await latestRun(ctx, season._id);
    if (previous?.status === "collecting") {
      throw new Error("A qualification window is already collecting");
    }
    if (
      previous?.status === "failed" &&
      previous.completedAtMs !== undefined &&
      nowMs <= previous.completedAtMs
    ) {
      throw new Error(
        "A later non-overlapping qualification window is required",
      );
    }
    const generation = (previous?.generation ?? 0) + 1;
    const fingerprint = datasetFingerprint(season);
    const qualificationRunKey = `${season._id}:${generation}:${nowMs}`;
    const runId = await ctx.db.insert("operatorAuditEvents", {
      action: `${QUALIFICATION_RUN_ACTION_PREFIX}${season._id}`,
      actorTokenIdentifier: actor.tokenIdentifier,
      actorClerkUserId: actor.clerkUserId,
      atMs: nowMs,
      detailsJson: encodeQualificationRun({
        qualificationRunKey,
        provider: "api-sports",
        seasonId: season._id,
        seasonLabel: season.label,
        datasetFingerprint: fingerprint,
        policyVersion: PROVIDER_QUALIFICATION_POLICY_VERSION,
        generation,
        status: "collecting",
        startedAtMs: nowMs,
        nextSequence: 1,
        registeredGameCount: 0,
        referenceEventCount: 0,
        games: [],
        events: [],
      }),
    });
    if (deploymentKind() === "production") {
      await disableMatchingProductionGate(
        ctx,
        season._id,
        nowMs,
        actor.tokenIdentifier,
      );
    }
    await writeAudit(ctx, {
      action: "provider_qualification_created",
      actor,
      nowMs,
      details: {
        runId,
        provider: "api-sports",
        seasonId: season._id,
        datasetFingerprint: fingerprint,
        policyVersion: PROVIDER_QUALIFICATION_POLICY_VERSION,
        generation,
        qualificationRunKey,
      },
    });
    return { runId, status: "collecting" as const, generation };
  },
});

export const registerQualificationGame = mutation({
  args: {
    runId: v.id("operatorAuditEvents"),
    homeTeamAbbreviation: teamValidator,
    awayTeamAbbreviation: teamValidator,
    scheduledKickoffMs: v.number(),
    apiSportsExternalId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const nowMs = Date.now();
    const actor = await operatorActor(ctx);
    const run = await getQualificationRun(ctx, args.runId);
    if (!run || run.status !== "collecting") {
      throw new Error("Qualification run is not collecting");
    }
    if (run.registeredGameCount >= MAX_GAMES) {
      throw new Error("Qualification game capacity exceeded");
    }
    if (
      run.events.length > 0 ||
      (run.candidateRejections?.length ?? 0) > 0
    ) {
      throw new Error(
        "The registered qualification window is locked after evidence collection begins",
      );
    }
    if (
      args.homeTeamAbbreviation === args.awayTeamAbbreviation ||
      !Number.isFinite(args.scheduledKickoffMs) ||
      (args.apiSportsExternalId !== undefined &&
        args.apiSportsExternalId.trim().length === 0)
    ) {
      throw new Error("Invalid qualification game");
    }
    const stableKey =
      `${args.scheduledKickoffMs}:${args.awayTeamAbbreviation}@${args.homeTeamAbbreviation}`;
    const duplicate = run.games.find((game) => game.stableKey === stableKey);
    if (duplicate) return { gameKey: duplicate.stableKey, replayed: true };
    const externalId = args.apiSportsExternalId?.trim();
    const providerDuplicate = externalId
      ? run.games.find(
          (game) => game.apiSportsExternalId === externalId,
        )
      : null;
    if (providerDuplicate) {
      throw new Error("API-Sports binding already registered");
    }
    const game = {
      ordinal: run.registeredGameCount + 1,
      stableKey,
      homeTeamAbbreviation: args.homeTeamAbbreviation,
      awayTeamAbbreviation: args.awayTeamAbbreviation,
      scheduledKickoffMs: args.scheduledKickoffMs,
      apiSportsExternalId: externalId,
      registeredAtMs: nowMs,
    };
    await patchQualificationRun(ctx, run, {
      registeredGameCount: run.registeredGameCount + 1,
      games: [...run.games, game],
    });
    await writeAudit(ctx, {
      action: "provider_qualification_game_registered",
      actor,
      nowMs,
      details: {
        runId: run._id,
        gameKey: stableKey,
        stableKey,
      },
    });
    return { gameKey: stableKey, replayed: false };
  },
});

export const bindQualificationGameProviderCandidate = mutation({
  args: {
    runId: v.id("operatorAuditEvents"),
    gameKey: v.string(),
    apiSportsExternalId: v.string(),
  },
  handler: async (ctx, args) => {
    const nowMs = Date.now();
    const actor = await operatorActor(ctx);
    const run = await getQualificationRun(ctx, args.runId);
    const game =
      run?.games.find(
        (candidate) => candidate.stableKey === args.gameKey,
      ) ?? null;
    if (!run || run.status !== "collecting" || !game) {
      throw new Error("Qualification run/game is not collecting");
    }
    if (
      run.events.length > 0 ||
      (run.candidateRejections?.length ?? 0) > 0
    ) {
      throw new Error(
        "The registered qualification window is locked after evidence collection begins",
      );
    }
    const externalId = args.apiSportsExternalId.trim();
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(externalId)) {
      throw new Error("Invalid API-Sports candidate id");
    }
    const duplicate = run.games.find(
      (candidate) => candidate.apiSportsExternalId === externalId,
    );
    if (duplicate && duplicate.stableKey !== game.stableKey) {
      throw new Error("API-Sports candidate is already bound");
    }
    if (
      game.apiSportsExternalId !== undefined &&
      game.apiSportsExternalId !== externalId
    ) {
      throw new Error("Provider candidate binding is immutable");
    }
    await patchQualificationRun(ctx, run, {
      games: run.games.map((candidate) =>
        candidate.stableKey === game.stableKey
          ? { ...candidate, apiSportsExternalId: externalId }
          : candidate,
      ),
    });
    await writeAudit(ctx, {
      action: "provider_qualification_candidate_bound",
      actor,
      nowMs,
      details: {
        runId: run._id,
        gameKey: game.stableKey,
      },
    });
    return { gameKey: game.stableKey, bound: true as const };
  },
});

export const recordReferenceEvent = mutation({
  args: {
    runId: v.id("operatorAuditEvents"),
    gameKey: v.string(),
    kind: v.union(v.literal("score"), v.literal("final")),
    source: v.literal("official_nfl_view"),
    clientNonce: v.string(),
    homeTeamAbbreviation: teamValidator,
    awayTeamAbbreviation: teamValidator,
    homeScore: v.number(),
    awayScore: v.number(),
    status: v.optional(terminalStatusValidator),
  },
  handler: async (ctx, args) => {
    const nowMs = Date.now();
    const actor = await operatorActor(ctx);
    const run = await getQualificationRun(ctx, args.runId);
    const game = run?.games.find(
      (candidate) => candidate.stableKey === args.gameKey,
    );
    if (!run || run.status !== "collecting" || !game) {
      throw new Error("Qualification run/game is not collecting");
    }
    const nonce = args.clientNonce.trim();
    if (!/^[A-Za-z0-9:_-]{8,100}$/.test(nonce)) {
      throw new Error("Invalid reference capture nonce");
    }
    const replay = run.events.find(
      (event) =>
        event.eventType === "reference" && event.clientNonce === nonce,
    );
    if (replay) {
      return {
        recorded: false as const,
        eventSequence: replay.sequence,
        replayed: true as const,
        overflowed: false as const,
      };
    }
    if (run.referenceEventCount >= MAX_REFERENCES) {
      await patchQualificationRun(ctx, run, {
        coverageOverflowed: true,
      });
      await writeAudit(ctx, {
        action: "provider_qualification_reference_overflowed",
        actor,
        nowMs,
        details: {
          runId: run._id,
          gameKey: game.stableKey,
          kind: args.kind,
        },
      });
      return {
        recorded: false as const,
        replayed: false as const,
        overflowed: true as const,
      };
    }
    if (
      args.homeTeamAbbreviation !== game.homeTeamAbbreviation ||
      args.awayTeamAbbreviation !== game.awayTeamAbbreviation
    ) {
      throw new Error("Reference matchup does not match registered game");
    }
    if (
      !Number.isInteger(args.homeScore) ||
      !Number.isInteger(args.awayScore) ||
      args.homeScore < 0 ||
      args.awayScore < 0 ||
      (args.kind === "final" && args.status === undefined) ||
      (args.kind === "score" && args.status !== undefined)
    ) {
      throw new Error("Invalid reference score/status");
    }
    const sequence = run.nextSequence;
    const event = {
        eventType: "reference",
        gameKey: game.stableKey,
        ordinal: run.referenceEventCount + 1,
        sequence,
        kind: args.kind,
        referenceAtMs: nowMs,
        source: "official_nfl_view",
        clientNonce: nonce,
        referenceHomeTeam: args.homeTeamAbbreviation,
        referenceAwayTeam: args.awayTeamAbbreviation,
        referenceHomeScore: args.homeScore,
        referenceAwayScore: args.awayScore,
        referenceStatus: args.status,
        recordedAtMs: nowMs,
      } as const;
    await patchQualificationRun(ctx, run, {
      nextSequence: sequence + 1,
      referenceEventCount: run.referenceEventCount + 1,
      events: [...run.events, event],
    });
    await writeAudit(ctx, {
      action: "provider_qualification_reference_recorded",
      actor,
      nowMs,
      details: {
        runId: run._id,
        gameKey: game.stableKey,
        eventSequence: sequence,
        kind: args.kind,
        source: args.source,
        sequence,
        referenceAtMs: nowMs,
        homeTeamAbbreviation: args.homeTeamAbbreviation,
        awayTeamAbbreviation: args.awayTeamAbbreviation,
        homeScore: args.homeScore,
        awayScore: args.awayScore,
        status: args.status ?? null,
      },
    });
    return {
      recorded: true as const,
      eventSequence: sequence,
      replayed: false,
      overflowed: false as const,
      referenceAtMs: nowMs,
      sequence,
    };
  },
});

export const recordQualificationProviderEvent = internalMutation({
  args: {
    runId: v.id("operatorAuditEvents"),
    gameKey: v.string(),
    externalId: v.string(),
    homeTeamAbbreviation: teamValidator,
    awayTeamAbbreviation: teamValidator,
    homeScore: v.number(),
    awayScore: v.number(),
    status: v.optional(terminalStatusValidator),
    providerIngestedAtMs: v.number(),
  },
  handler: async (ctx, args) => {
    const appliedAtMs = Date.now();
    const run = await getQualificationRun(ctx, args.runId);
    const game = run?.games.find(
      (candidate) => candidate.stableKey === args.gameKey,
    );
    if (!run || run.status !== "collecting" || !game) {
      throw new Error("Qualification run/game is not active");
    }
    if (
      game.apiSportsExternalId === undefined ||
      game.apiSportsExternalId !== args.externalId
    ) {
      throw new Error("Qualification provider binding mismatch");
    }
    const prior = [...run.events]
      .reverse()
      .find(
        (event) =>
          event.eventType === "provider" &&
          event.gameKey === game.stableKey,
      );
    const kind = args.status ? ("final" as const) : ("score" as const);
    if (
      prior &&
      prior.homeTeamAbbreviation === args.homeTeamAbbreviation &&
      prior.awayTeamAbbreviation === args.awayTeamAbbreviation &&
      prior.homeScore === args.homeScore &&
      prior.awayScore === args.awayScore &&
      prior.status === args.status &&
      prior.kind === kind
    ) {
      return {
        recorded: false as const,
        overflowed: false as const,
        eventSequence: prior.sequence,
      };
    }
    const providerEventCount = run.events.filter(
      (event) => event.eventType === "provider",
    ).length;
    if (providerEventCount >= MAX_PROVIDER_EVENTS) {
      await patchQualificationRun(ctx, run, {
        coverageOverflowed: true,
      });
      await writeAudit(ctx, {
        action: "provider_qualification_provider_event_overflowed",
        actor: {
          tokenIdentifier: run.recordActorTokenIdentifier,
          clerkUserId: run.recordActorClerkUserId,
        },
        nowMs: appliedAtMs,
        details: {
          runId: run._id,
          gameKey: game.stableKey,
        },
      });
      return {
        recorded: false as const,
        overflowed: true as const,
        eventSequence: null,
      };
    }
    const event = {
        eventType: "provider",
        gameKey: game.stableKey,
        sequence: run.nextSequence,
        kind,
        provider: "api-sports",
        externalId: args.externalId,
        homeTeamAbbreviation: args.homeTeamAbbreviation,
        awayTeamAbbreviation: args.awayTeamAbbreviation,
        homeScore: args.homeScore,
        awayScore: args.awayScore,
        status: args.status,
        providerIngestedAtMs: args.providerIngestedAtMs,
        // Commit time when this provider observation becomes visible in the
        // isolated qualification console projection (never nflGames).
        visibleAppliedAtMs: appliedAtMs,
      } as const;
    await patchQualificationRun(ctx, run, {
      nextSequence: run.nextSequence + 1,
      events: [...run.events, event],
    });
    await writeAudit(ctx, {
      action: "provider_qualification_provider_event_recorded",
      actor: {
        tokenIdentifier: run.recordActorTokenIdentifier,
        clerkUserId: run.recordActorClerkUserId,
      },
      nowMs: appliedAtMs,
      details: {
        runId: run._id,
        gameKey: game.stableKey,
        eventSequence: run.nextSequence,
        externalId: args.externalId,
        kind,
        providerIngestedAtMs: args.providerIngestedAtMs,
        visibleAppliedAtMs: appliedAtMs,
        homeTeamAbbreviation: args.homeTeamAbbreviation,
        awayTeamAbbreviation: args.awayTeamAbbreviation,
        homeScore: args.homeScore,
        awayScore: args.awayScore,
        status: args.status ?? null,
      },
    });
    return {
      recorded: true as const,
      overflowed: false as const,
      eventSequence: run.nextSequence,
      sequence: run.nextSequence,
      visibleAppliedAtMs: appliedAtMs,
    };
  },
});

export const getQualificationPollTarget = internalQuery({
  args: {
    runId: v.id("operatorAuditEvents"),
    gameKey: v.string(),
  },
  handler: async (ctx, args) => {
    await operatorActor(ctx);
    const run = await getQualificationRun(ctx, args.runId);
    const game = run?.games.find(
      (candidate) => candidate.stableKey === args.gameKey,
    );
    if (!run || run.status !== "collecting" || !game) {
      throw new Error("Active qualification run/game required");
    }
    const season = await ctx.db.get(run.seasonId);
    if (!season) throw new Error("Qualification Pool Season not found");
    if (!game.apiSportsExternalId) {
      return {
        runId: run._id,
        seasonId: run.seasonId,
        seasonYear: season.year,
        game,
        pollable: false as const,
      };
    }
    return {
      runId: run._id,
      seasonId: run.seasonId,
      seasonYear: season.year,
      game,
      pollable: true as const,
    };
  },
});

export const recordQualificationPollRejection = internalMutation({
  args: {
    runId: v.id("operatorAuditEvents"),
    gameKey: v.string(),
    reason: v.union(
      v.literal("external_id_mismatch"),
      v.literal("season_year_mismatch"),
      v.literal("kickoff_mismatch"),
      v.literal("identity_mismatch"),
      v.literal("home_away_reversal"),
      v.literal("phase_mismatch"),
    ),
    evidence: v.object({
      actualExternalId: v.union(v.string(), v.null()),
      actualSeasonYear: v.number(),
      actualScheduledKickoffMs: v.number(),
      actualSeasonPhase: v.union(
        v.literal("preseason"),
        v.literal("regular_season"),
        v.literal("postseason"),
        v.literal("unknown"),
      ),
      actualProviderStage: v.string(),
      actualHomeTeamAbbreviation: teamValidator,
      actualAwayTeamAbbreviation: teamValidator,
      actualHomeScore: v.union(v.number(), v.null()),
      actualAwayScore: v.union(v.number(), v.null()),
      actualStatus: v.string(),
      providerObservedAtMs: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const run = await getQualificationRun(ctx, args.runId);
    const game = run?.games.find(
      (candidate) => candidate.stableKey === args.gameKey,
    );
    if (!run || run.status !== "collecting" || !game) {
      throw new Error("Active qualification run/game not found");
    }
    const existing = run.candidateRejections?.find(
      (rejection) =>
        rejection.gameKey === game.stableKey &&
        rejection.code === args.reason,
    );
    if (!existing) {
      const candidateRejections = [
        ...(run.candidateRejections ?? []),
        {
          gameKey: game.stableKey,
          code: args.reason,
          recordedAtMs: Date.now(),
          ...args.evidence,
        },
      ];
      if (candidateRejections.length > MAX_CANDIDATE_REJECTIONS) {
        throw new Error("Qualification candidate rejection capacity exceeded");
      }
      await patchQualificationRun(ctx, run, { candidateRejections });
    }
    await writeAudit(ctx, {
      action: "provider_qualification_poll_rejected",
      actor: {
        tokenIdentifier: run.recordActorTokenIdentifier,
        clerkUserId: run.recordActorClerkUserId,
      },
      nowMs: Date.now(),
      details: {
        runId: run._id,
        gameKey: game.stableKey,
        reason: args.reason,
        recorded: existing === undefined,
        actualExternalId: args.evidence.actualExternalId,
        actualSeasonYear: args.evidence.actualSeasonYear,
        actualScheduledKickoffMs:
          args.evidence.actualScheduledKickoffMs,
        actualSeasonPhase: args.evidence.actualSeasonPhase,
        actualProviderStage: args.evidence.actualProviderStage,
        actualHomeTeamAbbreviation:
          args.evidence.actualHomeTeamAbbreviation,
        actualAwayTeamAbbreviation:
          args.evidence.actualAwayTeamAbbreviation,
        actualHomeScore: args.evidence.actualHomeScore,
        actualAwayScore: args.evidence.actualAwayScore,
        actualStatus: args.evidence.actualStatus,
        providerObservedAtMs: args.evidence.providerObservedAtMs,
      },
    });
    return { recorded: existing === undefined };
  },
});

function firstOutcome(
  findingCodes: readonly string[],
):
  | "matched"
  | "missing_game"
  | "identity_mismatch"
  | "home_away_reversal"
  | "score_error"
  | "final_status_error"
  | "timestamp_mismatch"
  | "freshness_breach" {
  const first = findingCodes[0];
  if (
    first === "missing_game" ||
    first === "identity_mismatch" ||
    first === "home_away_reversal" ||
    first === "score_error" ||
    first === "final_status_error" ||
    first === "timestamp_mismatch" ||
    first === "freshness_breach"
  ) {
    return first;
  }
  return first ? "score_error" : "matched";
}

function candidateRejectionMessage(
  code: QualificationCandidateRejection["code"],
): string {
  switch (code) {
    case "external_id_mismatch":
      return "Returned API-Sports game ID did not match the registered candidate.";
    case "season_year_mismatch":
      return "Returned API-Sports game belonged to another season year.";
    case "kickoff_mismatch":
      return "Returned API-Sports kickoff was outside the allowed tolerance.";
    case "home_away_reversal":
      return "Returned API-Sports home and away teams were reversed.";
    case "identity_mismatch":
      return "Returned API-Sports teams did not match the registered game.";
    case "phase_mismatch":
      return "Returned API-Sports game was not a preseason game.";
  }
}

export const finalizeQualificationRun = mutation({
  args: {
    runId: v.id("operatorAuditEvents"),
    explanation: v.string(),
    allObservedEventsRecorded: v.boolean(),
    confirmationText: v.string(),
  },
  handler: async (ctx, args) => {
    const nowMs = Date.now();
    const actor = await requireProductionOperatorWithStepUp(
      ctx,
      nowMs,
      process.env as Record<string, string | undefined>,
    );
    const run = await getQualificationRun(ctx, args.runId);
    if (!run) throw new Error("Qualification run not found");
    if (run.status !== "collecting") {
      throw new Error(
        "Final decisions are immutable; a new qualification window is required",
      );
    }
    const explanation = args.explanation.trim();
    if (explanation.length < 8 || explanation.length > 1_000) {
      throw new Error("Qualification explanation must be 8-1000 characters");
    }
    if (
      !args.allObservedEventsRecorded ||
      args.confirmationText !== QUALIFICATION_COVERAGE_ATTESTATION
    ) {
      throw new Error(
        "Explicit completeness attestation is required before qualification can be decided",
      );
    }
    const games = run.games;
    const allEvents = run.events;
    const references = allEvents.filter(
      (event) => event.eventType === "reference",
    );
    const applications = allEvents.filter(
      (event) => event.eventType === "provider",
    );
    if (
      games.length > MAX_GAMES ||
      references.length > MAX_REFERENCES ||
      applications.length > MAX_PROVIDER_EVENTS ||
      allEvents.length > MAX_REFERENCES + MAX_PROVIDER_EVENTS
    ) {
      throw new Error("Qualification coverage capacity exceeded");
    }
    const appsByGame = new Map<string, typeof applications>();
    for (const application of applications) {
      const values = appsByGame.get(application.gameKey) ?? [];
      values.push(application);
      appsByGame.set(application.gameKey, values);
    }
    const used = new Set<number>();
    const matchedApplicationByEventId = new Map<
      string,
      QualificationEvent
    >();
    const policyEvents: QualificationReferenceEvent[] = [];
    for (const reference of references) {
      const eventId = String(reference.sequence);
      const candidates =
        appsByGame.get(reference.gameKey) ?? [];
      let application: QualificationEvent | null = null;
      for (const candidate of candidates) {
        if (
          candidate.sequence <= reference.sequence ||
          candidate.visibleAppliedAtMs! < reference.referenceAtMs! ||
          used.has(candidate.sequence) ||
          (reference.kind === "final" && candidate.kind !== "final")
        ) {
          continue;
        }
        const identityMatches =
          candidate.homeTeamAbbreviation === reference.referenceHomeTeam &&
          candidate.awayTeamAbbreviation === reference.referenceAwayTeam;
        const scoreMatches =
          candidate.homeScore === reference.referenceHomeScore &&
          candidate.awayScore === reference.referenceAwayScore;
        const statusMatches =
          reference.kind !== "final" ||
          candidate.status === reference.referenceStatus;
        if (identityMatches && scoreMatches && statusMatches) {
          application = candidate;
          break;
        }
        if (!identityMatches) {
          application = candidate;
          break;
        }
        const prior = [...candidates]
          .reverse()
          .find(
            (earlier) =>
              earlier.sequence < candidate.sequence &&
              earlier.sequence > reference.sequence,
          );
        const lowerBaseline =
          candidate.homeScore! <= reference.referenceHomeScore! &&
          candidate.awayScore! <= reference.referenceAwayScore! &&
          (candidate.homeScore! < reference.referenceHomeScore! ||
            candidate.awayScore! < reference.referenceAwayScore!);
        const regression =
          prior !== undefined &&
          (candidate.homeScore! < prior.homeScore! ||
            candidate.awayScore! < prior.awayScore!);
        if (lowerBaseline && !regression) continue;
        application = candidate;
        break;
      }
      if (application) {
        used.add(application.sequence);
        matchedApplicationByEventId.set(eventId, application);
      }
      policyEvents.push({
        eventId,
        gameId: reference.gameKey,
        kind: reference.kind,
        referenceAtMs: reference.referenceAtMs!,
        referenceHomeTeam: reference.referenceHomeTeam!,
        referenceAwayTeam: reference.referenceAwayTeam!,
        referenceHomeScore: reference.referenceHomeScore!,
        referenceAwayScore: reference.referenceAwayScore!,
        referenceStatus: reference.referenceStatus ?? null,
        expectedExternalId:
          games.find((game) => game.stableKey === reference.gameKey)
            ?.apiSportsExternalId ?? null,
        evidence: application
          ? {
              provider: "api-sports",
              externalId: application.externalId!,
              homeTeam: application.homeTeamAbbreviation!,
              awayTeam: application.awayTeamAbbreviation!,
              homeScore: application.homeScore!,
              awayScore: application.awayScore!,
              status: application.status ?? null,
              ingestedAtMs: application.providerIngestedAtMs!,
              appliedAtMs: application.visibleAppliedAtMs!,
            }
          : null,
      });
    }
    const assessment = assessQualificationWindow(policyEvents);
    const gamesWithFinal = new Set(
      references
        .filter((reference) => reference.kind === "final")
        .map((reference) => reference.gameKey),
    );
    const incompleteGames = games.filter(
      (game) => !gamesWithFinal.has(game.stableKey),
    );
    const unusedTransitionFindings = applications.flatMap((application) => {
      if (used.has(application.sequence)) return [];
      const reference = [...references]
        .reverse()
        .find(
          (candidate) =>
            candidate.gameKey === application.gameKey &&
            candidate.sequence < application.sequence &&
            (matchedApplicationByEventId.get(String(candidate.sequence))
              ?.sequence ?? Number.POSITIVE_INFINITY) <
              application.sequence,
        );
      if (!reference) return [];
      const identityMatches =
        application.homeTeamAbbreviation === reference.referenceHomeTeam &&
        application.awayTeamAbbreviation === reference.referenceAwayTeam;
      const homeAwayReversed =
        application.homeTeamAbbreviation === reference.referenceAwayTeam &&
        application.awayTeamAbbreviation === reference.referenceHomeTeam;
      const scoreMatches =
        application.homeScore === reference.referenceHomeScore &&
        application.awayScore === reference.referenceAwayScore;
      const statusMatches =
        reference.kind !== "final" ||
        application.status === reference.referenceStatus;
      if (identityMatches && scoreMatches && statusMatches) return [];
      const findings: Array<{
        eventId: string;
        gameId: string;
        code:
          | "identity_mismatch"
          | "home_away_reversal"
          | "score_error"
          | "final_status_error";
        message: string;
      }> = [];
      if (homeAwayReversed) {
        findings.push({
          eventId: String(reference.sequence),
          gameId: reference.gameKey,
          code: "home_away_reversal",
          message:
            "A later unused provider transition reversed home and away teams.",
        });
      } else if (!identityMatches) {
        findings.push({
          eventId: String(reference.sequence),
          gameId: reference.gameKey,
          code: "identity_mismatch",
          message:
            "A later unused provider transition changed the game identity.",
        });
      }
      if (!scoreMatches) {
        findings.push({
          eventId: String(reference.sequence),
          gameId: reference.gameKey,
          code: "score_error",
          message:
            "A later unused provider transition contradicted the matched score.",
        });
      }
      if (!statusMatches) {
        findings.push({
          eventId: String(reference.sequence),
          gameId: reference.gameKey,
          code: "final_status_error",
          message:
            "A later unused provider transition contradicted the matched final status.",
        });
      }
      return findings;
    });
    const extraFindings = [
      ...(games.length === 0
        ? [
            {
              eventId: null,
              gameId: null,
              code: "missing_game" as const,
              message: "At least one official qualification game is required.",
            },
          ]
        : []),
      ...incompleteGames.map((game) => ({
        eventId: null,
        gameId: game.stableKey,
        code: "missing_final_reference" as const,
        message: "Registered game has no independent final reference.",
      })),
      ...(run.coverageOverflowed
        ? [
            {
              eventId: null,
              gameId: null,
              code: "coverage_overflow" as const,
              message:
                "The declared qualification window exceeded durable evidence capacity.",
            },
          ]
        : []),
      ...(run.candidateRejections ?? []).map((rejection) => ({
        eventId: null,
        gameId: rejection.gameKey,
        code: rejection.code,
        message: candidateRejectionMessage(rejection.code),
      })),
      ...unusedTransitionFindings,
    ];
    const allFindings = [...assessment.findings, ...extraFindings];
    const status =
      allFindings.length === 0 ? ("passed" as const) : ("failed" as const);
    const referenceOrdinals = new Map(
      references.map((reference) => [
        String(reference.sequence),
        reference.ordinal,
      ]),
    );
    const gameOrdinals = new Map(
      games.map((game) => [game.stableKey, game.ordinal]),
    );
    const detailedFindings = allFindings.map((result) => ({
      eventOrdinal:
        result.eventId === null
          ? undefined
          : referenceOrdinals.get(result.eventId),
      gameOrdinal:
        result.gameId === null
          ? undefined
          : gameOrdinals.get(result.gameId),
      code: result.code,
      message: result.message,
    }));
    const findingsTruncated =
      detailedFindings.length > MAX_STORED_FINDINGS;
    const storedFindings = findingsTruncated
      ? [
          ...detailedFindings.slice(0, MAX_STORED_FINDINGS - 1),
          {
            code: "findings_truncated" as const,
            message:
              `${detailedFindings.length - (MAX_STORED_FINDINGS - 1)} additional findings were omitted from detail; aggregate counters remain exact.`,
          },
        ]
      : detailedFindings;
    const policyByEventId = new Map(
      policyEvents.map((event) => [event.eventId, event]),
    );
    const finalizedEvents = run.events.map((current) => {
      if (current.eventType !== "reference") return current;
      const eventId = String(current.sequence);
      const event = policyByEventId.get(eventId);
      if (!event) return current;
      const eventFindings = allFindings.filter(
        (finding) => finding.eventId === eventId,
      );
      const evidence = event.evidence;
      const app = matchedApplicationByEventId.get(eventId);
      return {
        ...current,
        matchedProviderSequence: app?.sequence,
        providerIngestedAtMs: evidence?.ingestedAtMs,
        visibleAppliedAtMs: evidence?.appliedAtMs,
        ingestionDelayMs: evidence
          ? evidence.ingestedAtMs - current.referenceAtMs!
          : undefined,
        applicationDelayMs: evidence
          ? evidence.appliedAtMs - current.referenceAtMs!
          : undefined,
        outcome: firstOutcome(eventFindings.map((item) => item.code)),
      };
    });
    const correctnessErrors = allFindings.filter(
      (finding) =>
        finding.code !== "freshness_breach" &&
        finding.code !== "no_reference_events",
    ).length;
    const missingGames = allFindings.filter(
      (finding) => finding.code === "missing_game",
    ).length;
    const identityMismatches = allFindings.filter(
      (finding) =>
        finding.code === "identity_mismatch" ||
        finding.code === "external_id_mismatch" ||
        finding.code === "season_year_mismatch" ||
        finding.code === "kickoff_mismatch",
    ).length;
    const homeAwayReversals = allFindings.filter(
      (finding) => finding.code === "home_away_reversal",
    ).length;
    const scoreErrors = allFindings.filter(
      (finding) => finding.code === "score_error",
    ).length;
    const finalStatusErrors = allFindings.filter(
      (finding) => finding.code === "final_status_error",
    ).length;
    await patchQualificationRun(ctx, run, {
      status,
      completedAtMs: nowMs,
      observedEvents: assessment.observedEvents,
      correctnessErrors,
      freshnessBreaches: assessment.freshnessBreaches,
      missingGames,
      identityMismatches,
      homeAwayReversals,
      scoreErrors,
      finalStatusErrors,
      maxIngestionDelayMs: assessment.maxIngestionDelayMs ?? undefined,
      maxApplicationDelayMs: assessment.maxApplicationDelayMs ?? undefined,
      explanation,
      coverageAttested: true,
      coverageAttestationText: args.confirmationText,
      findings: storedFindings,
      findingsTruncated,
      events: finalizedEvents,
    });
    if (status === "failed") {
      await disableMatchingProductionGate(
        ctx,
        run.seasonId,
        nowMs,
        actor.tokenIdentifier,
      );
    }
    await writeAudit(ctx, {
      action:
        status === "passed"
          ? "provider_qualification_passed"
          : "provider_qualification_failed",
      actor,
      nowMs,
      details: {
        runId: run._id,
        provider: run.provider,
        seasonId: run.seasonId,
        generation: run.generation,
        observedEvents: assessment.observedEvents,
        correctnessErrors,
        freshnessBreaches: assessment.freshnessBreaches,
        coverageAttested: true,
      },
    });
    return {
      status,
      observedEvents: assessment.observedEvents,
      correctnessErrors,
      freshnessBreaches: assessment.freshnessBreaches,
      missingGames,
      identityMismatches,
      homeAwayReversals,
      scoreErrors,
      finalStatusErrors,
      maxIngestionDelayMs: assessment.maxIngestionDelayMs,
      maxApplicationDelayMs: assessment.maxApplicationDelayMs,
    };
  },
});

export const setProductionCompetitiveSyncEnabled = mutation({
  args: {
    enabled: v.boolean(),
    seasonId: v.id("poolSeasons"),
    provider: v.literal("api-sports"),
  },
  handler: async (ctx, args) => {
    if (args.enabled && (await isLegacyContractionLocked(ctx))) {
      throw new Error(
        "Legacy contract migration is locked; production sync cannot be enabled",
      );
    }
    const nowMs = Date.now();
    const actor = await requireProductionOperatorWithStepUp(
      ctx,
      nowMs,
      process.env as Record<string, string | undefined>,
    );
    const kind = deploymentKind();
    if (
      args.enabled &&
      kind !== "development" &&
      kind !== "dev" &&
      kind !== "production"
    ) {
      throw new Error(
        "Production competitive sync cannot enable for an unknown deployment kind",
      );
    }
    const [season, latest] = await Promise.all([
      ctx.db.get(args.seasonId),
      latestRun(ctx, args.seasonId),
    ]);
    if (!season) throw new Error("Pool Season not found");
    if (args.enabled && kind === "production") {
      if (
        !latest ||
        latest.status !== "passed" ||
        latest.datasetFingerprint !== datasetFingerprint(season) ||
        latest.policyVersion !== PROVIDER_QUALIFICATION_POLICY_VERSION
      ) {
        throw new Error(
          "A current passing qualification is required before production competitive sync can enable",
        );
      }
    }
    const gate = await ctx.db
      .query("syncGate")
      .withIndex("by_key", (q) => q.eq("key", "deployment"))
      .unique();
    const patch = {
      enabled: args.enabled,
      updatedAtMs: nowMs,
      updatedByTokenIdentifier: actor.tokenIdentifier,
    };
    if (gate) await ctx.db.patch(gate._id, patch);
    else {
      await ctx.db.insert("syncGate", { key: "deployment", ...patch });
    }
    await writeAudit(ctx, {
      action: args.enabled
        ? "production_competitive_sync_enabled"
        : "production_competitive_sync_disabled",
      actor,
      nowMs,
      details: {
        provider: args.provider,
        seasonId: season._id,
        qualificationRunId:
          args.enabled && latest?.status === "passed"
            ? latest._id
            : null,
        datasetFingerprint:
          args.enabled && latest?.status === "passed"
            ? latest.datasetFingerprint
            : null,
        policyVersion:
          args.enabled && latest?.status === "passed"
            ? latest.policyVersion
            : null,
        generation:
          args.enabled && latest?.status === "passed"
            ? latest.generation
            : null,
        gateUpdatedAtMs: nowMs,
      },
    });
    return {
      enabled: args.enabled,
      qualificationRunId:
        args.enabled && latest?.status === "passed"
          ? latest._id
          : null,
    };
  },
});

export const authorizeProductionProviderRequest = internalMutation({
  args: {
    intent: v.union(
      v.literal("competitive"),
      v.literal("qualification"),
      v.literal("bootstrap"),
      v.literal("health"),
    ),
    qualificationRunId: v.optional(v.id("operatorAuditEvents")),
    expectedSeasonId: v.optional(v.id("poolSeasons")),
  },
  handler: async (ctx, args) => {
    await assertLegacyContractionUnlocked(ctx);
    const kind = deploymentKind();
    if (kind === "development" || kind === "dev") {
      return { allowed: true as const, fence: null };
    }
    if (kind !== "production") {
      return { allowed: false as const, reason: "deployment_not_allowed" };
    }
    if (args.intent === "bootstrap" || args.intent === "health") {
      return { allowed: true as const, fence: null };
    }
    if (args.intent === "qualification") {
      const run = args.qualificationRunId
        ? await getQualificationRun(ctx, args.qualificationRunId)
        : null;
      const decision = canRunAutomatedProviderSync({
        deploymentKind: kind,
        mode: "qualification",
        provider: "api-sports",
        hasCurrentPassingQualification: false,
        hasActiveQualificationRun: run?.status === "collecting",
      });
      if (
        decision.allowed &&
        args.expectedSeasonId !== undefined &&
        run?.seasonId !== args.expectedSeasonId
      ) {
        return {
          allowed: false as const,
          reason: "qualification_season_mismatch",
        };
      }
      return decision.allowed
        ? { allowed: true as const, fence: null }
        : { allowed: false as const, reason: decision.reason };
    }
    const gate = await ctx.db
      .query("syncGate")
      .withIndex("by_key", (q) => q.eq("key", "deployment"))
      .unique();
    const receipt = await currentProductionQualificationReceipt(ctx, gate);
    if (!gate?.enabled || !receipt) {
      return { allowed: false as const, reason: "qualification_required" };
    }
    if (
      args.expectedSeasonId !== undefined &&
      receipt.seasonId !== args.expectedSeasonId
    ) {
      return {
        allowed: false as const,
        reason: "qualification_season_mismatch",
      };
    }
    const [season, decisionRun] = await Promise.all([
      ctx.db.get(receipt.seasonId),
      getQualificationRun(ctx, receipt.qualificationRunId),
    ]);
    if (
      !season ||
      !decisionRun ||
      decisionRun.status !== "passed" ||
      datasetFingerprint(season) !== decisionRun.datasetFingerprint ||
      receipt.datasetFingerprint !== decisionRun.datasetFingerprint ||
      receipt.policyVersion !== decisionRun.policyVersion ||
      receipt.generation !== decisionRun.generation
    ) {
      return { allowed: false as const, reason: "qualification_stale" };
    }
    const fence: ProductionQualificationFence = {
      provider: "api-sports",
      seasonId: decisionRun.seasonId,
      datasetFingerprint: decisionRun.datasetFingerprint,
      policyVersion: decisionRun.policyVersion,
      generation: decisionRun.generation,
      decisionRunId: decisionRun._id,
    };
    return { allowed: true as const, fence };
  },
});

export async function requireCurrentProductionQualificationFence(
  ctx: QueryCtx | MutationCtx,
  fence: ProductionQualificationFence | undefined,
  expectedSeasonId?: Id<"poolSeasons">,
): Promise<void> {
  const kind = deploymentKind();
  if (kind === "development" || kind === "dev") return;
  if (kind !== "production" || !fence) {
    throw new Error("Current production qualification fence required");
  }
  if (expectedSeasonId !== undefined && fence.seasonId !== expectedSeasonId) {
    throw new Error("Production qualification fence targets another Pool Season");
  }
  const gate = await ctx.db
    .query("syncGate")
    .withIndex("by_key", (q) => q.eq("key", "deployment"))
    .unique();
  const receipt = await currentProductionQualificationReceipt(ctx, gate);
  if (
    !gate?.enabled ||
    !receipt ||
    receipt.provider !== fence.provider ||
    receipt.seasonId !== fence.seasonId ||
    receipt.qualificationRunId !== fence.decisionRunId ||
    receipt.datasetFingerprint !== fence.datasetFingerprint ||
    receipt.policyVersion !== fence.policyVersion ||
    receipt.generation !== fence.generation
  ) {
    throw new Error("Production qualification fence is stale");
  }
  const [season, decisionRun] = await Promise.all([
    ctx.db.get(fence.seasonId),
    getQualificationRun(ctx, fence.decisionRunId),
  ]);
  if (
    !season ||
    !decisionRun ||
    decisionRun.status !== "passed" ||
    datasetFingerprint(season) !== fence.datasetFingerprint
  ) {
    throw new Error("Production qualification dataset is stale");
  }
}

export const assertCurrentProductionQualificationFence = internalMutation({
  args: {
    productionFence: v.optional(productionQualificationFenceValidator),
    expectedSeasonId: v.optional(v.id("poolSeasons")),
  },
  handler: async (ctx, args) => {
    await requireCurrentProductionQualificationFence(
      ctx,
      args.productionFence as ProductionQualificationFence | undefined,
      args.expectedSeasonId,
    );
    return { current: true as const };
  },
});

export async function isCompetitiveProviderSyncAuthorized(
  ctx: QueryCtx | MutationCtx,
): Promise<boolean> {
  const kind = deploymentKind();
  if (kind === "development" || kind === "dev") return true;
  if (kind !== "production") return false;
  const gate = await ctx.db
    .query("syncGate")
    .withIndex("by_key", (q) => q.eq("key", "deployment"))
    .unique();
  const receipt = await currentProductionQualificationReceipt(ctx, gate);
  if (!gate?.enabled || !receipt) {
    return false;
  }
  const [season, decisionRun] = await Promise.all([
    ctx.db.get(receipt.seasonId),
    getQualificationRun(ctx, receipt.qualificationRunId),
  ]);
  return Boolean(
    season &&
      decisionRun &&
      decisionRun.status === "passed" &&
      datasetFingerprint(season) === decisionRun.datasetFingerprint &&
      receipt.datasetFingerprint === decisionRun.datasetFingerprint &&
      receipt.policyVersion === decisionRun.policyVersion &&
      receipt.generation === decisionRun.generation,
  );
}

export const claimQualificationProviderFetch = mutation({
  args: {
    runId: v.id("operatorAuditEvents"),
    surface: qualificationSurfaceValidator,
  },
  handler: async (ctx, args) => {
    await assertLegacyContractionUnlocked(ctx);
    await operatorActor(ctx);
    const run = await getQualificationRun(ctx, args.runId);
    if (!run || run.status !== "collecting") {
      throw new Error("Active qualification run required");
    }
    const nowMs = Date.now();
    await ctx.db.insert("providerFetchClaims", {
      surface: args.surface,
      status: "claimed",
      claimedAtMs: nowMs,
      priority: "operator",
      expiresAtMs: providerDiagnosticExpiry(nowMs),
    });
    return {
      ok: true as const,
      mode: "qualification" as const,
      runId: run._id,
      generation: run.generation,
    };
  },
});

function qualificationRunSummary(run: QualificationRunRecord) {
  return {
    _id: run._id,
    _creationTime: run._creationTime,
    provider: run.provider,
    seasonId: run.seasonId,
    seasonLabel: run.seasonLabel,
    datasetFingerprint: run.datasetFingerprint,
    policyVersion: run.policyVersion,
    generation: run.generation,
    status: run.status,
    startedAtMs: run.startedAtMs,
    completedAtMs: run.completedAtMs,
    registeredGameCount: run.registeredGameCount,
    referenceEventCount: run.referenceEventCount,
    observedEvents: run.observedEvents,
    correctnessErrors: run.correctnessErrors,
    freshnessBreaches: run.freshnessBreaches,
    missingGames: run.missingGames,
    identityMismatches: run.identityMismatches,
    homeAwayReversals: run.homeAwayReversals,
    scoreErrors: run.scoreErrors,
    finalStatusErrors: run.finalStatusErrors,
    maxIngestionDelayMs: run.maxIngestionDelayMs,
    maxApplicationDelayMs: run.maxApplicationDelayMs,
    explanation: run.explanation,
    coverageAttested: run.coverageAttested,
    coverageOverflowed: run.coverageOverflowed ?? false,
    findingsTruncated: run.findingsTruncated ?? false,
    findings: run.findings ?? [],
  };
}

export const listOperatorQualificationRuns = query({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    await operatorActor(ctx);
    if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 200) {
      throw new Error("Qualification run limit must be 1-200");
    }
    const rows = await ctx.db
      .query("operatorAuditEvents")
      .withIndex("by_atMs")
      .order("desc")
      .take(MAX_QUALIFICATION_AUDIT_SCAN);
    return rows
      .map(qualificationRunFromRow)
      .filter((run): run is QualificationRunRecord => run !== null)
      .slice(0, args.limit)
      .map(qualificationRunSummary);
  },
});

export const getOperatorQualificationRun = query({
  args: { runId: v.id("operatorAuditEvents") },
  handler: async (ctx, args) => {
    await operatorActor(ctx);
    const run = await getQualificationRun(ctx, args.runId);
    if (!run) return null;
    const [gate, season, latest] = await Promise.all([
      ctx.db
        .query("syncGate")
        .withIndex("by_key", (q) => q.eq("key", "deployment"))
        .unique(),
      ctx.db.get(run.seasonId),
      latestRun(ctx, run.seasonId),
    ]);
    const receipt = await currentProductionQualificationReceipt(ctx, gate);
    const isCurrentDecision =
      latest?._id === run._id &&
      run.status === "passed" &&
      season !== null &&
      run.datasetFingerprint === datasetFingerprint(season) &&
      run.policyVersion === PROVIDER_QUALIFICATION_POLICY_VERSION;
    return {
      run: qualificationRunSummary(run),
      games: run.games,
      references: run.events.filter(
        (event) => event.eventType === "reference",
      ),
      providerEvents: run.events.filter(
        (event) => event.eventType === "provider",
      ),
      candidateRejections: run.candidateRejections ?? [],
      findings: run.findings ?? [],
      isCurrentDecision,
      productionSyncEnabled:
        isCurrentDecision &&
        gate?.enabled === true &&
        receipt?.qualificationRunId === run._id,
    };
  },
});
