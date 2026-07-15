/**
 * Dual-verification policy for adult Participants.
 *
 * Clerk Dashboard (required for MVP):
 * - Enable Email + Phone as required identifiers / verification factors
 * - Enable email and phone verification
 * - Activate the Convex integration (JWT template "convex")
 * - Optionally add a custom sign-up field that sets publicMetadata.ageConfirmed;
 *   otherwise the in-app age gate calls confirmMyAge and writes unsafeMetadata
 *
 * Session policy (CONTEXT Participant Profile):
 * - Email + phone must both be verified at signup and every new sign-in
 * - Mid-session lapse of either factor does not interrupt an already-valid session
 * - The next sign-in requires both again
 * - Age 18+ confirmation is required before Pool access
 */

export type VerificationClaims = {
  emailVerified: boolean;
  phoneVerified: boolean;
  ageConfirmed: boolean;
};

export type SessionContext = {
  /** True when this request continues an already-established valid Pool session. */
  previouslyEstablished: boolean;
};

export type VerificationDecision =
  | { action: "allow" }
  | {
      action: "refuse";
      missing: Array<"email" | "phone" | "age">;
    };

export function evaluateVerificationGate(
  claims: VerificationClaims,
  session: SessionContext,
): VerificationDecision {
  const missing: Array<"email" | "phone" | "age"> = [];
  if (!claims.ageConfirmed) missing.push("age");
  if (!claims.emailVerified) missing.push("email");
  if (!claims.phoneVerified) missing.push("phone");

  if (missing.length === 0) {
    return { action: "allow" };
  }

  // Mid-session: do not interrupt an already-valid session if only contact
  // verification lapsed. Age confirmation is always required.
  if (session.previouslyEstablished && !missing.includes("age")) {
    return { action: "allow" };
  }

  return { action: "refuse", missing };
}

export function isFullyVerified(claims: VerificationClaims): boolean {
  return (
    claims.ageConfirmed && claims.emailVerified && claims.phoneVerified
  );
}
