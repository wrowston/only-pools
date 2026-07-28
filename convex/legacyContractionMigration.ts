import { v } from "convex/values";

import {
  env,
  internalQuery,
  mutation,
  type MutationCtx,
} from "./_generated/server";
import {
  requireProductionOperatorWithStepUp,
  type ProductionOperatorActor,
} from "./lib/operatorAuth";
import {
  isLegacyContractionLocked,
  LEGACY_CONTRACTION_LOCK_ACTION,
} from "./lib/legacyContractionLock";

const PROGRESS_ACTION = "legacy_contract_migration_progress_v2";
const CLEAN_ACTIVATION_ACTION = "season_bootstrap_clean_activated";
const DEFAULT_BATCH_SIZE = 25;
export const LEGACY_CONTRACTION_MAX_BATCH_SIZE = 50;
export const LEGACY_CONTRACTION_MAX_BATCH_BYTES_READ =
  4 * 1_024 * 1_024;

const categories = [
  "nflTeams",
  "nflGames",
  "syncWorkItems",
  "providerFetchClaims",
  "operatorIncidents",
  "overrideEvidence",
  "providerEvidence",
] as const;
type Category = (typeof categories)[number];
type Phase = Category | "ready" | "complete";

type CategoryCounts = Readonly<{
  visited: number;
  changed: number;
  preserved: number;
}>;

type Progress = Readonly<{
  version: 2;
  phase: Phase;
  cursor: string | null;
  completedCategories: Readonly<Record<Category, boolean>>;
  counts: Readonly<Record<Category, CategoryCounts>>;
  lastLegacyOverrideLiveId: string | null;
  lastLegacyOverrideConfirmationId: string | null;
  lastLegacyProviderEvidenceId: string | null;
  completed: boolean;
}>;

type BatchAudit = Readonly<{
  category: Category | "completion";
  visited: number;
  removed: number;
  preservedEvidenceRows: number;
  refusalReason?: string;
}>;

type RunResult = Readonly<{
  progress: Progress;
  audit: BatchAudit;
}>;

function emptyCounts(): Record<Category, CategoryCounts> {
  return Object.fromEntries(
    categories.map((category) => [
      category,
      { visited: 0, changed: 0, preserved: 0 },
    ]),
  ) as Record<Category, CategoryCounts>;
}

function initialProgress(): Progress {
  return {
    version: 2,
    phase: "nflTeams",
    cursor: null,
    completedCategories: Object.fromEntries(
      categories.map((category) => [category, false]),
    ) as Record<Category, boolean>,
    counts: emptyCounts(),
    lastLegacyOverrideLiveId: null,
    lastLegacyOverrideConfirmationId: null,
    lastLegacyProviderEvidenceId: null,
    completed: false,
  };
}

function isPhase(value: unknown): value is Phase {
  return (
    typeof value === "string" &&
    ([...categories, "ready", "complete"] as readonly string[]).includes(
      value,
    )
  );
}

