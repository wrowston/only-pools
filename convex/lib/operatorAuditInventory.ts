import type { MutationCtx, QueryCtx } from "../_generated/server";
import { sha256Fingerprint } from "./providerEvidencePolicy";

export const MAX_PROTECTED_OPERATOR_AUDITS = 500;

type AuditInventoryCtx = Pick<MutationCtx | QueryCtx, "db">;

export type OperatorAuditInventory = Readonly<{
  boundaryAtMs: number;
  count: number;
  fingerprint: string;
}>;

/**
 * Fingerprint every Production Operator audit strictly before the activation
 * request boundary. The strict inequality excludes the request marker itself,
 * so the same inventory can be recomputed after activation.
 */
export async function operatorAuditInventory(
  ctx: AuditInventoryCtx,
  boundaryAtMs: number,
): Promise<OperatorAuditInventory | null> {
  const rows = await ctx.db
    .query("operatorAuditEvents")
    .withIndex("by_atMs", (q) => q.lt("atMs", boundaryAtMs))
    .take(MAX_PROTECTED_OPERATOR_AUDITS + 1);
  if (rows.length > MAX_PROTECTED_OPERATOR_AUDITS) return null;

  const canonical = rows
    .map((row) => ({
      id: String(row._id),
      action: row.action,
      actorTokenIdentifier: row.actorTokenIdentifier,
      actorClerkUserId: row.actorClerkUserId,
      atMs: row.atMs,
      detailsJson: row.detailsJson ?? null,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  return {
    boundaryAtMs,
    count: canonical.length,
    fingerprint: await sha256Fingerprint(JSON.stringify(canonical)),
  };
}
