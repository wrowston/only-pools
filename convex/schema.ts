import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const nflGameLifecycle = v.union(
  v.literal("scheduled"),
  v.literal("in_progress"),
  v.literal("interrupted"),
  v.literal("postponed"),
  v.literal("canceled"),
  v.literal("terminal"),
  v.literal("unknown"),
);

const providerEvidenceTerminalStatus = v.union(
  v.literal("FT"),
  v.literal("AOT"),
  v.literal("CANC"),
);

const providerEvidenceResult = v.object({
  homeScore: v.number(),
  awayScore: v.number(),
  status: providerEvidenceTerminalStatus,
  observedAtMs: v.number(),
});

const providerGameEvidenceState = v.object({
  scheduledKickoffMs: v.number(),
  kickoffLockReachedAtMs: v.union(v.number(), v.null()),
  lifecycle: nflGameLifecycle,
  homeScore: v.union(v.number(), v.null()),
  awayScore: v.union(v.number(), v.null()),
  // Permanent evidence preserves the authority value observed at write time.
  // Runtime writers enforce the current authority union at their boundary.
  resultAuthority: v.string(),
  verifiedResult: v.union(providerEvidenceResult, v.null()),
  correctionCandidate: v.union(providerEvidenceResult, v.null()),
  pinned: v.boolean(),
});

const poolType = v.union(v.literal("survivor"), v.literal("confidence"));
const pickLockMode = v.union(
  v.literal("gameKickoff"),
  v.literal("weeklyCutoff"),
);
const membershipRole = v.union(
  v.literal("owner"),
  v.literal("admin"),
  v.literal("member"),
);

/**
 * MVP schema through ticket 04 — Participant identity, Season Bootstrap,
 * NFL Teams / Games, Sync Gate, Active Pools, Pool Memberships, and Pool Invites.
 */
