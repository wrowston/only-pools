/**
 * Normalize Clerk → Convex identity claims.
 *
 * Clerk JWT templates often interpolate booleans as the strings "true"/"false",
 * and custom claims may arrive snake_case even when Convex camelCases OIDC ones.
 *
 * Important: Clerk's `{{user.email_verified}}` / `{{user.phone_number_verified}}`
 * shortcodes are frequently empty in minted Convex JWTs even when the account
 * identifiers are verified. Presence of primary email / phone on the JWT is a
 * reliable signal that Clerk issued a session with those identifiers.
 */

export function asBool(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

export function pickString(
  identity: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = identity[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

export function emailFromIdentity(
  identity: Record<string, unknown>,
): string | undefined {
  return pickString(identity, "email", "emailAddress", "email_address");
}

export function phoneFromIdentity(
  identity: Record<string, unknown>,
): string | undefined {
  return pickString(identity, "phoneNumber", "phone_number", "phone");
}

export function emailVerifiedFromIdentity(
  identity: Record<string, unknown>,
): boolean {
  if (
    asBool(
      identity.emailVerified ??
        identity.email_verified ??
        identity["email_verified"],
    )
  ) {
    return true;
  }
  // Fallback: primary email present on the Convex JWT.
  return emailFromIdentity(identity) !== undefined;
}

export function phoneVerifiedFromIdentity(
  identity: Record<string, unknown>,
): boolean {
  if (
    asBool(
      identity.phoneNumberVerified ??
        identity.phone_number_verified ??
        identity["phone_number_verified"],
    )
  ) {
    return true;
  }
  // Fallback: primary phone present on the Convex JWT.
  return phoneFromIdentity(identity) !== undefined;
}
