import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import {
  providerDiagnosticExpiry,
  providerDiagnosticFingerprint,
  PROVIDER_DIAGNOSTIC_RETENTION_MS,
  sanitizeProviderStatus,
  sanitizeRequestMetadata,
  sha256Fingerprint,
  type ProviderResponseSummary,
} from "./lib/providerEvidencePolicy";
import {
  env,
  internalMutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { requireProductionOperatorIdentity } from "./lib/operatorAuth";

const lifecycleValidator = v.union(
  v.literal("scheduled"),
  v.literal("in_progress"),
  v.literal("interrupted"),
  v.literal("postponed"),
  v.literal("canceled"),
  v.literal("terminal"),
  v.literal("unknown"),
);

const resultAuthorityValidator = v.union(
  v.literal("none"),
  v.literal("projected"),
  v.literal("verified"),
  v.literal("correction_candidate"),
);

const resultValidator = v.object({
  homeScore: v.number(),
  awayScore: v.number(),
  status: v.union(
    v.literal("FT"),
    v.literal("AOT"),
    v.literal("CANC"),
  ),
  observedAtMs: v.number(),
});

const evidenceStateValidator = v.object({
  scheduledKickoffMs: v.number(),
  kickoffLockReachedAtMs: v.union(v.number(), v.null()),
  lifecycle: lifecycleValidator,
  homeScore: v.union(v.number(), v.null()),
  awayScore: v.union(v.number(), v.null()),
  resultAuthority: resultAuthorityValidator,
  verifiedResult: v.union(resultValidator, v.null()),
  correctionCandidate: v.union(resultValidator, v.null()),
  pinned: v.boolean(),
});

export type ProviderGameEvidenceState =
  Doc<"providerGameEvidence">["after"];

const providerValidator = v.union(
  v.literal("api-sports"),
  v.literal("operator"),
);

const sourceValidator = v.union(
  v.literal("schedule"),
  v.literal("live"),
  v.literal("targeted"),
  v.literal("correction"),
  v.literal("override"),
);

const diagnosticSurfaceValidator = v.union(
  v.literal("bootstrap"),
  v.literal("schedule"),
  v.literal("live"),
  v.literal("correction"),
  v.literal("operator"),
);

const diagnosticOutcomeValidator = v.union(
  v.literal("success"),
  v.literal("http_error"),
  v.literal("rate_limited"),
  v.literal("transport_error"),
  v.literal("malformed"),
  v.literal("no_change"),
  v.literal("quarantined"),
);

const responseSummaryValidator = v.object({
  bodyBytes: v.number(),
  bodyDigest: v.string(),
  resultCount: v.union(v.number(), v.null()),
  pagingCurrent: v.union(v.number(), v.null()),
  pagingTotal: v.union(v.number(), v.null()),
});

const quotaValidator = v.object({
  dailyLimit: v.union(v.number(), v.null()),
  dailyRemaining: v.union(v.number(), v.null()),
  minuteLimit: v.union(v.number(), v.null()),
  minuteRemaining: v.union(v.number(), v.null()),
});

const CHANGED_FIELDS = [
  "scheduledKickoffMs",
  "kickoffLockReachedAtMs",
  "lifecycle",
  "homeScore",
  "awayScore",
  "resultAuthority",
  "verifiedResult",
  "correctionCandidate",
  "pinned",
] as const;

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function changedFields(
  before: ProviderGameEvidenceState | null,
  after: ProviderGameEvidenceState,
): string[] {
  if (before === null) return [...CHANGED_FIELDS];
  return CHANGED_FIELDS.filter(
    (field) => {
      if (
        field === "verifiedResult" ||
        field === "correctionCandidate"
      ) {
        const left = before[field];
        const right = after[field];
        return !sameValue(
          left
            ? {
                homeScore: left.homeScore,
                awayScore: left.awayScore,
                status: left.status,
              }
            : null,
          right
            ? {
                homeScore: right.homeScore,
                awayScore: right.awayScore,
                status: right.status,
              }
            : null,
        );
      }
      return !sameValue(before[field], after[field]);
    },
  );
}

function transitionKind(
  before: ProviderGameEvidenceState | null,
  after: ProviderGameEvidenceState,
  changed: readonly string[],
): Doc<"providerGameEvidence">["transitionKind"] {
  if (changed.includes("pinned")) return "override";
  if (
    changed.includes("correctionCandidate") ||
    (changed.includes("verifiedResult") &&
      before?.verifiedResult !== null &&
      before?.verifiedResult !== undefined)
  ) {
    return "correction";
  }
  if (
    changed.includes("verifiedResult") ||
    (after.resultAuthority === "verified" &&
      before?.resultAuthority !== "verified")
  ) {
    return "terminal";
  }
  if (changed.includes("scheduledKickoffMs")) return "kickoff";
  if (changed.includes("kickoffLockReachedAtMs")) {
    return "kickoff_lock";
  }
  if (changed.includes("lifecycle")) return "lifecycle";
  return "score";
}

function safeExternalId(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  return /^[A-Za-z0-9:_-]{1,80}$/.test(normalized)
    ? normalized
    : undefined;
}

async function evidenceFingerprint(input: {
  gameStableKey: string;
  provider: string;
  source: string;
  kind: string;
  observedAtMs: number;
  after: ProviderGameEvidenceState;
}): Promise<string> {
  // Every component is a server-owned normalized fact, never raw provider data.
  return await sha256Fingerprint(JSON.stringify([
    input.gameStableKey,
    input.provider,
    input.source,
    input.kind,
    input.observedAtMs,
    input.after,
  ]));
}

export function providerEvidenceState(
  game: Doc<"nflGames">,
): ProviderGameEvidenceState {
  return {
    scheduledKickoffMs: game.scheduledKickoffMs,
    kickoffLockReachedAtMs: game.kickoffLockReachedAtMs ?? null,
    lifecycle: game.lifecycle,
    homeScore: game.homeScore,
    awayScore: game.awayScore,
    resultAuthority: game.resultAuthority ?? "none",
    verifiedResult: game.verifiedResult
      ? {
          homeScore: game.verifiedResult.homeScore,
          awayScore: game.verifiedResult.awayScore,
          status: game.verifiedResult.status,
          observedAtMs: game.verifiedResult.verifiedAtMs,
        }
      : null,
    correctionCandidate: game.correctionCandidate
      ? {
          homeScore: game.correctionCandidate.homeScore,
          awayScore: game.correctionCandidate.awayScore,
          status: game.correctionCandidate.status,
          observedAtMs: game.correctionCandidate.observedAtMs,
        }
      : null,
    pinned: game.pinnedResultOverrideId !== undefined,
  };
}

export async function recordProviderGameTransition(
  ctx: MutationCtx,
  input: {
    gameId: Id<"nflGames">;
    provider: "api-sports" | "operator";
    externalId?: string;
    source:
      | "schedule"
      | "live"
      | "targeted"
      | "correction"
      | "override";
    incidentId?: Id<"operatorIncidents">;
    observedAtMs: number;
    before: ProviderGameEvidenceState | null;
    after: ProviderGameEvidenceState;
  },
): Promise<
  | { recorded: false }
  | { recorded: true; evidenceId: Id<"providerGameEvidence"> }
> {
  const changed = changedFields(input.before, input.after);
  if (changed.length === 0) return { recorded: false };

  const game = await ctx.db.get(input.gameId);
  if (!game) return { recorded: false };
  const [homeTeam, awayTeam] = await Promise.all([
    ctx.db.get(game.homeTeamId),
    ctx.db.get(game.awayTeamId),
  ]);
  if (!homeTeam || !awayTeam) return { recorded: false };

  const kind = transitionKind(input.before, input.after, changed);
  const fingerprint = await evidenceFingerprint({
    gameStableKey: game.stableKey,
    provider: input.provider,
    source: input.source,
    kind,
    observedAtMs: input.observedAtMs,
    after: input.after,
  });
  const duplicate = await ctx.db
    .query("providerGameEvidence")
    .withIndex("by_fingerprint", (q) =>
      q.eq("fingerprint", fingerprint),
    )
    .unique();
  if (duplicate) return { recorded: false };
  const evidenceId = await ctx.db.insert("providerGameEvidence", {
    nflGameId: game._id,
    incidentId: input.incidentId,
    gameStableKey: game.stableKey,
    seasonLabel: game.seasonLabel,
    gameWeek: game.week,
    homeTeamAbbreviation: homeTeam.abbreviation,
    awayTeamAbbreviation: awayTeam.abbreviation,
    provider: input.provider,
    externalId: safeExternalId(input.externalId),
    source: input.source,
    transitionKind: kind,
    changedFields: changed,
    before: input.before,
    after: input.after,
    fingerprint,
    observedAtMs: input.observedAtMs,
    recordedAtMs: Date.now(),
  });
  return { recorded: true, evidenceId };
}

/** Deterministic write seam exercised by retention tests. */
export const recordGameTransitionForTest = internalMutation({
  args: {
    gameId: v.id("nflGames"),
    provider: providerValidator,
    externalId: v.optional(v.string()),
    source: sourceValidator,
    incidentId: v.optional(v.id("operatorIncidents")),
    observedAtMs: v.number(),
    before: v.union(evidenceStateValidator, v.null()),
    after: evidenceStateValidator,
  },
  handler: (ctx, args) =>
    recordProviderGameTransition(ctx, {
      ...args,
      provider: args.provider as "api-sports" | "operator",
      source: args.source as
        | "schedule"
        | "live"
        | "targeted"
        | "correction"
        | "override",
      before: args.before as ProviderGameEvidenceState | null,
      after: args.after as ProviderGameEvidenceState,
    }),
});

function safeScopeKey(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  return /^[A-Za-z0-9:_-]{1,180}$/.test(normalized)
    ? normalized
    : undefined;
}

function safeNonNegativeInteger(
  value: number | null | undefined,
): number | undefined {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
    ? value
    : undefined;
}

/**
 * One server-sanitized physical-request or per-game no-op diagnostic. The
 * fingerprint excludes observation time so identical polls compact naturally.
 */
export const recordApiSportsDiagnostic = internalMutation({
  args: {
    surface: diagnosticSurfaceValidator,
    scopeKey: v.optional(v.string()),
    incidentId: v.optional(v.id("operatorIncidents")),
    gameId: v.optional(v.id("nflGames")),
    endpoint: v.string(),
    parameters: v.record(
      v.string(),
      v.union(v.string(), v.number()),
    ),
    outcome: diagnosticOutcomeValidator,
    httpStatus: v.optional(v.number()),
    responseSummary: v.optional(responseSummaryValidator),
    quota: v.optional(quotaValidator),
    providerStatus: v.optional(
      v.object({
        short: v.string(),
        long: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const recordedAtMs = Date.now();
    const request = sanitizeRequestMetadata({
      endpoint: args.endpoint,
      parameters: args.parameters,
    });
    const game = args.gameId
      ? await ctx.db.get(args.gameId)
      : null;
    const responseFingerprint =
      args.responseSummary &&
      /^[0-9a-f]{64}$/i.test(args.responseSummary.bodyDigest)
        ? args.responseSummary.bodyDigest.toLowerCase()
        : null;
    const providerStatus = args.providerStatus
      ? await sanitizeProviderStatus(args.providerStatus)
      : null;
    const scopeKey = safeScopeKey(args.scopeKey);
    const fingerprint = await providerDiagnosticFingerprint({
      provider: "api-sports",
      surface: args.surface,
      scopeKey: scopeKey ?? null,
      incidentId: args.incidentId
        ? String(args.incidentId)
        : null,
      gameId: args.gameId ? String(args.gameId) : null,
      request,
      outcome: args.outcome,
      httpStatus: safeNonNegativeInteger(args.httpStatus) ?? null,
      responseDigest:
        responseFingerprint ?? providerStatus?.fingerprint ?? null,
    });
    const existing = await ctx.db
      .query("providerRequestDiagnostics")
      .withIndex("by_fingerprint", (q) =>
        q.eq("fingerprint", fingerprint),
      )
      .unique();
    const expiresAtMs = providerDiagnosticExpiry(recordedAtMs);
    const summary = args.responseSummary as
      | Pick<
          ProviderResponseSummary,
          | "bodyBytes"
          | "bodyDigest"
          | "resultCount"
          | "pagingCurrent"
          | "pagingTotal"
        >
      | undefined;
    if (existing) {
      const startsNewRetentionBucket =
        existing.expiresAtMs <= recordedAtMs;
      await ctx.db.patch(existing._id, {
        httpStatus: safeNonNegativeInteger(args.httpStatus),
        bodyBytes: safeNonNegativeInteger(summary?.bodyBytes),
        responseFingerprint: responseFingerprint ?? undefined,
        resultCount: safeNonNegativeInteger(summary?.resultCount),
        pagingCurrent: safeNonNegativeInteger(
          summary?.pagingCurrent,
        ),
        pagingTotal: safeNonNegativeInteger(
          summary?.pagingTotal,
        ),
        quotaDailyLimit: safeNonNegativeInteger(
          args.quota?.dailyLimit,
        ),
        quotaDailyRemaining: safeNonNegativeInteger(
          args.quota?.dailyRemaining,
        ),
        quotaMinuteLimit: safeNonNegativeInteger(
          args.quota?.minuteLimit,
        ),
        quotaMinuteRemaining: safeNonNegativeInteger(
          args.quota?.minuteRemaining,
        ),
        statusShortPreview:
          providerStatus?.shortPreview ?? undefined,
        statusLongPreview:
          providerStatus?.longPreview ?? undefined,
        statusFingerprint: providerStatus?.fingerprint,
        statusRedacted: providerStatus?.redacted,
        firstRecordedAtMs: startsNewRetentionBucket
          ? recordedAtMs
          : existing.firstRecordedAtMs,
        lastRecordedAtMs: recordedAtMs,
        observationCount: startsNewRetentionBucket
          ? 1
          : existing.observationCount + 1,
        expiresAtMs: startsNewRetentionBucket
          ? expiresAtMs
          : existing.expiresAtMs,
      });
      return {
        diagnosticId: existing._id,
        coalesced: true as const,
      };
    }
    const parameters = request.parameters;
    const diagnosticId = await ctx.db.insert(
      "providerRequestDiagnostics",
      {
        fingerprint,
        provider: "api-sports",
        surface: args.surface,
        scopeKey,
        incidentId: args.incidentId,
        nflGameId: args.gameId,
        gameStableKey: game?.stableKey,
        endpoint: request.endpoint as
          | "/games"
          | "/teams"
          | "/status"
          | "/unknown",
        requestLeague: safeNonNegativeInteger(
          parameters.league as number | undefined,
        ),
        requestSeason: safeNonNegativeInteger(
          parameters.season as number | undefined,
        ),
        requestPage: safeNonNegativeInteger(
          parameters.page as number | undefined,
        ),
        requestDate:
          typeof parameters.date === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(parameters.date)
            ? parameters.date
            : undefined,
        requestLive:
          parameters.live === "all" ? "all" : undefined,
        requestExternalId: safeExternalId(
          typeof parameters.id === "string"
            ? parameters.id
            : parameters.id === undefined
              ? undefined
              : String(parameters.id),
        ),
        statusShortPreview:
          providerStatus?.shortPreview ?? undefined,
        statusLongPreview:
          providerStatus?.longPreview ?? undefined,
        statusFingerprint: providerStatus?.fingerprint,
        statusRedacted: providerStatus?.redacted,
        outcome: args.outcome,
        httpStatus: safeNonNegativeInteger(args.httpStatus),
        bodyBytes: safeNonNegativeInteger(summary?.bodyBytes),
        responseFingerprint: responseFingerprint ?? undefined,
        resultCount: safeNonNegativeInteger(summary?.resultCount),
        pagingCurrent: safeNonNegativeInteger(
          summary?.pagingCurrent,
        ),
        pagingTotal: safeNonNegativeInteger(summary?.pagingTotal),
        quotaDailyLimit: safeNonNegativeInteger(
          args.quota?.dailyLimit,
        ),
        quotaDailyRemaining: safeNonNegativeInteger(
          args.quota?.dailyRemaining,
        ),
        quotaMinuteLimit: safeNonNegativeInteger(
          args.quota?.minuteLimit,
        ),
        quotaMinuteRemaining: safeNonNegativeInteger(
          args.quota?.minuteRemaining,
        ),
        firstRecordedAtMs: recordedAtMs,
        lastRecordedAtMs: recordedAtMs,
        observationCount: 1,
        expiresAtMs,
        retentionClass: "diagnostic_30d",
      },
    );
    return { diagnosticId, coalesced: false as const };
  },
});

type CleanupResult = Readonly<{
  generation: number;
  cutoffMs: number;
  deleted: number;
  deletedTotal: number;
  status: "running" | "complete" | "stale";
  continuationScheduled: boolean;
}>;

const CLEANUP_KEY = "provider-diagnostics" as const;
const MAX_CLEANUP_BATCH = 100;

/**
 * Delete one oldest-first diagnostics batch. Each continuation re-queries the
 * head under the original cutoff, so deletes and interrupted invocations
 * cannot make a persistent cursor skip evidence.
 */
export const cleanupExpiredDiagnostics = internalMutation({
  args: {
    cutoffMs: v.optional(v.number()),
    batchSize: v.optional(v.number()),
    generation: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<CleanupResult> => {
    const invokedAtMs = Date.now();
    const requestedCutoff =
      args.cutoffMs !== undefined &&
      Number.isFinite(args.cutoffMs) &&
      args.cutoffMs >= 0
        ? args.cutoffMs
        : invokedAtMs;
    const batchSize = Math.max(
      1,
      Math.min(
        MAX_CLEANUP_BATCH,
        Number.isSafeInteger(args.batchSize)
          ? args.batchSize!
          : MAX_CLEANUP_BATCH,
      ),
    );
    let run = await ctx.db
      .query("providerDiagnosticCleanupRuns")
      .withIndex("by_key", (q) => q.eq("key", CLEANUP_KEY))
      .unique();

    if (
      args.generation !== undefined &&
      run !== null &&
      args.generation !== run.generation
    ) {
      return {
        generation: run.generation,
        cutoffMs: run.cutoffMs,
        deleted: 0,
        deletedTotal: run.deletedCount,
        status: "stale",
        continuationScheduled: false,
      };
    }

    if (run?.status === "complete") {
      if (requestedCutoff <= run.cutoffMs) {
        return {
          generation: run.generation,
          cutoffMs: run.cutoffMs,
          deleted: 0,
          deletedTotal: run.deletedCount,
          status: "complete",
          continuationScheduled: false,
        };
      }
      await ctx.db.patch(run._id, {
        generation: run.generation + 1,
        cutoffMs: requestedCutoff,
        status: "running",
        deletedCount: 0,
        batchesCompleted: 0,
        startedAtMs: invokedAtMs,
        updatedAtMs: invokedAtMs,
        completedAtMs: undefined,
      });
      run = (await ctx.db.get(run._id))!;
    } else if (run === null) {
      const runId = await ctx.db.insert(
        "providerDiagnosticCleanupRuns",
        {
          key: CLEANUP_KEY,
          generation: 1,
          cutoffMs: requestedCutoff,
          status: "running",
          deletedCount: 0,
          batchesCompleted: 0,
          startedAtMs: invokedAtMs,
          updatedAtMs: invokedAtMs,
        },
      );
      run = (await ctx.db.get(runId))!;
    }

    const rows = await ctx.db
      .query("providerRequestDiagnostics")
      .withIndex("by_expiresAtMs", (q) =>
        q.lte("expiresAtMs", run!.cutoffMs),
      )
      .take(batchSize);
    const eligible = rows.filter(
      (row) =>
        row.retentionClass === "diagnostic_30d" &&
        Number.isFinite(row.expiresAtMs) &&
        row.expiresAtMs <= run!.cutoffMs,
    );
    for (const row of eligible) {
      await ctx.db.delete(row._id);
    }
    let deleted = eligible.length;
    let remaining = batchSize - deleted;
    if (remaining > 0) {
      const claims = await ctx.db
        .query("providerFetchClaims")
        .withIndex("by_expiresAtMs", (q) =>
          q
            .gte("expiresAtMs", 0)
            .lte("expiresAtMs", run!.cutoffMs),
        )
        .take(remaining);
      for (const row of claims) {
        if (
          row.expiresAtMs !== undefined &&
          Number.isFinite(row.expiresAtMs) &&
          row.expiresAtMs <= run.cutoffMs
        ) {
          await ctx.db.delete(row._id);
          deleted += 1;
          remaining -= 1;
        }
      }
    }
    if (remaining > 0) {
      const exceptions = await ctx.db
        .query("providerExceptions")
        .withIndex("by_expiresAtMs", (q) =>
          q
            .gte("expiresAtMs", 0)
            .lte("expiresAtMs", run!.cutoffMs),
        )
        .take(remaining);
      for (const row of exceptions) {
        if (
          row.expiresAtMs !== undefined &&
          Number.isFinite(row.expiresAtMs) &&
          row.expiresAtMs <= run.cutoffMs
        ) {
          await ctx.db.delete(row._id);
          deleted += 1;
          remaining -= 1;
        }
      }
    }
    if (remaining > 0) {
      const statuses = await ctx.db
        .query("sportsDataStatusEvidence")
        .withIndex("by_expiresAtMs", (q) =>
          q
            .gte("expiresAtMs", 0)
            .lte("expiresAtMs", run!.cutoffMs),
        )
        .take(remaining);
      for (const row of statuses) {
        if (
          row.expiresAtMs !== undefined &&
          Number.isFinite(row.expiresAtMs) &&
          row.expiresAtMs <= run.cutoffMs
        ) {
          await ctx.db.delete(row._id);
          deleted += 1;
          remaining -= 1;
        }
      }
    }
    const legacyObservedCutoffMs =
      run.cutoffMs - PROVIDER_DIAGNOSTIC_RETENTION_MS;
    if (remaining > 0 && legacyObservedCutoffMs >= 0) {
      const claims = await ctx.db
        .query("providerFetchClaims")
        .withIndex("by_claimedAtMs", (q) =>
          q.lte("claimedAtMs", legacyObservedCutoffMs),
        )
        .take(remaining);
      for (const row of claims) {
        if (row.expiresAtMs === undefined) {
          await ctx.db.delete(row._id);
          deleted += 1;
          remaining -= 1;
        }
      }
    }
    if (remaining > 0 && legacyObservedCutoffMs >= 0) {
      const exceptions = await ctx.db
        .query("providerExceptions")
        .withIndex("by_createdAtMs", (q) =>
          q.lte("createdAtMs", legacyObservedCutoffMs),
        )
        .take(remaining);
      for (const row of exceptions) {
        if (row.expiresAtMs === undefined) {
          await ctx.db.delete(row._id);
          deleted += 1;
          remaining -= 1;
        }
      }
    }
    if (remaining > 0 && legacyObservedCutoffMs >= 0) {
      const statuses = await ctx.db
        .query("sportsDataStatusEvidence")
        .withIndex("by_lastObservedAtMs", (q) =>
          q.lte("lastObservedAtMs", legacyObservedCutoffMs),
        )
        .take(remaining);
      for (const row of statuses) {
        if (row.expiresAtMs === undefined) {
          await ctx.db.delete(row._id);
          deleted += 1;
          remaining -= 1;
        }
      }
    }
    const deletedTotal = run.deletedCount + deleted;
    const continuationScheduled = deleted === batchSize;
    const status = continuationScheduled
      ? ("running" as const)
      : ("complete" as const);
    await ctx.db.patch(run._id, {
      status,
      deletedCount: deletedTotal,
      batchesCompleted: run.batchesCompleted + 1,
      updatedAtMs: invokedAtMs,
      completedAtMs:
        status === "complete" ? invokedAtMs : undefined,
    });
    if (continuationScheduled) {
      await ctx.scheduler.runAfter(
        0,
        internal.providerEvidence.cleanupExpiredDiagnostics,
        {
          cutoffMs: run.cutoffMs,
          batchSize,
          generation: run.generation,
        },
      );
    }
    return {
      generation: run.generation,
      cutoffMs: run.cutoffMs,
      deleted,
      deletedTotal,
      status,
      continuationScheduled,
    };
  },
});

function inspectionLimit(value: number | undefined): number {
  return Math.max(
    1,
    Math.min(
      100,
      Number.isSafeInteger(value) ? value! : 50,
    ),
  );
}

function safeDiagnostic(row: Doc<"providerRequestDiagnostics">) {
  return {
    _id: row._id,
    provider: row.provider,
    surface: row.surface,
    scopeKey: row.scopeKey ?? null,
    gameStableKey: row.gameStableKey ?? null,
    endpoint: row.endpoint,
    request: {
      league: row.requestLeague ?? null,
      season: row.requestSeason ?? null,
      page: row.requestPage ?? null,
      date: row.requestDate ?? null,
      live: row.requestLive ?? null,
      externalId: row.requestExternalId ?? null,
    },
    providerStatus: {
      short: row.statusShortPreview ?? null,
      long: row.statusLongPreview ?? null,
      fingerprint: row.statusFingerprint ?? null,
      redacted: row.statusRedacted ?? false,
    },
    outcome: row.outcome,
    httpStatus: row.httpStatus ?? null,
    response: {
      bodyBytes: row.bodyBytes ?? null,
      fingerprint: row.responseFingerprint ?? null,
      resultCount: row.resultCount ?? null,
      pagingCurrent: row.pagingCurrent ?? null,
      pagingTotal: row.pagingTotal ?? null,
    },
    quota: {
      dailyLimit: row.quotaDailyLimit ?? null,
      dailyRemaining: row.quotaDailyRemaining ?? null,
      minuteLimit: row.quotaMinuteLimit ?? null,
      minuteRemaining: row.quotaMinuteRemaining ?? null,
    },
    firstRecordedAtMs: row.firstRecordedAtMs,
    lastRecordedAtMs: row.lastRecordedAtMs,
    observationCount: row.observationCount,
    expiresAtMs: row.expiresAtMs,
  };
}

function safePermanent(row: Doc<"providerGameEvidence">) {
  return {
    _id: row._id,
    gameStableKey: row.gameStableKey,
    seasonLabel: row.seasonLabel,
    gameWeek: row.gameWeek,
    homeTeamAbbreviation: row.homeTeamAbbreviation,
    awayTeamAbbreviation: row.awayTeamAbbreviation,
    provider: row.provider,
    externalId: row.externalId ?? null,
    source: row.source,
    transitionKind: row.transitionKind,
    changedFields: row.changedFields,
    before: row.before,
    after: row.after,
    observedAtMs: row.observedAtMs,
    recordedAtMs: row.recordedAtMs,
  };
}

export const listOperatorGameEvidence = query({
  args: {
    gameId: v.optional(v.id("nflGames")),
    gameStableKey: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireProductionOperatorIdentity(ctx, env);
    if (
      (args.gameId === undefined) ===
      (args.gameStableKey === undefined)
    ) {
      throw new Error(
        "Provide exactly one NFL Game ID or stable game key",
      );
    }
    const stableKey =
      args.gameStableKey === undefined
        ? undefined
        : args.gameStableKey.trim();
    if (
      stableKey !== undefined &&
      !/^[A-Za-z0-9:@._-]{1,180}$/.test(stableKey)
    ) {
      throw new Error("Invalid stable game key");
    }
    const game =
      args.gameId !== undefined
        ? await ctx.db.get(args.gameId)
        : await ctx.db
            .query("nflGames")
            .withIndex("by_stableKey", (q) =>
              q.eq("stableKey", stableKey!),
            )
            .unique();
    if (!game && stableKey === undefined) {
      throw new Error("NFL Game not found");
    }
    const resolvedStableKey = game?.stableKey ?? stableKey!;
    const limit = inspectionLimit(args.limit);
    const [
      permanent,
      diagnostics,
      scheduleHistory,
      resultHistory,
      reconciliation,
      rawStatus,
      overrides,
    ] = await Promise.all([
      ctx.db
        .query("providerGameEvidence")
        .withIndex(
          "by_gameStableKey_and_recordedAtMs",
          (q) => q.eq("gameStableKey", resolvedStableKey),
        )
        .order("desc")
        .take(limit),
      ctx.db
        .query("providerRequestDiagnostics")
        .withIndex(
          "by_gameStableKey_and_lastRecordedAtMs",
          (q) => q.eq("gameStableKey", resolvedStableKey),
        )
        .order("desc")
        .take(limit),
      game
        ? ctx.db
            .query("nflGameScheduleHistory")
            .withIndex(
              "by_nflGameId_and_scheduledKickoffMs",
              (q) => q.eq("nflGameId", game._id),
            )
            .order("desc")
            .take(limit)
        : Promise.resolve([]),
      game
        ? ctx.db
            .query("nflGameResultHistory")
            .withIndex(
              "by_nflGameId_and_supersededAtMs",
              (q) => q.eq("nflGameId", game._id),
            )
            .order("desc")
            .take(limit)
        : Promise.resolve([]),
      game
        ? ctx.db
            .query("nflGameResultReconciliationObservations")
            .withIndex(
              "by_nflGameId_and_observedAtMs",
              (q) => q.eq("nflGameId", game._id),
            )
            .order("desc")
            .take(limit)
        : Promise.resolve([]),
      game
        ? ctx.db
            .query("sportsDataStatusEvidence")
            .withIndex(
              "by_nflGameId_and_lastObservedAtMs",
              (q) => q.eq("nflGameId", game._id),
            )
            .order("desc")
            .take(limit)
        : Promise.resolve([]),
      ctx.db
        .query("nflGameResultOverrides")
        .withIndex(
          "by_gameStableKey_and_pinnedAtMs",
          (q) => q.eq("gameStableKey", resolvedStableKey),
        )
        .order("desc")
        .take(limit),
    ]);
    const overrideEvidence = (
      await Promise.all(
        overrides.slice(0, 20).map((override) =>
          ctx.db
            .query("nflGameResultOverrideEvidence")
            .withIndex(
              "by_overrideId_and_disposition_and_observedAtMs",
              (q) => q.eq("overrideId", override._id),
            )
            .order("desc")
            .take(limit),
        ),
      )
    ).flat();
    if (!game && permanent.length === 0 && diagnostics.length === 0) {
      return null;
    }
    const historicalIdentity = permanent[0];
    return {
      game: {
        stableKey: resolvedStableKey,
        seasonLabel:
          game?.seasonLabel ?? historicalIdentity?.seasonLabel ?? null,
        week: game?.week ?? historicalIdentity?.gameWeek ?? null,
      },
      permanent: permanent.map(safePermanent),
      diagnostics: diagnostics.map(safeDiagnostic),
      related: {
        scheduleHistory,
        resultHistory,
        reconciliation,
        rawStatus: rawStatus.map((row) => ({
          provider: row.provider,
          recognized: row.recognized,
          firstObservedAtMs: row.firstObservedAtMs,
          lastObservedAtMs: row.lastObservedAtMs,
          observationCount: row.observationCount,
        })),
        overrides: overrides.map((row) => ({
          _id: row._id,
          status: row.status,
          pinnedAtMs: row.pinnedAtMs,
          releasedAtMs: row.releasedAtMs ?? null,
          replacedResult: row.replacedResult,
          overrideResult: row.overrideResult,
        })),
        overrideEvidence,
      },
    };
  },
});

export const listOperatorIncidentEvidence = query({
  args: {
    incidentId: v.id("operatorIncidents"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireProductionOperatorIdentity(ctx, env);
    const incident = await ctx.db.get(args.incidentId);
    if (!incident) throw new Error("Operator Incident not found");
    const limit = inspectionLimit(args.limit);
    const surface =
      incident.surface === "league_live"
        ? "live"
        : incident.surface;
    const diagnosticSurface =
      surface === "bootstrap" ||
      surface === "schedule" ||
      surface === "live" ||
      surface === "correction" ||
      surface === "operator"
        ? surface
        : null;
    const [permanent, linkedDiagnostics] = await Promise.all([
      ctx.db
        .query("providerGameEvidence")
        .withIndex(
          "by_incidentId_and_recordedAtMs",
          (q) => q.eq("incidentId", incident._id),
        )
        .order("desc")
        .take(limit),
      ctx.db
        .query("providerRequestDiagnostics")
        .withIndex(
          "by_incidentId_and_lastRecordedAtMs",
          (q) => q.eq("incidentId", incident._id),
        )
        .order("desc")
        .take(limit),
    ]);
    const exactDiagnostics = diagnosticSurface
      ? await ctx.db
          .query("providerRequestDiagnostics")
          .withIndex(
            "by_surface_and_scopeKey_and_lastRecordedAtMs",
            (q) =>
              q
                .eq("surface", diagnosticSurface)
                .eq("scopeKey", incident.scopeKey),
          )
          .order("desc")
          .take(limit)
      : [];
    const gameIdText =
      incident.scopeKey.match(
        /^(?:game|recovery|correction):([^:]+)/,
      )?.[1] ?? null;
    const correlatedGameId = gameIdText
      ? ctx.db.normalizeId("nflGames", gameIdText)
      : null;
    const correlatedSurface =
      incident.scopeKey.startsWith("correction:")
        ? ("correction" as const)
        : diagnosticSurface;
    const gameDiagnostics =
      correlatedGameId && correlatedSurface
      ? await ctx.db
          .query("providerRequestDiagnostics")
          .withIndex(
            "by_nflGameId_and_surface_and_lastRecordedAtMs",
            (q) =>
              q
                .eq("nflGameId", correlatedGameId)
                .eq("surface", correlatedSurface),
          )
          .order("desc")
          .take(limit)
      : [];
    const seasonIdText =
      incident.scopeKey.match(/^season:([^:]+):/)?.[1] ?? null;
    const derivedScopeKey =
      incident.scopeKey === "malformed-live-slate-row"
        ? "live:nfl"
        : seasonIdText
          ? `schedule:${seasonIdText}`
          : null;
    const derivedScopeDiagnostics =
      derivedScopeKey && diagnosticSurface
        ? await ctx.db
            .query("providerRequestDiagnostics")
            .withIndex(
              "by_surface_and_scopeKey_and_lastRecordedAtMs",
              (q) =>
                q
                  .eq("surface", diagnosticSurface)
                  .eq("scopeKey", derivedScopeKey),
            )
            .order("desc")
            .take(limit)
        : [];
    const diagnostics =
      linkedDiagnostics.length > 0
        ? linkedDiagnostics
        : [
            ...gameDiagnostics,
            ...derivedScopeDiagnostics,
            ...exactDiagnostics,
          ]
            .filter(
              (row, index, rows) =>
                rows.findIndex(
                  (candidate) => candidate._id === row._id,
                ) === index,
            )
            .sort(
              (left, right) =>
                right.lastRecordedAtMs -
                left.lastRecordedAtMs,
            )
            .slice(0, limit);
    return {
      incident: {
        _id: incident._id,
        type: incident.type,
        status: incident.status,
        surface: incident.surface,
        scopeKey: incident.scopeKey,
        openedAtMs: incident.openedAtMs,
        resolvedAtMs: incident.resolvedAtMs ?? null,
      },
      permanent: permanent.map(safePermanent),
      diagnostics: diagnostics.map(safeDiagnostic),
    };
  },
});

/**
 * The read surface is implemented below alongside request diagnostics. Keeping
 * the auth guard here prevents Pool roles from ever becoming an alternate path.
 */
export const canInspectProviderEvidence = query({
  args: {},
  handler: async (ctx) => {
    await requireProductionOperatorIdentity(ctx, env);
    return { allowed: true as const };
  },
});
