import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  MAX_ENTRIES_PER_USER,
  MAX_POOL_ENTRIES,
  effectiveMaxEntriesPerUser,
} from "./quotas";

type DbCtx = QueryCtx | MutationCtx;

export class PoolEntryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PoolEntryError";
  }
}

export function poolMaxEntriesPerUser(pool: Doc<"pools">): number {
  return effectiveMaxEntriesPerUser(pool.maxEntriesPerUser);
}

/**
 * Label for standings/board. `displayIndex` is 1-based among that
 * participant's currently active lines (not the durable entryNumber).
 */
export function entryDisplayName(
  participantDisplayName: string,
  displayIndex: number,
): string {
  if (displayIndex <= 1) return participantDisplayName;
  return `${participantDisplayName} (${displayIndex})`;
}

/** Map entryId → 1-based display index among each participant's active entries. */
export function displayIndexByEntryId(
  entries: Array<{ _id: Id<"poolEntries">; participantId: Id<"participants">; entryNumber: number }>,
): Map<string, number> {
  const byParticipant = new Map<string, typeof entries>();
  for (const entry of entries) {
    const key = entry.participantId as string;
    const list = byParticipant.get(key) ?? [];
    list.push(entry);
    byParticipant.set(key, list);
  }
  const result = new Map<string, number>();
  for (const list of byParticipant.values()) {
    list.sort((a, b) => a.entryNumber - b.entryNumber);
    list.forEach((entry, i) => {
      result.set(entry._id, i + 1);
    });
  }
  return result;
}

export async function countActivePoolEntries(
  ctx: DbCtx,
  poolId: Id<"pools">,
): Promise<number> {
  const rows = await ctx.db
    .query("poolEntries")
    .withIndex("by_poolId_and_status", (q) =>
      q.eq("poolId", poolId).eq("status", "active"),
    )
    .take(MAX_POOL_ENTRIES + 1);
  return rows.length;
}

export async function listActiveEntriesForParticipant(
  ctx: DbCtx,
  poolId: Id<"pools">,
  participantId: Id<"participants">,
): Promise<Doc<"poolEntries">[]> {
  const rows = await ctx.db
    .query("poolEntries")
    .withIndex("by_poolId_and_participantId", (q) =>
      q.eq("poolId", poolId).eq("participantId", participantId),
    )
    .take(MAX_ENTRIES_PER_USER);
  return rows
    .filter((row) => row.status === "active")
    .sort((a, b) => a.entryNumber - b.entryNumber);
}

export async function listActivePoolEntries(
  ctx: DbCtx,
  poolId: Id<"pools">,
): Promise<Doc<"poolEntries">[]> {
  return await ctx.db
    .query("poolEntries")
    .withIndex("by_poolId_and_status", (q) =>
      q.eq("poolId", poolId).eq("status", "active"),
    )
    .take(MAX_POOL_ENTRIES);
}

export async function nextEntryNumber(
  ctx: DbCtx,
  poolId: Id<"pools">,
  participantId: Id<"participants">,
): Promise<number> {
  const rows = await ctx.db
    .query("poolEntries")
    .withIndex("by_poolId_and_participantId", (q) =>
      q.eq("poolId", poolId).eq("participantId", participantId),
    )
    .take(MAX_ENTRIES_PER_USER + 5);
  let max = 0;
  for (const row of rows) {
    if (row.entryNumber > max) max = row.entryNumber;
  }
  return max + 1;
}

/**
 * Create the primary competitive entry for a new/reactivated membership.
 */
export async function createPrimaryEntry(
  ctx: MutationCtx,
  args: {
    poolId: Id<"pools">;
    participantId: Id<"participants">;
    membershipId: Id<"poolMemberships">;
    nowMs: number;
  },
): Promise<Id<"poolEntries">> {
  const poolEntryCount = await countActivePoolEntries(ctx, args.poolId);
  if (poolEntryCount >= MAX_POOL_ENTRIES) {
    throw new PoolEntryError(
      `This Pool has reached its entry limit (${MAX_POOL_ENTRIES})`,
    );
  }
  const entryNumber = await nextEntryNumber(
    ctx,
    args.poolId,
    args.participantId,
  );
  return await ctx.db.insert("poolEntries", {
    poolId: args.poolId,
    participantId: args.participantId,
    membershipId: args.membershipId,
    entryNumber,
    status: "active",
    createdAtMs: args.nowMs,
  });
}

export async function endActiveEntriesForParticipant(
  ctx: MutationCtx,
  args: {
    poolId: Id<"pools">;
    participantId: Id<"participants">;
    nowMs: number;
  },
): Promise<void> {
  const active = await listActiveEntriesForParticipant(
    ctx,
    args.poolId,
    args.participantId,
  );
  for (const entry of active) {
    await ctx.db.patch(entry._id, {
      status: "ended",
      endedAtMs: args.nowMs,
    });
  }
}

export async function entryHasAnyPicks(
  ctx: DbCtx,
  entryId: Id<"poolEntries">,
): Promise<boolean> {
  const survivor = await ctx.db
    .query("survivorPicks")
    .withIndex("by_entryId", (q) => q.eq("entryId", entryId))
    .take(1);
  if (survivor.length > 0) return true;
  const confidence = await ctx.db
    .query("confidencePickSets")
    .withIndex("by_entryId", (q) => q.eq("entryId", entryId))
    .take(1);
  return confidence.length > 0;
}

/**
 * Backfill a primary entry for legacy memberships that predate poolEntries.
 */
export async function ensurePrimaryEntryIfMissing(
  ctx: MutationCtx,
  args: {
    poolId: Id<"pools">;
    participantId: Id<"participants">;
    membershipId: Id<"poolMemberships">;
    nowMs: number;
  },
): Promise<Doc<"poolEntries">> {
  const active = await listActiveEntriesForParticipant(
    ctx,
    args.poolId,
    args.participantId,
  );
  if (active[0]) return active[0];
  const entryId = await createPrimaryEntry(ctx, args);
  const created = await ctx.db.get(entryId);
  if (!created) throw new PoolEntryError("Failed to create entry");
  return created;
}

/**
 * Resolve the competitive entry for pick/scoring operations.
 * When entryId is omitted, uses the sole active entry (single-entry pools).
 */
export async function requireOwnedActiveEntry(
  ctx: DbCtx,
  args: {
    poolId: Id<"pools">;
    participantId: Id<"participants">;
    entryId?: Id<"poolEntries">;
  },
): Promise<Doc<"poolEntries">> {
  if (args.entryId !== undefined) {
    const entry = await ctx.db.get(args.entryId);
    if (
      !entry ||
      entry.poolId !== args.poolId ||
      entry.participantId !== args.participantId ||
      entry.status !== "active"
    ) {
      throw new PoolEntryError("Entry not found");
    }
    return entry;
  }

  const active = await listActiveEntriesForParticipant(
    ctx,
    args.poolId,
    args.participantId,
  );
  if (active.length === 0) {
    throw new PoolEntryError("No active entry in this Pool");
  }
  if (active.length > 1) {
    throw new PoolEntryError("entryId is required when you have multiple entries");
  }
  return active[0]!;
}

export function assertValidMaxEntriesPerUser(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > MAX_ENTRIES_PER_USER) {
    throw new PoolEntryError(
      `maxEntriesPerUser must be an integer from 1 to ${MAX_ENTRIES_PER_USER}`,
    );
  }
}
