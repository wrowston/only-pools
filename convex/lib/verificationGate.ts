/**
 * Dual-verification policy for adult Participants.
 *
 * Clerk Dashboard (required for MVP):
 * - Enable Email + Phone as required identifiers / verification factors
 * - Enable email and phone verification
 * - Activate the Convex integration (JWT template "convex")
 *
 * Session policy (CONTEXT Participant Profile):
 * - Email + phone must both be verified at signup and every new sign-in
 * - Mid-session lapse of either factor does not interrupt an already-valid session
 * - The next sign-in requires both again
 *
 * Age 18+: attested by creating an account (no separate in-app confirmation gate).
 */

export type VerificationClaims = {
  emailVerified: boolean;
  phoneVerified: boolean;
};

export type SessionContext = {
  /** True when this request continues an already-established valid Pool session. */
  previouslyEstablished: boolean;
};

export type VerificationDecision =
  | { action: "allow" }
  | {
      action: "refuse";
      missing: Array<"email" | "phone">;
    };

export function evaluateVerificationGate(
  claims: VerificationClaims,
  session: SessionContext,
): VerificationDecision {
  const missing: Array<"email" | "phone"> = [];
  if (!claims.emailVerified) missing.push("email");
  if (!claims.phoneVerified) missing.push("phone");

  if (missing.length === 0) {
    return { action: "allow" };
  }

  // Mid-session: do not interrupt an already-valid session if contact
  // verification lapsed.
  if (session.previouslyEstablished) {
    return { action: "allow" };
  }

  return { action: "refuse", missing };
}

export function isFullyVerified(claims: VerificationClaims): boolean {
  return claims.emailVerified && claims.phoneVerified;
}