export default defineSchema({
  participants: defineTable({
    /** Canonical Clerk-linked identity key: issuer|subject via tokenIdentifier. */
    tokenIdentifier: v.string(),
    /** Clerk `sub` for dashboard / ops convenience. Never trust client-supplied ids. */
    clerkUserId: v.string(),
    displayName: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    emailVerified: v.boolean(),
    phoneVerified: v.boolean(),
    ageConfirmed: v.boolean(),
    /** Stub for Suspended Participant; enforced in auth helpers. */
    suspended: v.boolean(),
    avatarUrl: v.optional(v.string()),
    /**
     * Clerk session id (`sid`) from the last fully verified establish.
     * Same session → mid-session contact lapse does not interrupt access.
     * New session → email + phone must both be verified again.
     */
    lastClerkSessionId: v.optional(v.string()),
    /**
     * MVP local Step-up Verification marker. Production should use Clerk
     * second factor; tests call confirmStepUp in setup. Short TTL enforced
     * in invite retrieve/rotate helpers.
     */
    stepUpVerifiedAtMs: v.optional(v.number()),
    /** Clerk-verified Production Operator reverification marker. */
    operatorStepUpVerifiedAtMs: v.optional(v.number()),
    /** Marker is valid only for this exact authenticated Clerk session. */
    operatorStepUpSessionId: v.optional(v.string()),
  })
    .index("by_tokenIdentifier", ["tokenIdentifier"])
    .index("by_clerkUserId", ["clerkUserId"]),

  /**
   * Pool Season rows. Create Pool stays disabled until status is "available"
   * (Season Bootstrap succeeded with a usable Start Week slate).
   */
  poolSeasons: defineTable({
    label: v.string(),
    year: v.number(),
    status: v.union(v.literal("bootstrapping"), v.literal("available")),
    /** Absent on legacy rows and interpreted as regular season. */
    competitionPhase: v.optional(
      v.union(v.literal("regular_season"), v.literal("preseason")),
    ),
    usableStartWeek: v.optional(v.number()),
    bootstrappedAtMs: v.optional(v.number()),
  })
    .index("by_status", ["status"])
    .index("by_label", ["label"]),

  /** Provider-independent NFL Team identity. Provider ids live in aliases. */
  nflTeams: defineTable({
    stableKey: v.string(),
    name: v.string(),
    abbreviation: v.string(),
    logoUrl: v.optional(v.string()),
  }).index("by_stableKey", ["stableKey"]),

  /** Provider-independent NFL Game identity for a Pool Season. */
  nflGames: defineTable({
    stableKey: v.string(),
    seasonId: v.id("poolSeasons"),
    seasonLabel: v.string(),
    week: v.number(),
    homeTeamId: v.id("nflTeams"),
    awayTeamId: v.id("nflTeams"),
    scheduledKickoffMs: v.number(),
    lifecycle: nflGameLifecycle,
    /**
     * Latched when Game Kickoff Lock first reaches — postponement/reschedule
     * never clears this (scenario 25).
     */
    kickoffLockReachedAtMs: v.optional(v.number()),
    /** Last observed / projected scores — never official until verified. */
    homeScore: v.union(v.number(), v.null()),
    awayScore: v.union(v.number(), v.null()),
    /**
     * Result authority. Absent / "none" until live or terminal evidence arrives.
     * A coherent terminal provider observation is immediately verified.
     */
    resultAuthority: v.optional(
      v.union(
        v.literal("none"),
        v.literal("projected"),
        v.literal("verified"),
        v.literal("correction_candidate"),
      ),
    ),
    verifiedResult: v.optional(
      v.object({
        homeScore: v.number(),
        awayScore: v.number(),
        verifiedAtMs: v.number(),
        status: v.union(
          v.literal("FT"),
          v.literal("AOT"),
          v.literal("CANC"),
        ),
      }),
    ),
    /**
     * Prior Verified Result superseded by a Corrected Result (audit history).
     */
    priorVerifiedResult: v.optional(
      v.object({
        homeScore: v.number(),
        awayScore: v.number(),
        verifiedAtMs: v.number(),
        status: v.union(
          v.literal("FT"),
          v.literal("AOT"),
          v.literal("CANC"),
        ),
        supersededAtMs: v.number(),
      }),
    ),
    /** Changed terminal evidence retained when downstream dependencies block auto-apply. */
    correctionCandidate: v.optional(
      v.object({
        homeScore: v.number(),
        awayScore: v.number(),
        observedAtMs: v.number(),
        status: v.union(
          v.literal("FT"),
          v.literal("AOT"),
          v.literal("CANC"),
        ),
      }),
    ),
    /**
     * Active Production Operator override. While present, this pinned result
     * remains authoritative and provider observations are evidence-only.
     */
    pinnedResultOverrideId: v.optional(v.id("nflGameResultOverrides")),
    lastObservedAtMs: v.optional(v.number()),
    revision: v.optional(v.number()),
  })
    .index("by_stableKey", ["stableKey"])
    .index("by_seasonId_and_week", ["seasonId", "week"])
    .index(
      "by_seasonId_and_week_and_homeTeamId_and_awayTeamId",
      ["seasonId", "week", "homeTeamId", "awayTeamId"],
    )
    .index(
      "by_seasonId_and_lifecycle_and_scheduledKickoffMs",
      ["seasonId", "lifecycle", "scheduledKickoffMs"],
    )
    .index("by_seasonId", ["seasonId"]),

  /** Immutable history: one row for every Verified Result superseded by correction. */
  nflGameResultHistory: defineTable({
    nflGameId: v.id("nflGames"),
    homeScore: v.number(),
    awayScore: v.number(),
    status: v.union(
      v.literal("FT"),
      v.literal("AOT"),
      v.literal("CANC"),
    ),
    verifiedAtMs: v.number(),
    supersededAtMs: v.number(),
  })
    .index("by_nflGameId", ["nflGameId"])
    .index("by_nflGameId_and_supersededAtMs", [
      "nflGameId",
      "supersededAtMs",
    ]),

  /** Immutable provider evidence from every coherent correction lookup. */
  nflGameResultReconciliationObservations: defineTable({
    nflGameId: v.id("nflGames"),
    /** Present when evidence was received during a specific pin episode. */
    pinnedOverrideId: v.optional(v.id("nflGameResultOverrides")),
    observedAtMs: v.number(),
    homeScore: v.number(),
    awayScore: v.number(),
    status: v.union(
      v.literal("FT"),
      v.literal("AOT"),
      v.literal("CANC"),
    ),
    matchesVerified: v.boolean(),
    disposition: v.union(
      v.literal("unchanged"),
      v.literal("candidate"),
      v.literal("corrected"),
      v.literal("stale"),
      v.literal("pinned_matching"),
      v.literal("pinned_conflicting"),
    ),
  })
    .index("by_nflGameId", ["nflGameId"])
    .index("by_nflGameId_and_observedAtMs", [
      "nflGameId",
      "observedAtMs",
    ])
    .index("by_pinnedOverrideId_and_observedAtMs", [
      "pinnedOverrideId",
      "observedAtMs",
    ])
    .index(
      "by_pinnedOverrideId_and_disposition_and_observedAtMs",
      ["pinnedOverrideId", "disposition", "observedAtMs"],
    ),

  /** Append-only audit history for Production Operator result overrides. */
  nflGameResultOverrides: defineTable({
    /** Present only while the override is active in the live sports dataset. */
    nflGameId: v.optional(v.id("nflGames")),
    /** Denormalized permanent identity survives clean sports-data activation. */
    gameStableKey: v.string(),
    seasonLabel: v.string(),
    gameWeek: v.number(),
    homeTeamAbbreviation: v.string(),
    awayTeamAbbreviation: v.string(),
    status: v.union(v.literal("active"), v.literal("released")),
    reason: v.string(),
    replacedResult: v.object({
      homeScore: v.number(),
      awayScore: v.number(),
      verifiedAtMs: v.number(),
      status: v.union(
        v.literal("FT"),
        v.literal("AOT"),
        v.literal("CANC"),
      ),
    }),
    overrideResult: v.object({
      homeScore: v.number(),
      awayScore: v.number(),
      verifiedAtMs: v.number(),
      status: v.union(
        v.literal("FT"),
        v.literal("AOT"),
        v.literal("CANC"),
      ),
    }),
    actorTokenIdentifier: v.string(),
    actorClerkUserId: v.string(),
    pinnedAtMs: v.number(),
    /** Pending superseded-hold cleanup must complete before release. */
    workflowCleanupId: v.optional(v.id("scoringHoldCleanups")),
    releaseReason: v.optional(v.string()),
    releasedAtMs: v.optional(v.number()),
    releasedByTokenIdentifier: v.optional(v.string()),
    releasedByClerkUserId: v.optional(v.string()),
  })
    .index("by_nflGameId_and_status", ["nflGameId", "status"])
    .index("by_gameStableKey_and_pinnedAtMs", [
      "gameStableKey",
      "pinnedAtMs",
    ])
    .index("by_status_and_pinnedAtMs", ["status", "pinnedAtMs"])
    .index("by_pinnedAtMs", ["pinnedAtMs"]),

  /**
   * Permanent, self-contained provider evidence for exactly one override
   * episode. No transient sports-data document IDs are retained here.
   */
  nflGameResultOverrideEvidence: defineTable({
    overrideId: v.id("nflGameResultOverrides"),
    observedAtMs: v.number(),
    homeScore: v.number(),
    awayScore: v.number(),
    status: v.union(
      v.literal("FT"),
      v.literal("AOT"),
      v.literal("CANC"),
    ),
    disposition: v.union(
      v.literal("pinned_matching"),
      v.literal("pinned_conflicting"),
    ),
    // Permanent historical provenance is intentionally provider-neutral.
    // Runtime writers remain constrained at their API boundary.
    source: v.string(),
  }).index(
    "by_overrideId_and_disposition_and_observedAtMs",
    ["overrideId", "disposition", "observedAtMs"],
  ),

  /**
   * Replaceable provider aliases keep external identity off owning rows.
   */
  nflTeamAliases: defineTable({
    nflTeamId: v.id("nflTeams"),
    provider: v.string(),
    externalId: v.string(),
    isCurrent: v.boolean(),
    firstObservedAtMs: v.number(),
    lastObservedAtMs: v.number(),
  })
    .index(
      "by_provider_and_externalId_and_nflTeamId",
      ["provider", "externalId", "nflTeamId"],
    )
    .index(
      "by_nflTeamId_and_provider_and_isCurrent",
      ["nflTeamId", "provider", "isCurrent"],
    ),

  nflGameAliases: defineTable({
    nflGameId: v.id("nflGames"),
    provider: v.string(),
    externalId: v.string(),
    isCurrent: v.boolean(),
    firstObservedAtMs: v.number(),
    lastObservedAtMs: v.number(),
  })
    .index(
      "by_provider_and_externalId_and_nflGameId",
      ["provider", "externalId", "nflGameId"],
    )
    .index(
      "by_nflGameId_and_provider_and_isCurrent",
      ["nflGameId", "provider", "isCurrent"],
    ),

  /** Historical schedule facts used to reconcile replacement provider rows. */
  nflGameScheduleHistory: defineTable({
    nflGameId: v.id("nflGames"),
    seasonId: v.id("poolSeasons"),
    week: v.number(),
    homeTeamId: v.id("nflTeams"),
    awayTeamId: v.id("nflTeams"),
    scheduledKickoffMs: v.number(),
    firstObservedAtMs: v.number(),
    lastObservedAtMs: v.number(),
  })
    .index(
      "by_nflGameId_and_scheduledKickoffMs",
      ["nflGameId", "scheduledKickoffMs"],
    )
    .index("by_seasonId_and_week", ["seasonId", "week"]),

  /**
   * Raw provider status evidence for contract changes. Unknown statuses never
   * replace the NFL Game's last trusted lifecycle.
   */
  sportsDataStatusEvidence: defineTable({
    provider: v.string(),
    externalId: v.string(),
    nflGameId: v.optional(v.id("nflGames")),
    rawShort: v.string(),
    rawLong: v.string(),
    recognized: v.boolean(),
    firstObservedAtMs: v.number(),
    lastObservedAtMs: v.number(),
    observationCount: v.number(),
    expiresAtMs: v.optional(v.number()),
  })
    .index(
      "by_provider_and_externalId_and_rawShort_and_rawLong",
      ["provider", "externalId", "rawShort", "rawLong"],
    )
    .index("by_lastObservedAtMs", ["lastObservedAtMs"])
    .index("by_expiresAtMs", ["expiresAtMs"])
    .index("by_nflGameId_and_lastObservedAtMs", [
      "nflGameId",
      "lastObservedAtMs",
    ]),

  /**
   * Permanent, append-only normalized transitions. Rows are self-contained so
   * operational clean activation cannot erase the evidence needed to explain
   * a historical competitive result.
   */
  providerGameEvidence: defineTable({
    nflGameId: v.optional(v.id("nflGames")),
    incidentId: v.optional(v.id("operatorIncidents")),
    gameStableKey: v.string(),
    seasonLabel: v.string(),
    gameWeek: v.number(),
    homeTeamAbbreviation: v.string(),
    awayTeamAbbreviation: v.string(),
    // Preserve exact historical provenance across provider contractions.
    // Runtime writers remain constrained at their API boundary.
    provider: v.string(),
    externalId: v.optional(v.string()),
    source: v.string(),
    transitionKind: v.union(
      v.literal("kickoff"),
      v.literal("kickoff_lock"),
      v.literal("lifecycle"),
      v.literal("score"),
      v.literal("terminal"),
      v.literal("correction"),
      v.literal("override"),
    ),
    changedFields: v.array(v.string()),
    before: v.union(providerGameEvidenceState, v.null()),
    after: providerGameEvidenceState,
    fingerprint: v.string(),
    observedAtMs: v.number(),
    recordedAtMs: v.number(),
  })
    .index("by_fingerprint", ["fingerprint"])
    .index("by_nflGameId_and_recordedAtMs", [
      "nflGameId",
      "recordedAtMs",
    ])
    .index("by_gameStableKey_and_recordedAtMs", [
      "gameStableKey",
      "recordedAtMs",
    ])
    .index("by_incidentId_and_recordedAtMs", [
      "incidentId",
      "recordedAtMs",
    ]),

  /**
   * Thirty-day, server-sanitized request and no-op poll diagnostics. This
   * table and the legacy diagnostic-only claims/exceptions/status tables are
   * the only evidence storage retention cleanup may delete.
   */
  providerRequestDiagnostics: defineTable({
    fingerprint: v.string(),
    provider: v.literal("api-sports"),
    surface: v.union(
      v.literal("bootstrap"),
      v.literal("schedule"),
      v.literal("live"),
      v.literal("correction"),
      v.literal("operator"),
    ),
    scopeKey: v.optional(v.string()),
    incidentId: v.optional(v.id("operatorIncidents")),
    nflGameId: v.optional(v.id("nflGames")),
    gameStableKey: v.optional(v.string()),
    endpoint: v.union(
      v.literal("/games"),
      v.literal("/teams"),
      v.literal("/status"),
      v.literal("/unknown"),
    ),
    requestLeague: v.optional(v.number()),
    requestSeason: v.optional(v.number()),
    requestPage: v.optional(v.number()),
    requestDate: v.optional(v.string()),
    requestLive: v.optional(v.string()),
    requestExternalId: v.optional(v.string()),
    statusShortPreview: v.optional(v.string()),
    statusLongPreview: v.optional(v.string()),
    statusFingerprint: v.optional(v.string()),
    statusRedacted: v.optional(v.boolean()),
    outcome: v.union(
      v.literal("success"),
      v.literal("http_error"),
      v.literal("rate_limited"),
      v.literal("transport_error"),
      v.literal("malformed"),
      v.literal("no_change"),
      v.literal("quarantined"),
    ),
    httpStatus: v.optional(v.number()),
    bodyBytes: v.optional(v.number()),
    responseFingerprint: v.optional(v.string()),
    resultCount: v.optional(v.number()),
    pagingCurrent: v.optional(v.number()),
    pagingTotal: v.optional(v.number()),
    quotaDailyLimit: v.optional(v.number()),
    quotaDailyRemaining: v.optional(v.number()),
    quotaMinuteLimit: v.optional(v.number()),
    quotaMinuteRemaining: v.optional(v.number()),
    firstRecordedAtMs: v.number(),
    lastRecordedAtMs: v.number(),
    observationCount: v.number(),
    expiresAtMs: v.number(),
    retentionClass: v.literal("diagnostic_30d"),
  })
    .index("by_fingerprint", ["fingerprint"])
    .index("by_expiresAtMs", ["expiresAtMs"])
    .index("by_nflGameId_and_lastRecordedAtMs", [
      "nflGameId",
      "lastRecordedAtMs",
    ])
    .index("by_nflGameId_and_surface_and_lastRecordedAtMs", [
      "nflGameId",
      "surface",
      "lastRecordedAtMs",
    ])
    .index("by_gameStableKey_and_lastRecordedAtMs", [
      "gameStableKey",
      "lastRecordedAtMs",
    ])
    .index("by_surface_and_scopeKey_and_lastRecordedAtMs", [
      "surface",
      "scopeKey",
      "lastRecordedAtMs",
    ])
    .index("by_incidentId_and_lastRecordedAtMs", [
      "incidentId",
      "lastRecordedAtMs",
    ]),

  /** Durable fixed-cutoff progress for interruption-safe diagnostic cleanup. */
  providerDiagnosticCleanupRuns: defineTable({
    key: v.literal("provider-diagnostics"),
    generation: v.number(),
    cutoffMs: v.number(),
    status: v.union(v.literal("running"), v.literal("complete")),
    deletedCount: v.number(),
    batchesCompleted: v.number(),
    startedAtMs: v.number(),
    updatedAtMs: v.number(),
    completedAtMs: v.optional(v.number()),
  }).index("by_key", ["key"]),

  /** Per-game idempotency and successful-slate absence state for live sync. */
  liveGameIngestionState: defineTable({
    nflGameId: v.id("nflGames"),
    lastFingerprint: v.optional(v.string()),
    lastAppliedObservedAtMs: v.optional(v.number()),
    consecutiveSuccessfulSlateMisses: v.number(),
    lastSuccessfulSlateAtMs: v.optional(v.number()),
  }).index("by_nflGameId", ["nflGameId"]),

  /**
   * Immutable parent report for a fetched Season Bootstrap candidate.
   * A staged row is not an Available Season and cannot affect active domain
   * data. Ticket #36 may activate only rows with activationEligible=true.
   */
  seasonBootstrapStages: defineTable({
    seasonYear: v.number(),
    sourceProvider: v.literal("api-sports"),
    invariantsVersion: v.string(),
    validationStatus: v.union(
      v.literal("valid"),
      v.literal("invalid"),
    ),
    activationEligible: v.boolean(),
    teamCount: v.number(),
    gameCount: v.number(),
    weekCount: v.number(),
    teamAliasCount: v.number(),
    gameAliasCount: v.number(),
    failureCount: v.number(),
    storedFailureCount: v.number(),
    failuresTruncated: v.boolean(),
    actorTokenIdentifier: v.string(),
    actorClerkUserId: v.string(),
    stagedAtMs: v.number(),
  })
    .index("by_seasonYear_and_stagedAtMs", [
      "seasonYear",
      "stagedAtMs",
    ])
    .index("by_validationStatus_and_stagedAtMs", [
      "validationStatus",
      "stagedAtMs",
    ]),

  /** Bounded child rows for a staged candidate's canonical NFL Teams. */
  seasonBootstrapStagedTeams: defineTable({
    stageId: v.id("seasonBootstrapStages"),
    ordinal: v.number(),
    stableKey: v.string(),
    abbreviation: v.string(),
    name: v.string(),
    logoUrl: v.string(),
  }).index("by_stageId_and_ordinal", ["stageId", "ordinal"]),

  /** Bounded child rows for a staged candidate's regular-season NFL Games. */
  seasonBootstrapStagedGames: defineTable({
    stageId: v.id("seasonBootstrapStages"),
    ordinal: v.number(),
    stableKey: v.string(),
    seasonYear: v.number(),
    week: v.number(),
    homeTeamAbbreviation: v.string(),
    awayTeamAbbreviation: v.string(),
    homeTeamProviderAliasId: v.optional(v.string()),
    awayTeamProviderAliasId: v.optional(v.string()),
    scheduledKickoffMs: v.number(),
    lifecycle: nflGameLifecycle,
    homeScore: v.union(v.number(), v.null()),
    awayScore: v.union(v.number(), v.null()),
    observedAtMs: v.number(),
  }).index("by_stageId_and_ordinal", ["stageId", "ordinal"]),

  /**
   * Provider aliases remain replaceable child identities. Arrays are not
   * embedded in stage/team/game documents.
   */
  seasonBootstrapStagedAliases: defineTable({
    stageId: v.id("seasonBootstrapStages"),
    ordinal: v.number(),
    entityType: v.union(v.literal("team"), v.literal("game")),
    entityStableKey: v.string(),
    provider: v.string(),
    externalId: v.string(),
  })
    .index("by_stageId_and_ordinal", ["stageId", "ordinal"])
    .index("by_stageId_and_entityType_and_entityStableKey", [
      "stageId",
      "entityType",
      "entityStableKey",
    ]),

  /** Actionable validation details stored separately from the parent report. */
  seasonBootstrapValidationFailures: defineTable({
    stageId: v.id("seasonBootstrapStages"),
    ordinal: v.number(),
    code: v.string(),
    scope: v.union(
      v.literal("season"),
      v.literal("team"),
      v.literal("game"),
      v.literal("alias"),
    ),
    entityKey: v.optional(v.string()),
    message: v.string(),
  }).index("by_stageId_and_ordinal", ["stageId", "ordinal"]),

  /**
   * One explicit, deployment-bound confirmation request for a clean Season
   * Bootstrap activation. These rows are operational audit support and are
   * preserved by clean activation.
   */
  seasonBootstrapActivationRequests: defineTable({
    stageId: v.id("seasonBootstrapStages"),
    seasonYear: v.number(),
    deploymentKind: v.union(
      v.literal("development"),
      v.literal("production"),
    ),
    deploymentId: v.string(),
    confirmationText: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("activated"),
      v.literal("expired"),
    ),
    actorTokenIdentifier: v.string(),
    actorClerkUserId: v.string(),
    requestedAtMs: v.number(),
    expiresAtMs: v.number(),
    activatedAtMs: v.optional(v.number()),
    deletedCountsJson: v.optional(v.string()),
    rebuiltCountsJson: v.optional(v.string()),
    preservedCategories: v.array(v.string()),
    protectedOperatorAuditBoundaryAtMs: v.optional(v.number()),
    protectedOperatorAuditCount: v.optional(v.number()),
    protectedOperatorAuditFingerprint: v.optional(v.string()),
  })
    .index("by_stageId_and_requestedAtMs", ["stageId", "requestedAtMs"])
    .index("by_stageId_and_deploymentKind_and_deploymentId_and_status", [
      "stageId",
      "deploymentKind",
      "deploymentId",
      "status",
    ])
    .index("by_deploymentKind_and_requestedAtMs", [
      "deploymentKind",
      "requestedAtMs",
    ]),

  /**
   * Active Pool competitive container. Pool Type and Pool Season are immutable
   * after create; Start Week / Pick Lock mode freeze via rulesFrozen.
   * `archived` is a reversible read-only overlay — does not pause lifecycle,
   * locks, sync, or scoring.
   */
  pools: defineTable({
    name: v.string(),
    /**
     * Optional blurb visible to all members. Owner/Admin may edit anytime
     * (not outcome-affecting). Absent/empty = no description.
     */
    description: v.optional(v.string()),
    type: poolType,
    seasonId: v.id("poolSeasons"),
    startWeek: v.number(),
    /**
     * Last included Survivor week. Absent means the regular-season default
     * (Week 18) for legacy and ordinary pools.
     */
    finalWeek: v.optional(v.number()),
    pickLockMode: pickLockMode,
    status: v.union(v.literal("active"), v.literal("completed")),
    /** True after first accepted competitive edit or first Pick Lock. */
    rulesFrozen: v.boolean(),
    /**
     * Reversible admin overlay. Absent/false = normal; true = Archived Pool.
     * Does not change status (active/completed) or pause locks/sync/scoring.
     */
    archived: v.optional(v.boolean()),
    archivedAtMs: v.optional(v.number()),
    ownerParticipantId: v.id("participants"),
    createdAtMs: v.number(),
    /**
     * Latched when membership admission first closes (Start Week earliest
     * kickoff reached). A later reschedule never reopens.
     */
    admissionClosedAtMs: v.optional(v.number()),
    /** Set when Survivor (or later Confidence) reaches a terminal outcome. */
    completedAtMs: v.optional(v.number()),
    completedWeek: v.optional(v.number()),
    /**
     * Max active competitive entries per participant (1–10).
     * Absent means 1 (legacy / default single-entry pools).
     */
    maxEntriesPerUser: v.optional(v.number()),
  })
    .index("by_ownerParticipantId", ["ownerParticipantId"])
    .index("by_seasonId", ["seasonId"]),

  /** One membership document per (pool, participant). */
  poolMemberships: defineTable({
    poolId: v.id("pools"),
    participantId: v.id("participants"),
    role: membershipRole,
    status: v.union(
      v.literal("active"),
      v.literal("removed"),
      v.literal("left"),
    ),
    /** Short reason required for removal / reinstatement. */
    statusReason: v.optional(v.string()),
    statusChangedAtMs: v.optional(v.number()),
  })
    .index("by_participantId", ["participantId"])
    .index("by_poolId", ["poolId"])
    .index("by_poolId_and_participantId", ["poolId", "participantId"]),

  /**
   * Competitive Pool Entry under a membership. Picks/standings key off entryId.
   * Membership remains the auth/role seat (one per participant per pool).
   */
  poolEntries: defineTable({
    poolId: v.id("pools"),
    participantId: v.id("participants"),
    membershipId: v.id("poolMemberships"),
    /** 1-based label index for display: Name, Name (2), … */
    entryNumber: v.number(),
    status: v.union(v.literal("active"), v.literal("ended")),
    createdAtMs: v.number(),
    endedAtMs: v.optional(v.number()),
  })
    .index("by_poolId", ["poolId"])
    .index("by_poolId_and_status", ["poolId", "status"])
    .index("by_poolId_and_participantId", ["poolId", "participantId"])
    .index("by_membershipId", ["membershipId"])
    .index("by_participantId", ["participantId"]),

  /**
   * Pending ownership offer — only to a current Pool Admin. Current Owner
   * retains full authority until explicit accept; cancel anytime before accept.
   */
  ownershipTransferOffers: defineTable({
    poolId: v.id("pools"),
    fromParticipantId: v.id("participants"),
    toParticipantId: v.id("participants"),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("cancelled"),
    ),
    createdAtMs: v.number(),
    resolvedAtMs: v.optional(v.number()),
  })
    .index("by_poolId_and_status", ["poolId", "status"])
    .index("by_toParticipantId_and_status", ["toParticipantId", "status"]),

  /**
   * Private Abuse Report intake — never stores Hidden Pick values or raw
   * invite credentials. Creates no automatic penalty.
   */
  abuseReports: defineTable({
    reporterParticipantId: v.id("participants"),
    poolId: v.optional(v.id("pools")),
    reason: v.string(),
    description: v.optional(v.string()),
    createdAtMs: v.number(),
  })
    .index("by_reporterParticipantId", ["reporterParticipantId"])
    .index("by_createdAtMs", ["createdAtMs"]),

  /**
   * Deployment Sync Gate singleton (key = "deployment").
   * Defaults OFF; production requires a current explicit qualification pass.
   */
  syncGate: defineTable({
    key: v.literal("deployment"),
    enabled: v.boolean(),
    updatedAtMs: v.number(),
    updatedByTokenIdentifier: v.optional(v.string()),
  }).index("by_key", ["key"]),

  /** Minimal Production Operator audit trail (Season Bootstrap, Sync Gate). */
  operatorAuditEvents: defineTable({
    action: v.string(),
    actorTokenIdentifier: v.string(),
    actorClerkUserId: v.string(),
    atMs: v.number(),
    detailsJson: v.optional(v.string()),
  }).index("by_atMs", ["atMs"]),

  /**
   * Pool-specific gate created when corrected terminal evidence would rewrite
   * scoring after a later competitive dependency has become official.
   */
  scoringHolds: defineTable({
    evaluationId: v.optional(v.id("scoringHoldEvaluations")),
    poolId: v.id("pools"),
    gameId: v.id("nflGames"),
    poolType: v.union(v.literal("survivor"), v.literal("confidence")),
    gameWeek: v.number(),
    dependency: v.union(
      v.literal("later_game_lock"),
      v.literal("later_weekly_cutoff"),
      v.literal("settled_pool_week"),
      v.literal("locked_survivor_pick"),
      v.literal("non_provisional_survivor_pick"),
      v.literal("locked_confidence_pick"),
      v.literal("bounded_scope_exceeded"),
    ),
    candidateKey: v.string(),
    dedupeKey: v.string(),
    candidateHomeScore: v.number(),
    candidateAwayScore: v.number(),
    candidateObservedAtMs: v.number(),
    candidateStatus: v.union(
      v.literal("FT"),
      v.literal("AOT"),
      v.literal("CANC"),
    ),
    officialHomeScore: v.number(),
    officialAwayScore: v.number(),
    officialVerifiedAtMs: v.number(),
    officialStatus: v.union(
      v.literal("FT"),
      v.literal("AOT"),
      v.literal("CANC"),
    ),
    status: v.union(v.literal("open"), v.literal("resolved")),
    createdAtMs: v.number(),
    resolvedAtMs: v.optional(v.number()),
    resolution: v.optional(
      v.union(
        v.literal("accepted_correction"),
        v.literal("superseded_candidate"),
        v.literal("withdrawn_candidate"),
      ),
    ),
    resolvedByTokenIdentifier: v.optional(v.string()),
    resolvedByClerkUserId: v.optional(v.string()),
  })
    .index("by_dedupeKey", ["dedupeKey"])
    .index("by_poolId_and_status", ["poolId", "status"])
    .index("by_poolId_and_status_and_gameWeek", [
      "poolId",
      "status",
      "gameWeek",
    ])
    .index("by_poolId_and_gameId_and_status", [
      "poolId",
      "gameId",
      "status",
    ])
    .index("by_gameId_and_status", ["gameId", "status"])
    .index("by_gameId_and_candidateKey", ["gameId", "candidateKey"])
    .index("by_gameId_and_candidateKey_and_status", [
      "gameId",
      "candidateKey",
      "status",
    ])
    .index("by_status_and_createdAtMs", ["status", "createdAtMs"]),

  /** Append-only watermark for writes that can create correction dependencies. */
  scoringDependencyEvents: defineTable({
    seasonId: v.id("poolSeasons"),
    dependencyWeek: v.optional(v.number()),
    recordedAtMs: v.number(),
  }).index("by_seasonId", ["seasonId"]),

  /** Cursor-batched, fail-closed evaluation of one semantic correction. */
  scoringHoldEvaluations: defineTable({
    seasonId: v.id("poolSeasons"),
    gameId: v.id("nflGames"),
    gameWeek: v.number(),
    candidateKey: v.string(),
    candidateHomeScore: v.number(),
    candidateAwayScore: v.number(),
    candidateObservedAtMs: v.number(),
    candidateStatus: v.union(
      v.literal("FT"),
      v.literal("AOT"),
      v.literal("CANC"),
    ),
    status: v.union(
      v.literal("building"),
      v.literal("complete"),
      v.literal("incomplete"),
      v.literal("abandoned"),
      v.literal("applied"),
    ),
    cursor: v.optional(v.string()),
    processedPools: v.number(),
    holdCount: v.number(),
    /** Latest append-only dependency event captured for the current full scan. */
    dependencyEventId: v.optional(v.id("scoringDependencyEvents")),
    startedAtMs: v.number(),
    completedAtMs: v.optional(v.number()),
    abandonedAtMs: v.optional(v.number()),
  })
    .index("by_seasonId_and_status", ["seasonId", "status"])
    .index("by_seasonId_and_status_and_gameWeek", [
      "seasonId",
      "status",
      "gameWeek",
    ])
    .index("by_gameId_and_candidateKey", ["gameId", "candidateKey"])
    .index("by_gameId_and_candidateKey_and_status", [
      "gameId",
      "candidateKey",
      "status",
    ])
    .index("by_gameId_and_status", ["gameId", "status"]),

  /** Durable retirement of superseded or withdrawn correction episodes. */
  scoringHoldCleanups: defineTable({
    seasonId: v.id("poolSeasons"),
    gameId: v.id("nflGames"),
    gameWeek: v.number(),
    candidateKey: v.string(),
    reason: v.union(
      v.literal("superseded_candidate"),
      v.literal("withdrawn_candidate"),
    ),
    status: v.union(v.literal("pending"), v.literal("complete")),
    phase: v.union(v.literal("evaluations"), v.literal("holds")),
    evaluationCursor: v.optional(v.string()),
    holdCursor: v.optional(v.string()),
    abandonedEvaluations: v.number(),
    resolvedHolds: v.number(),
    startedAtMs: v.number(),
    completedAtMs: v.optional(v.number()),
  })
    .index("by_seasonId_and_status", ["seasonId", "status"])
    .index("by_seasonId_and_status_and_gameWeek", [
      "seasonId",
      "status",
      "gameWeek",
    ])
    .index("by_gameId_and_candidateKey_and_status", [
      "gameId",
      "candidateKey",
      "status",
    ])
    .index("by_gameId_and_status", ["gameId", "status"]),

  /** Durable, fail-closed validation and application of an accepted result. */
  scoringHoldAcceptances: defineTable({
    seasonId: v.id("poolSeasons"),
    gameId: v.id("nflGames"),
    gameWeek: v.number(),
    candidateKey: v.string(),
    status: v.union(
      v.literal("validating_evaluations"),
      v.literal("validating_holds"),
      v.literal("resolving_holds"),
      v.literal("applying_evaluations"),
      v.literal("complete"),
      v.literal("abandoned"),
      v.literal("rejected"),
    ),
    cursor: v.optional(v.string()),
    validatedHolds: v.number(),
    processedHolds: v.number(),
    actorTokenIdentifier: v.string(),
    actorClerkUserId: v.string(),
    startedAtMs: v.number(),
    appliedAtMs: v.optional(v.number()),
    completedAtMs: v.optional(v.number()),
    abandonedAtMs: v.optional(v.number()),
  })
    .index("by_seasonId_and_status", ["seasonId", "status"])
    .index("by_seasonId_and_status_and_gameWeek", [
      "seasonId",
      "status",
      "gameWeek",
    ])
    .index("by_gameId_and_candidateKey", ["gameId", "candidateKey"])
    .index("by_gameId_and_candidateKey_and_status", [
      "gameId",
      "candidateKey",
      "status",
    ])
    .index("by_gameId_and_status", ["gameId", "status"]),

  /** Deduplicated scoring work suppressed while a correction gate is open. */
  scoringBlockedWork: defineTable({
    poolId: v.id("pools"),
    kind: v.union(v.literal("survivor"), v.literal("confidence")),
    week: v.number(),
    dedupeKey: v.string(),
    status: v.union(v.literal("pending"), v.literal("replayed")),
    candidateKey: v.string(),
    holdId: v.optional(v.id("scoringHolds")),
    evaluationId: v.optional(v.id("scoringHoldEvaluations")),
    cleanupId: v.optional(v.id("scoringHoldCleanups")),
    acceptanceId: v.optional(v.id("scoringHoldAcceptances")),
    blockedAtMs: v.number(),
    replayedAtMs: v.optional(v.number()),
  })
    .index("by_dedupeKey", ["dedupeKey"])
    .index("by_poolId_and_kind_and_status", [
      "poolId",
      "kind",
      "status",
    ]),

  /**
   * Ordinary Pool Invite — at most one active per Pool. Accept lookup uses
   * credentialHash only; credentialSecret is returned solely after step-up
   * via createOrRetrieveInvite / rotateInvite and never logged or audited.
   */
  poolInvites: defineTable({
    poolId: v.id("pools"),
    credentialHash: v.string(),
    /** Opaque at-rest secret for Owner/Admin retrieve after step-up. */
    credentialSecret: v.string(),
    status: v.union(
      v.literal("active"),
      v.literal("rotated"),
      v.literal("expired"),
    ),
    expiresAtMs: v.number(),
    createdByParticipantId: v.id("participants"),
    createdAtMs: v.number(),
    rotatedAtMs: v.optional(v.number()),
  })
    .index("by_poolId", ["poolId"])
    .index("by_poolId_and_status", ["poolId", "status"])
    .index("by_credentialHash", ["credentialHash"]),

  /**
   * Returning Participant Invite — person-specific, single-use, created from a
   * Pool Template. Never auto-enrolls; accept required. Only the Pool Owner
   * may propose Pool Admin via these invites. Raw credential never audited.
   */
  returningParticipantInvites: defineTable({
    poolId: v.id("pools"),
    sourcePoolId: v.id("pools"),
    targetParticipantId: v.id("participants"),
    proposedRole: v.union(v.literal("member"), v.literal("admin")),
    credentialHash: v.string(),
    /** Opaque at-rest secret returned only at create time. */
    credentialSecret: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("revoked"),
      v.literal("expired"),
    ),
    expiresAtMs: v.number(),
    createdByParticipantId: v.id("participants"),
    createdAtMs: v.number(),
    acceptedAtMs: v.optional(v.number()),
  })
    .index("by_poolId", ["poolId"])
    .index("by_credentialHash", ["credentialHash"])
    .index("by_poolId_and_targetParticipantId", [
      "poolId",
      "targetParticipantId",
    ]),

  /**
   * Progressive throttle for invalid / expired / probing invite attempts.
   * Keyed by Clerk tokenIdentifier (account) — never auto-rotates a valid invite.
   */
  inviteThrottle: defineTable({
    key: v.string(),
    attemptCount: v.number(),
    windowStartMs: v.number(),
    blockedUntilMs: v.optional(v.number()),
  }).index("by_key", ["key"]),

  /**
   * Sanitized Pool Audit Events — no raw invite credentials or contact fields.
   */
  poolAuditEvents: defineTable({
    poolId: v.id("pools"),
    action: v.string(),
    actorParticipantId: v.id("participants"),
    atMs: v.number(),
    metadataJson: v.optional(v.string()),
  })
    .index("by_poolId_and_atMs", ["poolId", "atMs"])
    .index("by_atMs", ["atMs"]),

  /**
   * Authoritative API-Sports quota and circuit state. This singleton is
   * intentionally aggregate-only; per-request diagnostics are a later concern.
   */
  providerReliabilityState: defineTable({
    key: v.literal("api-sports"),
    dailyWindowStartedAtMs: v.number(),
    dailyResetAtMs: v.number(),
    dailyUsed: v.number(),
    routineDailyUsed: v.number(),
    protectedDailyUsed: v.number(),
    providerDailyLimit: v.optional(v.number()),
    providerDailyRemaining: v.optional(v.number()),
    minuteAdmissionTimestampsMs: v.array(v.number()),
    providerMinuteWindowStartedAtMs: v.number(),
    providerMinuteResetAtMs: v.number(),
    providerMinuteUsed: v.number(),
    providerMinuteLimit: v.optional(v.number()),
    providerMinuteRemaining: v.optional(v.number()),
    headerInconsistencyCount: v.number(),
    staleHeaderCount: v.number(),
    circuitStatus: v.union(
      v.literal("closed"),
      v.literal("open"),
      v.literal("half_open"),
    ),
    circuitGeneration: v.number(),
    consecutiveFailures: v.number(),
    circuitOpenedAtMs: v.optional(v.number()),
    circuitOpenUntilMs: v.optional(v.number()),
    probeToken: v.optional(v.string()),
    probeExpiresAtMs: v.optional(v.number()),
    lastAttemptAtMs: v.optional(v.number()),
    lastSuccessAtMs: v.optional(v.number()),
    lastFailureAtMs: v.optional(v.number()),
    recoveredAtMs: v.optional(v.number()),
    deferredRoutineCount: v.number(),
    rejectedRequestCount: v.number(),
    circuitBlockedCount: v.number(),
    lastDeferredAtMs: v.optional(v.number()),
    lastFailureReason: v.optional(v.string()),
    updatedAtMs: v.number(),
  }).index("by_key", ["key"]),

  /**
   * Provider fetch claim attempts — Sync Gate deny/allow + budget admission.
   * Used by the dispatcher and tests; clients never call the provider.
   */
  providerFetchClaims: defineTable({
    surface: v.string(),
    status: v.union(v.literal("claimed"), v.literal("denied")),
    reason: v.optional(v.string()),
    claimedAtMs: v.number(),
    priority: v.optional(
      v.union(
        v.literal("routine"),
        v.literal("recovery"),
        v.literal("operator"),
      ),
    ),
    workItemId: v.optional(v.id("syncWorkItems")),
    expiresAtMs: v.optional(v.number()),
  })
    .index("by_claimedAtMs", ["claimedAtMs"])
    .index("by_expiresAtMs", ["expiresAtMs"])
    .index("by_status_and_claimedAtMs", ["status", "claimedAtMs"]),

  /**
   * Durable sync work queue — schedule, live, correction, and operator work.
   * Coalesced by surface + scopeKey; dispatcher claims due items under budget.
   */
  syncWorkItems: defineTable({
    surface: v.union(
      v.literal("schedule"),
      v.literal("live"),
      v.literal("correction"),
      v.literal("operator"),
    ),
    scopeKey: v.string(),
    priority: v.union(
      v.literal("routine"),
      v.literal("recovery"),
      v.literal("operator"),
    ),
    status: v.union(
      v.literal("due"),
      v.literal("claimed"),
      v.literal("done"),
      v.literal("failed"),
    ),
    dueAtMs: v.number(),
    claimedAtMs: v.optional(v.number()),
    leaseExpiresAtMs: v.optional(v.number()),
    attemptCount: v.number(),
    gameId: v.optional(v.id("nflGames")),
    /** Exact pin episode expected by targeted evidence work. */
    pinnedResultOverrideId: v.optional(v.id("nflGameResultOverrides")),
    seasonId: v.optional(v.id("poolSeasons")),
    purpose: v.optional(v.string()),
    deferredReason: v.optional(v.string()),
    deferredAtMs: v.optional(v.number()),
    isProviderDeferred: v.optional(v.boolean()),
  })
    .index("by_status_and_dueAtMs", ["status", "dueAtMs"])
    .index("by_status_and_leaseExpiresAtMs", [
      "status",
      "leaseExpiresAtMs",
    ])
    .index("by_status_and_priority_and_dueAtMs", [
      "status",
      "priority",
      "dueAtMs",
    ])
    .index("by_status_and_isProviderDeferred_and_dueAtMs", [
      "status",
      "isProviderDeferred",
      "dueAtMs",
    ])
    .index("by_scopeKey", ["scopeKey"])
    .index("by_gameId", ["gameId"]),

  /**
   * Per-surface sync health for freshness derivation (Late / Stale / Exception).
   */
  syncSurfaceHealth: defineTable({
    surface: v.string(),
    scopeKey: v.string(),
    lastAttemptAtMs: v.optional(v.number()),
    lastSuccessAtMs: v.optional(v.number()),
    expectedNextRefreshAtMs: v.optional(v.number()),
    consecutiveFailures: v.number(),
    providerException: v.boolean(),
    updatedAtMs: v.number(),
  }).index("by_surface_and_scopeKey", ["surface", "scopeKey"]),

  /**
   * One durable episode anchor for the global API-Sports live feed watchdog.
   * This is dataset freshness state and is reset by clean activation.
   */
  liveIngestionWatchdogState: defineTable({
    key: v.literal("live:nfl"),
    active: v.boolean(),
    activeWindowStartedAtMs: v.optional(v.number()),
    lastSuccessfulExpectedIngestionAtMs: v.optional(v.number()),
    lastEvaluatedAtMs: v.number(),
    updatedAtMs: v.number(),
  }).index("by_key", ["key"]),

  /**
   * Provider Exception records — distinguishable from Late / Stale freshness.
   * Opening an Operator Incident is handled by the incidents module (ticket 13).
   */
  providerExceptions: defineTable({
    kind: v.string(),
    gameId: v.optional(v.id("nflGames")),
    scopeKey: v.string(),
    message: v.string(),
    createdAtMs: v.number(),
    resolvedAtMs: v.optional(v.number()),
    expiresAtMs: v.optional(v.number()),
  })
    .index("by_createdAtMs", ["createdAtMs"])
    .index("by_expiresAtMs", ["expiresAtMs"])
    .index("by_scopeKey_and_createdAtMs", ["scopeKey", "createdAtMs"])
    .index("by_gameId", ["gameId"]),

  /**
   * Operator Incidents — production trust / recovery source of truth.
   * Dedupe by type + surface + scopeKey so one failing window is one incident.
   */
  operatorIncidents: defineTable({
    type: v.union(
      v.literal("provider_exception"),
      v.literal("stale_in_window"),
      v.literal("scoring_delayed"),
      v.literal("convex_capacity"),
    ),
    status: v.union(
      v.literal("open"),
      v.literal("acknowledged"),
      v.literal("in_progress"),
      v.literal("resolved"),
    ),
    surface: v.string(),
    scopeKey: v.string(),
    dedupeKey: v.string(),
    participantVisible: v.boolean(),
    severity: v.optional(
      v.union(v.literal("warning"), v.literal("critical")),
    ),
    summary: v.string(),
    openedAtMs: v.number(),
    criticalAtMs: v.optional(v.number()),
    lastSuccessfulIngestionAtMs: v.optional(v.number()),
    watchdogReferenceAtMs: v.optional(v.number()),
    acknowledgedAtMs: v.optional(v.number()),
    resolvedAtMs: v.optional(v.number()),
    resolutionNote: v.optional(v.string()),
    resolutionCause: v.optional(
      v.union(
        v.literal("healthy_ingestion"),
        v.literal("window_ended"),
      ),
    ),
    resolvedAutomatically: v.optional(v.boolean()),
    /** Never true while an incident is open — picking continues. */
    maintenanceLock: v.literal(false),
  })
    .index("by_dedupeKey_and_status", ["dedupeKey", "status"])
    .index("by_status_and_openedAtMs", ["status", "openedAtMs"])
    .index(
      "by_status_and_surface_and_openedAtMs",
      ["status", "surface", "openedAtMs"],
    )
    .index("by_participantVisible_and_status", [
      "participantVisible",
      "status",
    ]),

  /**
   * Survivor Pick — one team per entry per included week.
   * Unlocked rows are Hidden Picks: never expose nflTeamId to non-authors.
   */
  survivorPicks: defineTable({
    poolId: v.id("pools"),
    participantId: v.id("participants"),
    /** Competitive identity; required on new writes. */
    entryId: v.optional(v.id("poolEntries")),
    week: v.number(),
    /** Absent for locked omissions (no team was chosen). */
    nflTeamId: v.optional(v.id("nflTeams")),
    gameId: v.optional(v.id("nflGames")),
    locked: v.boolean(),
    lockedAtMs: v.optional(v.number()),
    provenance: v.union(v.literal("authored"), v.literal("omission")),
    /** Advance / future-week pick while earlier weeks are unsettled. */
    provisional: v.boolean(),
    /**
     * Set when an earlier elimination or pre-lock cancellation invalidates a
     * Survivor Pick — reservation is released and the team is not consumed.
     */
    invalidated: v.optional(v.boolean()),
    invalidatedAtMs: v.optional(v.number()),
    invalidationReason: v.optional(
      v.union(
        v.literal("earlier_elimination"),
        v.literal("pre_lock_cancellation"),
      ),
    ),
    updatedAtMs: v.number(),
  })
    .index("by_poolId_and_participantId_and_week", [
      "poolId",
      "participantId",
      "week",
    ])
    .index("by_poolId_and_entryId_and_week", ["poolId", "entryId", "week"])
    .index("by_poolId_and_week", ["poolId", "week"])
    .index("by_poolId_and_locked_and_week", ["poolId", "locked", "week"])
    .index("by_poolId_and_provisional_and_week", [
      "poolId",
      "provisional",
      "week",
    ])
    .index("by_poolId_and_participantId", ["poolId", "participantId"])
    .index("by_entryId", ["entryId"]),

  /**
   * One-use team reservation for Survivor (per entry). Unlocked pick changes
   * release the prior reservation and reserve the new team.
   */
  survivorTeamReservations: defineTable({
    poolId: v.id("pools"),
    participantId: v.id("participants"),
    entryId: v.optional(v.id("poolEntries")),
    nflTeamId: v.id("nflTeams"),
    week: v.number(),
    released: v.boolean(),
    updatedAtMs: v.number(),
  })
    .index("by_poolId_and_participantId_and_nflTeamId", [
      "poolId",
      "participantId",
      "nflTeamId",
    ])
    .index("by_poolId_and_entryId_and_nflTeamId", [
      "poolId",
      "entryId",
      "nflTeamId",
    ])
    .index("by_poolId_and_participantId", ["poolId", "participantId"])
    .index("by_entryId", ["entryId"]),

  /**
   * Frozen Confidence Pick Sheet for one Pool Week — identical for every
   * eligible participant. Created when the Confidence Pick Window opens.
   */
  confidencePickSheets: defineTable({
    poolId: v.id("pools"),
    week: v.number(),
    /** Ordered Required Confidence Game ids (Pick Sheet order). */
    gameIds: v.array(v.id("nflGames")),
    /** Season Confidence Scale maximum used to derive default ranking. */
    scaleMax: v.number(),
    /** Chronologically last scheduled Required Confidence Game at freeze. */
    tiebreakerGameId: v.id("nflGames"),
    frozenAtMs: v.number(),
  }).index("by_poolId_and_week", ["poolId", "week"]),

  /**
   * Per-entry Confidence Pick Set for one Pool Week.
   * origin=untouched until first accepted edit or Automatic materialization.
   */
  confidencePickSets: defineTable({
    poolId: v.id("pools"),
    participantId: v.id("participants"),
    entryId: v.optional(v.id("poolEntries")),
    week: v.number(),
    origin: v.union(
      v.literal("untouched"),
      v.literal("authored"),
      v.literal("automatic"),
    ),
    /** Whole number 0–200; absent means omitted. */
    tiebreakerPrediction: v.optional(v.number()),
    tiebreakerLocked: v.boolean(),
    updatedAtMs: v.number(),
  })
    .index("by_poolId_and_participantId_and_week", [
      "poolId",
      "participantId",
      "week",
    ])
    .index("by_poolId_and_entryId_and_week", ["poolId", "entryId", "week"])
    .index("by_poolId_and_week", ["poolId", "week"])
    .index("by_entryId", ["entryId"]),

  /**
   * One Required Confidence Game row within a Confidence Pick Set.
   * Unlocked predictions are Hidden Picks — never expose to non-authors.
   */
  confidencePicks: defineTable({
    poolId: v.id("pools"),
    participantId: v.id("participants"),
    entryId: v.optional(v.id("poolEntries")),
    week: v.number(),
    pickSetId: v.id("confidencePickSets"),
    gameId: v.id("nflGames"),
    /** Absent while blank (unlocked) or locked omission in a started set. */
    pickedTeamId: v.optional(v.id("nflTeams")),
    confidenceValue: v.number(),
    locked: v.boolean(),
    lockedAtMs: v.optional(v.number()),
    provenance: v.union(
      v.literal("authored"),
      v.literal("automatic"),
      v.literal("omission"),
    ),
    updatedAtMs: v.number(),
  })
    .index("by_pickSetId", ["pickSetId"])
    .index("by_poolId_and_participantId_and_week", [
      "poolId",
      "participantId",
      "week",
    ])
    .index("by_poolId_and_entryId_and_week", ["poolId", "entryId", "week"])
    .index("by_poolId_and_week_and_gameId", ["poolId", "week", "gameId"])
    .index("by_poolId_and_week", ["poolId", "week"])
    .index("by_poolId_and_locked_and_week", ["poolId", "locked", "week"])
    .index("by_entryId", ["entryId"]),

  /**
   * Pool Week lifecycle + current Scoring Revision pointer.
   * Survivor weeks have no Pick Sheet; Confidence weeks may.
   */
  poolWeeks: defineTable({
    poolId: v.id("pools"),
    week: v.number(),
    /** True when every Alive-entering participant has a resolved outcome. */
    settled: v.boolean(),
    currentScoringRevisionId: v.optional(v.id("scoringRevisions")),
    currentRevisionNumber: v.optional(v.number()),
    updatedAtMs: v.number(),
  })
    .index("by_poolId_and_week", ["poolId", "week"])
    .index("by_poolId_and_settled_and_week", ["poolId", "settled", "week"]),

  /**
   * Immutable official Scoring Revision for one Pool Week.
   * Identical authoritative input fingerprint is an idempotent no-op.
   */
  scoringRevisions: defineTable({
    poolId: v.id("pools"),
    week: v.number(),
    kind: v.union(v.literal("survivor"), v.literal("confidence")),
    revisionNumber: v.number(),
    fingerprint: v.string(),
    publishedAtMs: v.number(),
    status: v.literal("published"),
  })
    .index("by_poolId_and_week", ["poolId", "week"])
    .index("by_poolId_and_week_and_revisionNumber", [
      "poolId",
      "week",
      "revisionNumber",
    ]),

  /**
   * Survivor pick outcome projection — published atomically with a Scoring
   * Revision. Official outcomes only from Verified Results (never provisional).
   */
  survivorPickOutcomes: defineTable({
    poolId: v.id("pools"),
    participantId: v.id("participants"),
    entryId: v.optional(v.id("poolEntries")),
    week: v.number(),
    pickId: v.optional(v.id("survivorPicks")),
    outcome: v.union(
      v.literal("win"),
      v.literal("loss"),
      v.literal("tie"),
      v.literal("missing_pick"),
      v.literal("pending"),
      v.literal("invalidated"),
      v.literal("no_contest_advance"),
    ),
    revisionId: v.id("scoringRevisions"),
    updatedAtMs: v.number(),
  })
    .index("by_poolId_and_week", ["poolId", "week"])
    .index("by_poolId_and_participantId_and_week", [
      "poolId",
      "participantId",
      "week",
    ])
    .index("by_poolId_and_entryId_and_week", ["poolId", "entryId", "week"]),

  /**
   * Confidence pick outcome projection — one row per Required Confidence Game
   * per entry, published atomically with a Scoring Revision.
   */
  confidencePickOutcomes: defineTable({
    poolId: v.id("pools"),
    participantId: v.id("participants"),
    entryId: v.optional(v.id("poolEntries")),
    week: v.number(),
    gameId: v.id("nflGames"),
    pickId: v.optional(v.id("confidencePicks")),
    outcome: v.union(
      v.literal("correct"),
      v.literal("incorrect"),
      v.literal("omission_zero"),
      v.literal("tied_zero"),
      v.literal("canceled_zero"),
      v.literal("pending"),
    ),
    pointsEarned: v.number(),
    confidenceValue: v.number(),
    revisionId: v.id("scoringRevisions"),
    updatedAtMs: v.number(),
  })
    .index("by_poolId_and_week", ["poolId", "week"])
    .index("by_poolId_and_participantId_and_week", [
      "poolId",
      "participantId",
      "week",
    ])
    .index("by_poolId_and_participantId_and_week_and_gameId", [
      "poolId",
      "participantId",
      "week",
      "gameId",
    ])
    .index("by_poolId_and_entryId_and_week_and_gameId", [
      "poolId",
      "entryId",
      "week",
      "gameId",
    ]),

  /**
   * Official Weekly Standing projection for Confidence Pools — progressive
   * per Verified Result. Possible Remaining Points are official-only.
   */
  weeklyStandings: defineTable({
    poolId: v.id("pools"),
    participantId: v.id("participants"),
    entryId: v.optional(v.id("poolEntries")),
    week: v.number(),
    points: v.number(),
    possibleRemainingPoints: v.number(),
    rank: v.number(),
    correctPickCount: v.number(),
    tiebreakerPrediction: v.optional(v.number()),
    tiebreakerAbsError: v.optional(v.number()),
    tiebreakerUsable: v.boolean(),
    revisionId: v.id("scoringRevisions"),
    updatedAtMs: v.number(),
  })
    .index("by_poolId_and_week", ["poolId", "week"])
    .index("by_poolId_and_participantId_and_week", [
      "poolId",
      "participantId",
      "week",
    ])
    .index("by_poolId_and_entryId_and_week", ["poolId", "entryId", "week"]),

  /**
   * Season Standing / Survivor eligibility projection — one row per entry.
   * Rebuildable from Verified Results + picks; never an authoritative input.
   * Confidence: seasonPoints/seasonRank advance only from fully resolved weeks.
   */
  seasonStandings: defineTable({
    poolId: v.id("pools"),
    participantId: v.id("participants"),
    entryId: v.optional(v.id("poolEntries")),
    eligibility: v.union(
      v.literal("alive"),
      v.literal("eliminated"),
      v.literal("winner"),
    ),
    eliminatedWeek: v.optional(v.number()),
    eliminationReason: v.optional(
      v.union(
        v.literal("loss"),
        v.literal("tie"),
        v.literal("missing_pick"),
      ),
    ),
    /** Week that established winner designation (sole or joint). */
    wonAtWeek: v.optional(v.number()),
    /** Confidence Season Standing points (sum of fully resolved weeks). */
    seasonPoints: v.optional(v.number()),
    seasonRank: v.optional(v.number()),
    revisionId: v.optional(v.id("scoringRevisions")),
    updatedAtMs: v.number(),
  })
    .index("by_poolId", ["poolId"])
    .index("by_poolId_and_participantId", ["poolId", "participantId"])
    .index("by_poolId_and_entryId", ["poolId", "entryId"]),
});
