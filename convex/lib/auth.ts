import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
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
 * Age confirmation may arrive as a custom JWT claim `ageConfirmed`, or be
 * stored on the Participant via `confirmMyAge` after the in-app gate.
 */
export function claimsFromIdentity(
  identity: Record<string, unknown> & {
    tokenIdentifier: string;
    subject: string;
    name?: string;
    email?: string;
    emailVerified?: boolean;
    phoneNumber?: string;
    phoneNumberVerified?: boolean;
    pictureUrl?: string;
  },
): IdentityClaims {
  const ageConfirmed =
    identity.ageConfirmed === true ||
    (identity.publicMetadata as { ageConfirmed?: boolean } | undefined)
      ?.ageConfirmed === true;

  const clerkSessionId =
    (typeof identity.sid === "string" && identity.sid) ||
    (typeof identity.session_id === "string" && identity.session_id) ||
    (typeof identity.sessionId === "string" && identity.sessionId) ||
    null;

  return {
    tokenIdentifier: identity.tokenIdentifier,
    clerkUserId: identity.subject,
    displayName:
      (typeof identity.name === "string" && identity.name) ||
      (typeof identity.email === "string" && identity.email) ||
      "Participant",
    email: identity.email,
    phone: identity.phoneNumber,
    avatarUrl:
      typeof identity.pictureUrl === "string" ? identity.pictureUrl : undefined,
    emailVerified: identity.emailVerified === true,
    phoneVerified: identity.phoneNumberVerified === true,
    ageConfirmed,
    clerkSessionId,
  };
}

function mergeStoredAge(
  claims: IdentityClaims,
  existing: Doc<"participants"> | null,
): IdentityClaims {
  if (existing?.ageConfirmed) {
    return { ...claims, ageConfirmed: true };
  }
  return claims;
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
    existing.ageConfirmed &&
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

  const rawClaims = claimsFromIdentity(identity);
  const existing = await loadParticipantByToken(ctx, rawClaims.tokenIdentifier);
  const claims = mergeStoredAge(rawClaims, existing);

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

  const rawClaims = claimsFromIdentity(identity);
  const existing = await loadParticipantByToken(ctx, rawClaims.tokenIdentifier);
  const claims = mergeStoredAge(rawClaims, existing);

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
    if (
      !claims.emailVerified ||
      !claims.phoneVerified ||
      !claims.ageConfirmed
    ) {
      throw new AuthError("Verification incomplete for new Participant");
    }

    return await ctx.db.insert("participants", {
      tokenIdentifier: claims.tokenIdentifier,
      clerkUserId: claims.clerkUserId,
      displayName: claims.displayName,
      email: claims.email,
      phone: claims.phone,
      emailVerified: claims.emailVerified,
      phoneVerified: claims.phoneVerified,
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
  };

  // Only strengthen verification flags when the current identity still has them.
  if (claims.emailVerified) patch.emailVerified = true;
  if (claims.phoneVerified) patch.phoneVerified = true;
  if (claims.ageConfirmed) patch.ageConfirmed = true;

  // Record session id when this access is fully verified (new sign-in ok).
  if (claims.emailVerified && claims.phoneVerified && claims.ageConfirmed) {
    if (claims.clerkSessionId) {
      patch.lastClerkSessionId = claims.clerkSessionId;
    }
  }

  await ctx.db.patch(existing._id, patch);
  return existing._id;
}

/**
 * Persist age 18+ confirmation on the Participant after the in-app gate.
 * Requires verified email + phone from the Clerk JWT. Calling this mutation
 * is the attestation — no client-supplied boolean is trusted.
 */
export async function confirmAge(ctx: MutationCtx): Promise<Id<"participants">> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) {
    throw new AuthError("Unauthenticated");
  }

  const claims = claimsFromIdentity(identity);
  if (!claims.emailVerified || !claims.phoneVerified) {
    throw new AuthError(
      "Verification incomplete: missing " +
        [
          !claims.emailVerified ? "email" : null,
          !claims.phoneVerified ? "phone" : null,
        ]
          .filter(Boolean)
          .join(", "),
    );
  }

  const existing = await loadParticipantByToken(ctx, claims.tokenIdentifier);
  if (existing === null) {
    return await ctx.db.insert("participants", {
      tokenIdentifier: claims.tokenIdentifier,
      clerkUserId: claims.clerkUserId,
      displayName: claims.displayName,
      email: claims.email,
      phone: claims.phone,
      emailVerified: true,
      phoneVerified: true,
      ageConfirmed: true,
      suspended: false,
      avatarUrl: claims.avatarUrl,
      lastClerkSessionId: claims.clerkSessionId ?? undefined,
    });
  }

  if (existing.suspended) {
    throw new AuthError("Participant suspended");
  }

  await ctx.db.patch(existing._id, {
    displayName: claims.displayName,
    email: claims.email,
    phone: claims.phone,
    avatarUrl: claims.avatarUrl,
    emailVerified: true,
    phoneVerified: true,
    ageConfirmed: true,
    lastClerkSessionId: claims.clerkSessionId ?? existing.lastClerkSessionId,
  });
  return existing._id;
}

export async function hasAvailableSeason(ctx: AuthCtx): Promise<boolean> {
  const season = await ctx.db
    .query("poolSeasons")
    .withIndex("by_status", (q) => q.eq("status", "available"))
    .take(1);
  return season.length > 0;
}
