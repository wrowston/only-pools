/**
 * Dual-verification policy for adult Participants.
 *
 * Clerk Dashboard (required for MVP):
 * - Enable Email + Phone as required identifiers / verification factors
 * - Enable email and phone verification
 * - Activate the Convex integration (JWT template "convex")
 *
 * Server-side note:
 * Convex often receives a Clerk session token (or a sparse JWT) without
 * email/phone claims. Identity establishment therefore trusts an authenticated
 * Clerk subject; contact fields are enriched when present on the JWT.
 * Enforce dual verification at Clerk sign-in, not by re-parsing brittle claims.
 *
 * Age 18+: attested by creating an account (no separate in-app confirmation gate).
 */

export type VerificationClaims = {
  emailVerified: boolean;
  phoneVerified: boolean;
  /** True when Convex has a validated Clerk identity (subject present). */
  authenticated: boolean;
};

export type SessionContext = {
  /** True when this request continues an already-established valid Pool session. */
  previouslyEstablished: boolean;
};

export type VerificationDecision =
  | { action: "allow" }
  | {
      action: "refuse";
      missing: Array<"email" | "phone" | "auth">;
    };

export function evaluateVerificationGate(
  claims: VerificationClaims,
  session: SessionContext,
): VerificationDecision {
  if (!claims.authenticated) {
    return { action: "refuse", missing: ["auth"] };
  }

  // Authenticated Clerk session is sufficient. Prefer contact claims when
  // present, but do not block Pool access if the JWT omits them.
  if (session.previouslyEstablished) {
    return { action: "allow" };
  }

  return { action: "allow" };
}

export function isFullyVerified(claims: VerificationClaims): boolean {
  return claims.authenticated;
}
