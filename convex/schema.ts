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
    usableStartWeek: v.optional(v.number()),
    bootstrappedAtMs: v.optional(v.number()),
  })
    .index("by_status", ["status"])
    .index("by_label", ["label"]),

  /** Provider-independent NFL Team identity. SportsDB ids are aliases only. */
  nflTeams: defineTable({
    stableKey: v.string(),
    name: v.string(),
    abbreviation: v.string(),
    sportsDbTeamId: v.string(),
  })
    .index("by_stableKey", ["stableKey"])
    .index("by_sportsDbTeamId", ["sportsDbTeamId"]),

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
    /** Last observed / projected scores — never official until verified. */
    homeScore: v.union(v.number(), v.null()),
    awayScore: v.union(v.number(), v.null()),
    sportsDbEventId: v.string(),
    /**
     * Result authority. Absent / "none" until live or terminal evidence arrives.
     * Provisional finals are confirmation_pending — never official.
     */
    resultAuthority: v.optional(
      v.union(
        v.literal("none"),
        v.literal("projected"),
        v.literal("confirmation_pending"),
        v.literal("verified"),
        v.literal("correction_candidate"),
      ),
    ),
    provisionalTerminalAtMs: v.optional(v.number()),
    confirmationObservations: v.optional(
      v.array(
        v.object({
          observedAtMs: v.number(),
          homeScore: v.number(),
          awayScore: v.number(),
          status: v.union(
            v.literal("FT"),
            v.literal("AOT"),
            v.literal("CANC"),
          ),
        }),
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
    lastObservedAtMs: v.optional(v.number()),
    revision: v.optional(v.number()),
  })
    .index("by_stableKey", ["stableKey"])
    .index("by_seasonId_and_week", ["seasonId", "week"])
    .index("by_sportsDbEventId", ["sportsDbEventId"])
    .index("by_seasonId", ["seasonId"]),

  /**
   * Active Pool competitive container. Pool Type and Pool Season are immutable
   * after create; Start Week / Pick Lock mode freeze via rulesFrozen.
   */
  pools: defineTable({
    name: v.string(),
    type: poolType,
    seasonId: v.id("poolSeasons"),
    startWeek: v.number(),
    pickLockMode: pickLockMode,
    status: v.union(v.literal("active"), v.literal("completed")),
    /** True after first accepted competitive edit or first Pick Lock. */
    rulesFrozen: v.boolean(),
    ownerParticipantId: v.id("participants"),
    createdAtMs: v.number(),
    /**
     * Latched when membership admission first closes (Start Week earliest
     * kickoff reached). A later reschedule never clears this — admission
     * never reopens.
     */
    admissionClosedAtMs: v.optional(v.number()),
    /** Set when Survivor (or later Confidence) reaches a terminal outcome. */
    completedAtMs: v.optional(v.number()),
    completedWeek: v.optional(v.number()),
  })
    .index("by_ownerParticipantId", ["ownerParticipantId"])
    .index("by_seasonId", ["seasonId"]),

  /** One membership document per (pool, participant). */
  poolMemberships: defineTable({
    poolId: v.id("pools"),
    participantId: v.id("participants"),
    role: membershipRole,
    status: v.literal("active"),
  })
    .index("by_participantId", ["participantId"])
    .index("by_poolId", ["poolId"])
    .index("by_poolId_and_participantId", ["poolId", "participantId"]),

  /**
   * Deployment Sync Gate singleton (key = "deployment").
   * Dev defaults OFF; Production defaults ON after Season Bootstrap.
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
        v.literal("confirmation"),
        v.literal("operator"),
      ),
    ),
    workItemId: v.optional(v.id("syncWorkItems")),
  }).index("by_claimedAtMs", ["claimedAtMs"]),

  /**
   * Durable sync work queue — schedule, live, confirmation, correction, operator.
   * Coalesced by surface + scopeKey; dispatcher claims due items under budget.
   */
  syncWorkItems: defineTable({
    surface: v.union(
      v.literal("schedule"),
      v.literal("live"),
      v.literal("confirmation"),
      v.literal("correction"),
      v.literal("operator"),
    ),
    scopeKey: v.string(),
    priority: v.union(
      v.literal("routine"),
      v.literal("confirmation"),
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
    seasonId: v.optional(v.id("poolSeasons")),
    purpose: v.optional(v.string()),
  })
    .index("by_status_and_dueAtMs", ["status", "dueAtMs"])
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
   * Provider Exception records for later Operator Incident wiring (ticket 13).
   * Distinguishable from Late / Stale freshness states.
   */
  providerExceptions: defineTable({
    kind: v.string(),
    gameId: v.optional(v.id("nflGames")),
    scopeKey: v.string(),
    message: v.string(),
    createdAtMs: v.number(),
    resolvedAtMs: v.optional(v.number()),
  })
    .index("by_createdAtMs", ["createdAtMs"])
    .index("by_gameId", ["gameId"]),

  /**
   * Survivor Pick — one team per participant per included week.
   * Unlocked rows are Hidden Picks: never expose nflTeamId to non-authors.
   */
  survivorPicks: defineTable({
    poolId: v.id("pools"),
    participantId: v.id("participants"),
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
     * Set when earlier elimination invalidates a later Provisional Survivor
     * Pick — team reservation is released and the team is not consumed.
     */
    invalidated: v.optional(v.boolean()),
    invalidatedAtMs: v.optional(v.number()),
    updatedAtMs: v.number(),
  })
    .index("by_poolId_and_participantId_and_week", [
      "poolId",
      "participantId",
      "week",
    ])
    .index("by_poolId_and_week", ["poolId", "week"])
    .index("by_poolId_and_participantId", ["poolId", "participantId"]),

  /**
   * One-use team reservation for Survivor. Unlocked pick changes release the
   * prior reservation and reserve the new team. Locked / still-valid picks
   * keep released=false.
   */
  survivorTeamReservations: defineTable({
    poolId: v.id("pools"),
    participantId: v.id("participants"),
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
    .index("by_poolId_and_participantId", ["poolId", "participantId"]),

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
   * Per-participant Confidence Pick Set for one Pool Week.
   * origin=untouched until first accepted edit or Automatic materialization.
   */
  confidencePickSets: defineTable({
    poolId: v.id("pools"),
    participantId: v.id("participants"),
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
    .index("by_poolId_and_week", ["poolId", "week"]),

  /**
   * One Required Confidence Game row within a Confidence Pick Set.
   * Unlocked predictions are Hidden Picks — never expose to non-authors.
   */
  confidencePicks: defineTable({
    poolId: v.id("pools"),
    participantId: v.id("participants"),
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
    .index("by_poolId_and_week_and_gameId", ["poolId", "week", "gameId"])
    .index("by_poolId_and_week", ["poolId", "week"]),

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
  }).index("by_poolId_and_week", ["poolId", "week"]),

  /**
   * Immutable official Scoring Revision for one Pool Week.
   * Identical authoritative input fingerprint is an idempotent no-op.
   */
  scoringRevisions: defineTable({
    poolId: v.id("pools"),
    week: v.number(),
    kind: v.literal("survivor"),
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
    week: v.number(),
    pickId: v.optional(v.id("survivorPicks")),
    outcome: v.union(
      v.literal("win"),
      v.literal("loss"),
      v.literal("tie"),
      v.literal("missing_pick"),
      v.literal("pending"),
      v.literal("invalidated"),
    ),
    revisionId: v.id("scoringRevisions"),
    updatedAtMs: v.number(),
  })
    .index("by_poolId_and_week", ["poolId", "week"])
    .index("by_poolId_and_participantId_and_week", [
      "poolId",
      "participantId",
      "week",
    ]),

  /**
   * Season Standing / Survivor eligibility projection — one row per member.
   * Rebuildable from Verified Results + picks; never an authoritative input.
   */
  seasonStandings: defineTable({
    poolId: v.id("pools"),
    participantId: v.id("participants"),
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
    revisionId: v.optional(v.id("scoringRevisions")),
    updatedAtMs: v.number(),
  })
    .index("by_poolId", ["poolId"])
    .index("by_poolId_and_participantId", ["poolId", "participantId"]),
});