function isCount(value: unknown): value is CategoryCounts {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return ["visited", "changed", "preserved"].every(
    (key) =>
      typeof row[key] === "number" &&
      Number.isInteger(row[key]) &&
      (row[key] as number) >= 0,
  );
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function parseProgress(detailsJson: string | undefined): Progress {
  if (!detailsJson) {
    throw new Error("Contraction migration progress audit is missing");
  }
  let value: unknown;
  try {
    value = JSON.parse(detailsJson);
  } catch {
    throw new Error("Contraction migration progress audit is malformed");
  }
  if (!value || typeof value !== "object") {
    throw new Error("Contraction migration progress audit is malformed");
  }
  const row = value as Record<string, unknown>;
  const completed = row.completedCategories as
    | Record<string, unknown>
    | undefined;
  const counts = row.counts as Record<string, unknown> | undefined;
  if (
    row.version !== 2 ||
    !isPhase(row.phase) ||
    !nullableString(row.cursor) ||
    !completed ||
    !counts ||
    !nullableString(row.lastLegacyOverrideLiveId) ||
    !nullableString(row.lastLegacyOverrideConfirmationId) ||
    !nullableString(row.lastLegacyProviderEvidenceId) ||
    typeof row.completed !== "boolean" ||
    categories.some(
      (category) =>
        typeof completed[category] !== "boolean" ||
        !isCount(counts[category]),
    )
  ) {
    throw new Error("Contraction migration progress audit is malformed");
  }
  return {
    version: 2,
    phase: row.phase,
    cursor: row.cursor,
    completedCategories: Object.fromEntries(
      categories.map((category) => [category, completed[category]]),
    ) as Record<Category, boolean>,
    counts: Object.fromEntries(
      categories.map((category) => [category, counts[category]]),
    ) as Record<Category, CategoryCounts>,
    lastLegacyOverrideLiveId: row.lastLegacyOverrideLiveId,
    lastLegacyOverrideConfirmationId:
      row.lastLegacyOverrideConfirmationId,
    lastLegacyProviderEvidenceId: row.lastLegacyProviderEvidenceId,
    completed: row.completed,
  };
}

async function latestProgress(ctx: MutationCtx): Promise<Progress | null> {
  const row = await ctx.db
    .query("operatorAuditEvents")
    .withIndex("by_action_and_atMs", (q) =>
      q.eq("action", PROGRESS_ACTION),
    )
    .order("desc")
    .first();
  return row ? parseProgress(row.detailsJson) : null;
}

async function appendProgress(
  ctx: MutationCtx,
  actor: ProductionOperatorActor,
  progress: Progress,
  batch: BatchAudit,
  atMs: number,
): Promise<void> {
  await ctx.db.insert("operatorAuditEvents", {
    action: PROGRESS_ACTION,
    actorTokenIdentifier: actor.tokenIdentifier,
    actorClerkUserId: actor.clerkUserId,
    atMs,
    detailsJson: JSON.stringify({ ...progress, lastBatch: batch }),
  });
}

function publicResult(
  progress: Progress,
  batch: Pick<BatchAudit, "visited" | "removed">,
  refusalReason?: string,
) {
  return {
    phase: progress.phase,
    visited: batch.visited,
    removed: batch.removed,
    readyToComplete: progress.phase === "ready",
    completed: progress.completed,
    ...(refusalReason ? { refusalReason } : {}),
  };
}

function requestedBatchSize(value: number | undefined): number {
  const size = value ?? DEFAULT_BATCH_SIZE;
  if (
    !Number.isInteger(size) ||
    size < 1 ||
    size > LEGACY_CONTRACTION_MAX_BATCH_SIZE
  ) {
    throw new Error(
      `Migration batchSize must be an integer from 1 to ${LEGACY_CONTRACTION_MAX_BATCH_SIZE}`,
    );
  }
  return size;
}

function paginationOptions(progress: Progress, size: number) {
  return {
    numItems: size,
    cursor: progress.cursor,
    maximumRowsRead: size,
    maximumBytesRead: LEGACY_CONTRACTION_MAX_BATCH_BYTES_READ,
  };
}

function nextPhase(category: Category): Phase {
  const index = categories.indexOf(category);
  return categories[index + 1] ?? "ready";
}

function advance(
  progress: Progress,
  category: Category,
  continueCursor: string,
  isDone: boolean,
  counts: CategoryCounts,
): Progress {
  return {
    ...progress,
    phase: isDone ? nextPhase(category) : category,
    cursor: isDone ? null : continueCursor,
    completedCategories: {
      ...progress.completedCategories,
      [category]: isDone,
    },
    counts: {
      ...progress.counts,
      [category]: counts,
    },
  };
}

function batchAudit(
  category: Category,
  visited: number,
  changed: number,
  preserved = 0,
): BatchAudit {
  return {
    category,
    visited,
    removed: changed,
    preservedEvidenceRows: preserved,
  };
}

async function runTeams(
  ctx: MutationCtx,
  progress: Progress,
  size: number,
): Promise<RunResult> {
  const page = await ctx.db
    .query("nflTeams")
    .paginate(paginationOptions(progress, size));
  let changed = 0;
  for (const row of page.page) {
    if (row.sportsDbTeamId !== undefined) {
      await ctx.db.patch(row._id, { sportsDbTeamId: undefined });
      changed += 1;
    }
  }
  const prior = progress.counts.nflTeams;
  return {
    progress: advance(
      progress,
      "nflTeams",
      page.continueCursor,
      page.isDone,
      {
        visited: prior.visited + page.page.length,
        changed: prior.changed + changed,
        preserved: prior.preserved,
      },
    ),
    audit: batchAudit("nflTeams", page.page.length, changed),
  };
}

async function runGames(
  ctx: MutationCtx,
  progress: Progress,
  size: number,
): Promise<RunResult> {
  const page = await ctx.db
    .query("nflGames")
    .paginate(paginationOptions(progress, size));
  let changed = 0;
  for (const row of page.page) {
    const incompatible =
      row.sportsDbEventId !== undefined ||
      row.resultAuthority === "confirmation_pending" ||
      row.provisionalTerminalAtMs !== undefined ||
      row.confirmationObservations !== undefined;
    if (!incompatible) continue;
    await ctx.db.patch(row._id, {
      sportsDbEventId: undefined,
      resultAuthority:
        row.resultAuthority === "confirmation_pending"
          ? "projected"
          : row.resultAuthority,
      provisionalTerminalAtMs: undefined,
      confirmationObservations: undefined,
    });
    changed += 1;
  }
  const prior = progress.counts.nflGames;
  return {
    progress: advance(
      progress,
      "nflGames",
      page.continueCursor,
      page.isDone,
      {
        visited: prior.visited + page.page.length,
        changed: prior.changed + changed,
        preserved: prior.preserved,
      },
    ),
    audit: batchAudit("nflGames", page.page.length, changed),
  };
}

async function runSyncWorkItems(
  ctx: MutationCtx,
  progress: Progress,
  size: number,
): Promise<RunResult> {
  const page = await ctx.db
    .query("syncWorkItems")
    .paginate(paginationOptions(progress, size));
  let changed = 0;
  for (const row of page.page) {
    if (
      row.surface === "confirmation" ||
      row.priority === "confirmation"
    ) {
      await ctx.db.delete(row._id);
      changed += 1;
    }
  }
  const prior = progress.counts.syncWorkItems;
  return {
    progress: advance(
      progress,
      "syncWorkItems",
      page.continueCursor,
      page.isDone,
      {
        visited: prior.visited + page.page.length,
        changed: prior.changed + changed,
        preserved: prior.preserved,
      },
    ),
    audit: batchAudit("syncWorkItems", page.page.length, changed),
  };
}

async function runProviderFetchClaims(
  ctx: MutationCtx,
  progress: Progress,
  size: number,
): Promise<RunResult> {
  const page = await ctx.db
    .query("providerFetchClaims")
    .paginate(paginationOptions(progress, size));
  let changed = 0;
  for (const row of page.page) {
    if (
      row.surface === "confirmation" ||
      row.priority === "confirmation"
    ) {
      await ctx.db.delete(row._id);
      changed += 1;
    }
  }
  const prior = progress.counts.providerFetchClaims;
  return {
    progress: advance(
      progress,
      "providerFetchClaims",
      page.continueCursor,
      page.isDone,
      {
        visited: prior.visited + page.page.length,
        changed: prior.changed + changed,
        preserved: prior.preserved,
      },
    ),
    audit: batchAudit("providerFetchClaims", page.page.length, changed),
  };
}

async function runOperatorIncidents(
  ctx: MutationCtx,
  progress: Progress,
  size: number,
): Promise<RunResult> {
  const page = await ctx.db
    .query("operatorIncidents")
    .paginate(paginationOptions(progress, size));
  let changed = 0;
  for (const row of page.page) {
    if (row.type === "quarantine_past_confirmation") {
      await ctx.db.delete(row._id);
      changed += 1;
    }
  }
  const prior = progress.counts.operatorIncidents;
  return {
    progress: advance(
      progress,
      "operatorIncidents",
      page.continueCursor,
      page.isDone,
      {
        visited: prior.visited + page.page.length,
        changed: prior.changed + changed,
        preserved: prior.preserved,
      },
    ),
    audit: batchAudit("operatorIncidents", page.page.length, changed),
  };
}

async function runOverrideEvidence(
  ctx: MutationCtx,
  progress: Progress,
  size: number,
): Promise<RunResult> {
  const page = await ctx.db
    .query("nflGameResultOverrideEvidence")
    .paginate(paginationOptions(progress, size));
  let lastLive = progress.lastLegacyOverrideLiveId;
  let lastConfirmation =
    progress.lastLegacyOverrideConfirmationId;
  for (const row of page.page) {
    if (row.source === "legacy_live") lastLive = String(row._id);
    if (row.source === "legacy_confirmation") {
      lastConfirmation = String(row._id);
    }
  }
  const prior = progress.counts.overrideEvidence;
  const next = advance(
    progress,
    "overrideEvidence",
    page.continueCursor,
    page.isDone,
    {
      visited: prior.visited + page.page.length,
      changed: prior.changed,
      preserved: prior.preserved + page.page.length,
    },
  );
  return {
    progress: {
      ...next,
      lastLegacyOverrideLiveId: lastLive,
      lastLegacyOverrideConfirmationId: lastConfirmation,
    },
    audit: batchAudit(
      "overrideEvidence",
      page.page.length,
      0,
      page.page.length,
    ),
  };
}

async function runProviderEvidence(
  ctx: MutationCtx,
  progress: Progress,
  size: number,
): Promise<RunResult> {
  const page = await ctx.db
    .query("providerGameEvidence")
    .paginate(paginationOptions(progress, size));
  let lastLegacy = progress.lastLegacyProviderEvidenceId;
  for (const row of page.page) {
    if (row.provider === "legacy") lastLegacy = String(row._id);
  }
  const prior = progress.counts.providerEvidence;
  const next = advance(
    progress,
    "providerEvidence",
    page.continueCursor,
    page.isDone,
    {
      visited: prior.visited + page.page.length,
      changed: prior.changed,
      preserved: prior.preserved + page.page.length,
    },
  );
  return {
    progress: {
      ...next,
      lastLegacyProviderEvidenceId: lastLegacy,
    },
    audit: batchAudit(
      "providerEvidence",
      page.page.length,
      0,
      page.page.length,
    ),
  };
}

async function runCategory(
  ctx: MutationCtx,
  progress: Progress,
  size: number,
): Promise<RunResult> {
  switch (progress.phase) {
    case "nflTeams":
      return await runTeams(ctx, progress, size);
    case "nflGames":
      return await runGames(ctx, progress, size);
    case "syncWorkItems":
      return await runSyncWorkItems(ctx, progress, size);
    case "providerFetchClaims":
      return await runProviderFetchClaims(ctx, progress, size);
    case "operatorIncidents":
      return await runOperatorIncidents(ctx, progress, size);
    case "overrideEvidence":
      return await runOverrideEvidence(ctx, progress, size);
    case "providerEvidence":
      return await runProviderEvidence(ctx, progress, size);
    default:
      throw new Error("Migration category is not runnable");
  }
}

async function requireCleanActivation(ctx: MutationCtx) {
  const activation = await ctx.db
    .query("operatorAuditEvents")
    .withIndex("by_action_and_atMs", (q) =>
      q.eq("action", CLEAN_ACTIVATION_ACTION),
    )
    .order("desc")
    .first();
  if (!activation) {
    throw new Error(
      "A successful clean Season Bootstrap activation is required before contraction",
    );
  }
  return activation;
}

async function establishLock(
  ctx: MutationCtx,
  actor: ProductionOperatorActor,
  atMs: number,
): Promise<void> {
  if (await isLegacyContractionLocked(ctx)) return;
  const activation = await requireCleanActivation(ctx);
  const gate = await ctx.db
    .query("syncGate")
    .withIndex("by_key", (q) => q.eq("key", "deployment"))
    .unique();
  if (gate) {
    await ctx.db.patch(gate._id, {
      enabled: false,
      updatedAtMs: atMs,
      updatedByTokenIdentifier: actor.tokenIdentifier,
    });
  } else {
    await ctx.db.insert("syncGate", {
      key: "deployment",
      enabled: false,
      updatedAtMs: atMs,
      updatedByTokenIdentifier: actor.tokenIdentifier,
    });
  }
  await ctx.db.insert("operatorAuditEvents", {
    action: LEGACY_CONTRACTION_LOCK_ACTION,
    actorTokenIdentifier: actor.tokenIdentifier,
    actorClerkUserId: actor.clerkUserId,
    atMs,
    detailsJson: JSON.stringify({
      cleanActivationAuditId: activation._id,
      cleanActivationAtMs: activation.atMs,
      syncGateForcedOff: true,
    }),
  });
}

function restart(progress: Progress, phase: Category): Progress {
  const restartAt = categories.indexOf(phase);
  const completedCategories = { ...progress.completedCategories };
  const counts = { ...progress.counts };
  for (const category of categories.slice(restartAt)) {
    completedCategories[category] = false;
    counts[category] = { visited: 0, changed: 0, preserved: 0 };
  }
  return {
    ...progress,
    phase,
    cursor: null,
    completedCategories,
    counts,
    lastLegacyOverrideLiveId:
      restartAt <= categories.indexOf("overrideEvidence")
        ? null
        : progress.lastLegacyOverrideLiveId,
    lastLegacyOverrideConfirmationId:
      restartAt <= categories.indexOf("overrideEvidence")
        ? null
        : progress.lastLegacyOverrideConfirmationId,
    lastLegacyProviderEvidenceId:
      restartAt <= categories.indexOf("providerEvidence")
        ? null
        : progress.lastLegacyProviderEvidenceId,
    completed: false,
  };
}

async function latestLegacyOverrideId(
  ctx: MutationCtx,
  source: "legacy_live" | "legacy_confirmation",
): Promise<string | null> {
  const row = await ctx.db
    .query("nflGameResultOverrideEvidence")
    .withIndex("by_source", (q) => q.eq("source", source))
    .order("desc")
    .first();
  return row ? String(row._id) : null;
}

async function latestLegacyProviderEvidenceId(
  ctx: MutationCtx,
): Promise<string | null> {
  const row = await ctx.db
    .query("providerGameEvidence")
    .withIndex("by_provider", (q) => q.eq("provider", "legacy"))
    .order("desc")
    .first();
  return row ? String(row._id) : null;
}

async function residueCategory(
  ctx: MutationCtx,
  progress: Progress,
): Promise<{ category: Category; reason: string } | null> {
  const team = await ctx.db
    .query("nflTeams")
    .withIndex("by_sportsDbTeamId")
    .order("desc")
    .first();
  if (team?.sportsDbTeamId !== undefined) {
    return { category: "nflTeams", reason: "legacy_owner_fields_remaining" };
  }
  const [gameOwner, confirmationGame, provisionalGame] =
    await Promise.all([
      ctx.db
        .query("nflGames")
        .withIndex("by_sportsDbEventId")
        .order("desc")
        .first(),
      ctx.db
        .query("nflGames")
        .withIndex("by_resultAuthority", (q) =>
          q.eq("resultAuthority", "confirmation_pending"),
        )
        .first(),
      ctx.db
        .query("nflGames")
        .withIndex("by_provisionalTerminalAtMs")
        .order("desc")
        .first(),
    ]);
  if (
    gameOwner?.sportsDbEventId !== undefined ||
    confirmationGame ||
    provisionalGame?.provisionalTerminalAtMs !== undefined
  ) {
    return { category: "nflGames", reason: "legacy_game_state_remaining" };
  }
  const [confirmationSurfaceWork, confirmationPriorityWork] =
    await Promise.all([
      ctx.db
        .query("syncWorkItems")
        .withIndex("by_surface", (q) =>
          q.eq("surface", "confirmation"),
        )
        .first(),
      ctx.db
        .query("syncWorkItems")
        .withIndex("by_priority", (q) =>
          q.eq("priority", "confirmation"),
        )
        .first(),
    ]);
  if (confirmationSurfaceWork || confirmationPriorityWork) {
    return {
      category: "syncWorkItems",
      reason: "confirmation_work_remaining",
    };
  }
  const [confirmationSurfaceClaim, confirmationPriorityClaim] =
    await Promise.all([
      ctx.db
        .query("providerFetchClaims")
        .withIndex("by_surface", (q) =>
          q.eq("surface", "confirmation"),
        )
        .first(),
      ctx.db
        .query("providerFetchClaims")
        .withIndex("by_priority", (q) =>
          q.eq("priority", "confirmation"),
        )
        .first(),
    ]);
  if (confirmationSurfaceClaim || confirmationPriorityClaim) {
    return {
      category: "providerFetchClaims",
      reason: "confirmation_claims_remaining",
    };
  }
  const quarantine = await ctx.db
    .query("operatorIncidents")
    .withIndex("by_type", (q) =>
      q.eq("type", "quarantine_past_confirmation"),
    )
    .first();
  if (quarantine) {
    return {
      category: "operatorIncidents",
      reason: "confirmation_incidents_remaining",
    };
  }
  const [latestLive, latestConfirmation, latestProvider] =
    await Promise.all([
      latestLegacyOverrideId(ctx, "legacy_live"),
      latestLegacyOverrideId(ctx, "legacy_confirmation"),
      latestLegacyProviderEvidenceId(ctx),
    ]);
  if (
    latestLive !== progress.lastLegacyOverrideLiveId ||
    latestConfirmation !== progress.lastLegacyOverrideConfirmationId
  ) {
    return {
      category: "overrideEvidence",
      reason: "post_audit_legacy_evidence",
    };
  }
  if (latestProvider !== progress.lastLegacyProviderEvidenceId) {
    return {
      category: "providerEvidence",
      reason: "post_audit_legacy_evidence",
    };
  }
  return null;
}

async function currentProgressWithAuditRestart(
  ctx: MutationCtx,
  progress: Progress,
): Promise<{ progress: Progress; refusalReason?: string }> {
  if (progress.phase !== "ready" && progress.phase !== "complete") {
    return { progress };
  }
  if (progress.phase === "complete") {
    return {
      progress: restart(progress, "nflTeams"),
      refusalReason: "post_completion_reaudit",
    };
  }
  const residue = await residueCategory(ctx, progress);
  return residue
    ? {
        progress: restart(progress, residue.category),
        refusalReason: residue.reason,
      }
    : { progress };
}

export const getLockState = internalQuery({
  args: {},
  handler: async (ctx) => ({
    locked: await isLegacyContractionLocked(ctx),
  }),
});

export const runBatch = mutation({
  args: { batchSize: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const atMs = Date.now();
    const actor = await requireProductionOperatorWithStepUp(ctx, atMs, env);
    const size = requestedBatchSize(args.batchSize);
    let progress = await latestProgress(ctx);
    if (!progress) {
      await establishLock(ctx, actor, atMs);
      progress = initialProgress();
    } else if (!(await isLegacyContractionLocked(ctx))) {
      throw new Error("Contraction progress exists without its durable lock");
    }

    const audited = await currentProgressWithAuditRestart(ctx, progress);
    progress = audited.progress;
    if (progress.phase === "ready" || progress.phase === "complete") {
      if (audited.refusalReason) {
        const audit: BatchAudit = {
          category: "completion",
          visited: 0,
          removed: 0,
          preservedEvidenceRows: 0,
          refusalReason: audited.refusalReason,
        };
        await appendProgress(ctx, actor, progress, audit, atMs);
      }
      return publicResult(
        progress,
        { visited: 0, removed: 0 },
        audited.refusalReason,
      );
    }

    const batch = await runCategory(ctx, progress, size);
    await appendProgress(ctx, actor, batch.progress, batch.audit, atMs);
    return publicResult(
      batch.progress,
      batch.audit,
      audited.refusalReason,
    );
  },
});

export const complete = mutation({
  args: {},
  handler: async (ctx) => {
    const atMs = Date.now();
    const actor = await requireProductionOperatorWithStepUp(ctx, atMs, env);
    const existing = await latestProgress(ctx);
    if (!existing) {
      await establishLock(ctx, actor, atMs);
    } else if (!(await isLegacyContractionLocked(ctx))) {
      throw new Error("Contraction progress exists without its durable lock");
    }
    const progress = existing ?? initialProgress();
    if (progress.phase === "complete") {
      const restarted = restart(progress, "nflTeams");
      const audit: BatchAudit = {
        category: "completion",
        visited: 0,
        removed: 0,
        preservedEvidenceRows: 0,
        refusalReason: "post_completion_reaudit",
      };
      await appendProgress(ctx, actor, restarted, audit, atMs);
      return publicResult(restarted, audit, "post_completion_reaudit");
    }
    if (progress.phase !== "ready") {
      const audit: BatchAudit = {
        category: "completion",
        visited: 0,
        removed: 0,
        preservedEvidenceRows: 0,
        refusalReason: "categories_not_traversed",
      };
      await appendProgress(ctx, actor, progress, audit, atMs);
      return publicResult(
        progress,
        audit,
        "categories_not_traversed",
      );
    }
    const residue = await residueCategory(ctx, progress);
    if (residue) {
      const restarted = restart(progress, residue.category);
      const audit: BatchAudit = {
        category: "completion",
        visited: 0,
        removed: 0,
        preservedEvidenceRows: 0,
        refusalReason: residue.reason,
      };
      await appendProgress(ctx, actor, restarted, audit, atMs);
      return publicResult(restarted, audit, residue.reason);
    }
    const completed: Progress = {
      ...progress,
      phase: "complete",
      cursor: null,
      completed: true,
    };
    const audit: BatchAudit = {
      category: "completion",
      visited: 0,
      removed: 0,
      preservedEvidenceRows:
        completed.counts.overrideEvidence.preserved +
        completed.counts.providerEvidence.preserved,
    };
    await appendProgress(ctx, actor, completed, audit, atMs);
    return publicResult(completed, audit);
  },
});
