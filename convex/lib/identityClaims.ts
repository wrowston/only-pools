/**
 * Normalize Clerk → Convex identity claims.
 *
 * Clerk JWT templates often interpolate booleans as the strings "true"/"false",
 * and custom claims may arrive snake_case even when Convex camelCases OIDC ones.
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

export function emailVerifiedFromIdentity(
  identity: Record<string, unknown>,
): boolean {
  return asBool(
    identity.emailVerified ??
      identity.email_verified ??
      identity["email_verified"],
  );
}

export function phoneVerifiedFromIdentity(
  identity: Record<string, unknown>,
): boolean {
  return asBool(
    identity.phoneNumberVerified ??
      identity.phone_number_verified ??
      identity["phone_number_verified"],
  );
}

export function phoneFromIdentity(
  identity: Record<string, unknown>,
): string | undefined {
  return pickString(identity, "phoneNumber", "phone_number", "phone");
}
