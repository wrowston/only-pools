import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  generateInviteToken,
  hashInviteCredential,
  inviteUrlFromToken,
} from "./inviteCrypto";

/** Ordinary Pool Invite credential TTL (30 days). */
export const ORDINARY_INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Mint a fresh ordinary Pool Invite for a newly created pool and audit it.
 * Returns the relative `/join/...` URL once; later retrieve/rotate still
 * requires step-up via createOrRetrieveInvite / rotateInvite.
 */
export async function mintOrdinaryPoolInvite(
  ctx: MutationCtx,
  args: {
    poolId: Id<"pools">;
    createdByParticipantId: Id<"participants">;
    nowMs: number;
  },
): Promise<{ inviteId: Id<"poolInvites">; url: string; expiresAtMs: number }> {
  const rawToken = generateInviteToken();
  const credentialHash = await hashInviteCredential(rawToken);
  const expiresAtMs = args.nowMs + ORDINARY_INVITE_TTL_MS;
  const inviteId = await ctx.db.insert("poolInvites", {
    poolId: args.poolId,
    credentialHash,
    credentialSecret: rawToken,
    status: "active",
    expiresAtMs,
    createdByParticipantId: args.createdByParticipantId,
    createdAtMs: args.nowMs,
  });

  await ctx.db.insert("poolAuditEvents", {
    poolId: args.poolId,
    actorParticipantId: args.createdByParticipantId,
    action: "invite_created",
    atMs: args.nowMs,
    metadataJson: JSON.stringify({ inviteId }),
  });

  return {
    inviteId,
    url: inviteUrlFromToken(rawToken),
    expiresAtMs,
  };
}
