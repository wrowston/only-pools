/**
 * Production Operator allowlist — separate from every Pool role.
 */

export type OperatorIdentity = {
  tokenIdentifier: string;
  clerkUserId: string;
};

export function isProductionOperator(
  identity: OperatorIdentity,
  env: Record<string, string | undefined>,
): boolean {
  const byClerk = env.PRODUCTION_OPERATOR_CLERK_USER_ID?.trim();
  const byToken = env.PRODUCTION_OPERATOR_TOKEN_IDENTIFIER?.trim();

  if (byClerk && identity.clerkUserId === byClerk) return true;
  if (byToken && identity.tokenIdentifier === byToken) return true;
  return false;
}
