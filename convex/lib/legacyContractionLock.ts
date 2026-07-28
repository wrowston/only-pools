import { internal } from "../_generated/api";
import type {
  ActionCtx,
  MutationCtx,
  QueryCtx,
} from "../_generated/server";

export const LEGACY_CONTRACTION_LOCK_ACTION =
  "legacy_contract_migration_locked_v1";

type DatabaseReaderCtx = Pick<QueryCtx | MutationCtx, "db">;

export async function isLegacyContractionLocked(
  ctx: DatabaseReaderCtx,
): Promise<boolean> {
  const lock = await ctx.db
    .query("operatorAuditEvents")
    .withIndex("by_action_and_atMs", (q) =>
      q.eq("action", LEGACY_CONTRACTION_LOCK_ACTION),
    )
    .first();
  return lock !== null;
}

export async function assertLegacyContractionUnlocked(
  ctx: DatabaseReaderCtx,
): Promise<void> {
  if (await isLegacyContractionLocked(ctx)) {
    throw new Error(
      "Legacy contract migration is locked; provider writes are disabled",
    );
  }
}

export async function assertLegacyContractionActionUnlocked(
  ctx: Pick<ActionCtx, "runQuery">,
): Promise<void> {
  const state: { locked: boolean } = await ctx.runQuery(
    internal.legacyContractionMigration.getLockState,
    {},
  );
  if (state.locked) {
    throw new Error(
      "Legacy contract migration is locked; provider actions are disabled",
    );
  }
}
