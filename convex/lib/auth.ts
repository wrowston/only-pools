import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  emailFromIdentity,
  emailVerifiedFromIdentity,
  phoneFromIdentity,
  phoneVerifiedFromIdentity,
  pickString,
} from "./identityClaims";
import {
  evaluateVerificationGate,
  type VerificationClaims,
} from "./verificationGate";

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

type AuthCtx = QueryCtx | MutationCtx;

export type IdentityClaims = VerificationClaims & {
  tokenIdentifier: string;
  clerkUserId: string;
  displayName: string;
  email?: string;
  phone?: string;
  avatarUrl?: string;
  /** Clerk session id (`sid`) when present on the JWT. */
  clerkSessionId: string | null;
};

/**
 * Map Clerk JWT identity into verification claims.
 *
 * Email / phone verification come from Clerk JWT claims.
 * Age 18+ is attested by account creation (no separate confirmation gate).
 */
export function claimsFromIdentity(
  identity: Record<string, unknown> & {
    tokenIdentifier: string;
    subject: string;
  },
): IdentityClaims {
  const clerkSessionId =
    (typeof identity.sid === "string" && identity.sid) ||
    (typeof identity.session_id === "string" && identity.session_id) ||
    (typeof identity.sessionId === "string" && identity.sessionId) ||
    null;

  const email = emailFromIdentity(identity);
  const phone = phoneFromIdentity(identity);
  const name = pickString(identity, "name", "nickname");

  return {
    tokenIdentifier: identity.tokenIdentifier,
    clerkUserId: identity.subject,
    displayName: name || email || "Participant",
    email,
    phone,
    avatarUrl: pickString(identity, "pictureUrl", "picture", "image_url"),
    emailVerified: emailVerifiedFromIdentity(identity),
    phoneVerified: phoneVerifiedFromIdentity(identity),
    authenticated: typeof identity.subject === "string" && identity.subject.length > 0,
    clerkSessionId,
  };
}

/**
 * Mid-session continuity only when the Clerk session id matches the one
 * recorded at the last fully verified establish. A new sign-in (new sid)
 * must satisfy email + phone again even if the Participant row still exists.
 */
function isPreviouslyEstablishedSession(
  existing: Doc<"participants"> | null,
  clerkSessionId: string | null,
): boolean {
  return (
    existing !== null &&
    existing.emailVerified &&
    existing.phoneVerified &&
    !existing.suspended &&
    clerkSessionId !== null &&
    existing.lastClerkSessionId === clerkSessionId
  );
}

async function loadParticipantByToken(
  ctx: AuthCtx,
  tokenIdentifier: string,
): Promise<Doc<"participants"> | null> {
  return await ctx.db
    .query("participants")
    .withIndex("by_tokenIdentifier", (q) =>
      q.eq("tokenIdentifier", tokenIdentifier),
    )
    .unique();
}

/**
 * Deny-by-default: resolve the caller Participant from Convex auth only.
 * Never accepts client-supplied participantId or role.
 */
export async function requireParticipant(
  ctx: AuthCtx,
): Promise<Doc<"participants">> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) {
    throw new AuthError("Unauthenticated");
  }

  const claims = claimsFromIdentity(identity);
  const existing = await loadParticipantByToken(ctx, claims.tokenIdentifier);

  const previouslyEstablished = isPreviouslyEstablishedSession(
    existing,
    claims.clerkSessionId,
  );

  const decision = evaluateVerificationGate(claims, { previouslyEstablished });
  if (decision.action === "refuse") {
    throw new AuthError(
      `Verification incomplete: missing ${decision.missing.join(", ")}`,
    );
  }

  if (existing === null) {
    throw new AuthError("Participant not established");
  }

  if (existing.suspended) {
    throw new AuthError("Participant suspended");
  }

  return existing;
}

/**
 * Ensure a Participant exists for a fully verified Clerk identity.
 * Creates on first valid access; updates verification flags thereafter.
 */
export async function ensureParticipant(
  ctx: MutationCtx,
): Promise<Id<"participants">> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) {
    throw new AuthError("Unauthenticated");
  }

  const claims = claimsFromIdentity(identity);
  const existing = await loadParticipantByToken(ctx, claims.tokenIdentifier);

  const previouslyEstablished = isPreviouslyEstablishedSession(
    existing,
    claims.clerkSessionId,
  );

  const decision = evaluateVerificationGate(claims, { previouslyEstablished });
  if (decision.action === "refuse") {
    throw new AuthError(
      `Verification incomplete: missing ${decision.missing.join(", ")}`,
    );
  }

  if (existing === null) {
    return await ctx.db.insert("participants", {
      tokenIdentifier: claims.tokenIdentifier,
      clerkUserId: claims.clerkUserId,
      displayName: claims.displayName,
      email: claims.email,
      phone: claims.phone,
      // Contact verification is enforced at Clerk sign-in; JWT claims are optional.
      emailVerified: claims.emailVerified || Boolean(claims.email),
      phoneVerified: claims.phoneVerified || Boolean(claims.phone),
      // Account creation attests adult eligibility; no separate age gate.
      ageConfirmed: true,
      suspended: false,
      avatarUrl: claims.avatarUrl,
      lastClerkSessionId: claims.clerkSessionId ?? undefined,
    });
  }

  if (existing.suspended) {
    throw new AuthError("Participant suspended");
  }

  const patch: Partial<Doc<"participants">> = {
    displayName: claims.displayName,
    email: claims.email,
    phone: claims.phone,
    avatarUrl: claims.avatarUrl,
    ageConfirmed: true,
  };

  // Only strengthen verification flags when the current identity still has them.
  if (claims.emailVerified) patch.emailVerified = true;
  if (claims.phoneVerified) patch.phoneVerified = true;

  // Record session id when this access is fully verified (new sign-in ok).
  if (claims.emailVerified && claims.phoneVerified) {
    if (claims.clerkSessionId) {
      patch.lastClerkSessionId = claims.clerkSessionId;
    }
  }

  await ctx.db.patch(existing._id, patch);
  return existing._id;
}

export async function hasAvailableSeason(ctx: AuthCtx): Promise<boolean> {
  const season = await ctx.db
    .query("poolSeasons")
    .withIndex("by_status", (q) => q.eq("status", "available"))
    .take(1);
  return season.length > 0;
}
