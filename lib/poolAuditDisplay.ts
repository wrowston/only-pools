type AuditMetadata = Record<string, unknown> | null;

export type PoolAuditEventLike = {
  action: string;
  actorDisplayName?: string | null;
  affectedDisplayName?: string | null;
  metadata: AuditMetadata;
};

const ACTION_LABELS: Record<string, string> = {
  invite_created: "Invite created",
  invite_retrieved: "Invite retrieved",
  invite_rotated: "Invite rotated",
  invite_accepted: "Invite accepted",
  returning_invite_created: "Returning invite created",
  returning_invite_accepted: "Returning invite accepted",
  ownership_transfer_offered: "Ownership transfer offered",
  ownership_transfer_cancelled: "Ownership transfer cancelled",
  ownership_transfer_accepted: "Ownership transfer accepted",
  admin_promoted: "Admin promoted",
  admin_demoted: "Admin demoted",
  member_removed: "Member removed",
  member_reinstated: "Member reinstated",
  member_left: "Member left",
  pool_archived: "Pool archived",
  pool_restored: "Pool restored",
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function roleLabel(value: unknown): string | null {
  const raw = asString(value);
  if (!raw) return null;
  if (raw === "pending_accept") return "pending accept";
  return raw;
}

/**
 * Human-readable Pool Audit title + detail lines for the Pool panel.
 */
export function formatPoolAuditEvent(event: PoolAuditEventLike): {
  title: string;
  details: string[];
} {
  const title = ACTION_LABELS[event.action] ?? event.action.replaceAll("_", " ");
  const meta = event.metadata ?? {};
  const actor = asString(event.actorDisplayName) ?? "Someone";
  const affected = asString(event.affectedDisplayName);
  const priorRole = roleLabel(meta.priorRole);
  const resultingRole = roleLabel(meta.resultingRole);
  const reason = asString(meta.reason);
  const details: string[] = [];

  switch (event.action) {
    case "admin_promoted":
      details.push(
        affected
          ? `${actor} promoted ${affected} from member to admin`
          : `${actor} promoted a member to admin`,
      );
      break;
    case "admin_demoted":
      details.push(
        affected
          ? `${actor} demoted ${affected} from admin to member`
          : `${actor} demoted an admin to member`,
      );
      break;
    case "member_removed":
      details.push(
        affected
          ? `${actor} removed ${affected}${priorRole ? ` (${priorRole})` : ""}`
          : `${actor} removed a participant`,
      );
      if (reason) details.push(`Reason: ${reason}`);
      break;
    case "member_reinstated":
      details.push(
        affected
          ? `${actor} reinstated ${affected} as member`
          : `${actor} reinstated a participant as member`,
      );
      if (reason) details.push(`Reason: ${reason}`);
      break;
    case "member_left":
      details.push(
        affected
          ? `${affected} left the pool${priorRole ? ` (was ${priorRole})` : ""}`
          : `${actor} left the pool`,
      );
      break;
    case "ownership_transfer_offered":
      details.push(
        affected
          ? `${actor} offered ownership to ${affected}`
          : `${actor} offered ownership transfer`,
      );
      break;
    case "ownership_transfer_cancelled":
      details.push(
        affected
          ? `${actor} cancelled the ownership offer to ${affected}`
          : `${actor} cancelled an ownership offer`,
      );
      break;
    case "ownership_transfer_accepted":
      details.push(
        affected
          ? `${affected} accepted ownership from ${actor}`
          : `${actor} accepted ownership`,
      );
      break;
    case "invite_created":
    case "invite_retrieved":
    case "invite_rotated":
    case "returning_invite_created":
      details.push(`${actor} ${title.toLowerCase()}`);
      break;
    case "invite_accepted":
    case "returning_invite_accepted":
      details.push(
        affected
          ? `${affected} accepted an invite`
          : `${actor} accepted an invite`,
      );
      break;
    case "pool_archived":
      details.push(`${actor} archived the pool`);
      if (asString(meta.lifecycleStatus)) {
        details.push(`Lifecycle stayed ${String(meta.lifecycleStatus)}`);
      }
      break;
    case "pool_restored":
      details.push(`${actor} restored the pool`);
      break;
    default:
      details.push(`${actor} performed this action`);
      if (affected) details.push(`Affected: ${affected}`);
      if (priorRole && resultingRole) {
        details.push(`${priorRole} → ${resultingRole}`);
      }
      break;
  }

  return { title, details };
}
