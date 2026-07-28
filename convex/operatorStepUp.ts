"use node";

import { createClerkClient } from "@clerk/backend";
import { reverificationError } from "@clerk/backend/internal";

import { internal } from "./_generated/api";
import { action, env } from "./_generated/server";
import {
  PRODUCTION_OPERATOR_STEP_UP_TTL_MS,
  operatorSessionId,
  requireProductionOperatorIdentity,
} from "./lib/operatorAuth";

const STRICT_MFA_AFTER_MINUTES = 10;

type SessionTokenClaims = Readonly<{
  sub: string;
  sid: string;
  fva: [number, number];
}>;

function validFactorAge(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    (value === -1 || value >= 0)
  );
}

/**
 * Mirrors Clerk's installed `strict_mfa` contract: multi-factor within ten
 * minutes, with first-factor fallback only when no second factor is configured.
 */
export function strictMfaIsFresh(
  value: unknown,
): value is [number, number] {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !validFactorAge(value[0]) ||
    !validFactorAge(value[1])
  ) {
    return false;
  }
  const [firstFactorAge, secondFactorAge] = value;
  const firstFresh =
    firstFactorAge !== -1 &&
    firstFactorAge < STRICT_MFA_AFTER_MINUTES;
  const secondFresh =
    secondFactorAge !== -1 &&
    secondFactorAge < STRICT_MFA_AFTER_MINUTES;
  if (firstFactorAge === -1 && secondFactorAge === -1) return false;
  if (secondFactorAge === -1) return firstFresh;
  if (firstFactorAge === -1) return false;
  return firstFresh && secondFresh;
}

function decodeSessionToken(jwt: string): SessionTokenClaims | null {
  try {
    const parts = jwt.split(".");
    if (parts.length !== 3 || !parts[1]) return null;
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    if (
      typeof payload.sub !== "string" ||
      typeof payload.sid !== "string" ||
      !strictMfaIsFresh(payload.fva)
    ) {
      return null;
    }
    return {
      sub: payload.sub,
      sid: payload.sid,
      fva: payload.fva,
    };
  } catch {
    return null;
  }
}

export const verifyProductionOperatorStepUp = action({
  args: {},
  handler: async (ctx) => {
    const actor = await requireProductionOperatorIdentity(ctx, env);
    const identity = await ctx.auth.getUserIdentity();
    const sessionId = identity
      ? operatorSessionId(identity as Record<string, unknown>)
      : null;
    if (!sessionId) {
      throw new Error(
        "Authenticated Clerk session required for Production Operator verification",
      );
    }
    const secretKey = env.CLERK_SECRET_KEY;
    if (!secretKey) {
      throw new Error(
        "Production Operator Step-up Verification is unavailable because Clerk server configuration is missing",
      );
    }

    const clerk = createClerkClient({ secretKey });
    let session;
    let token;
    try {
      [session, token] = await Promise.all([
        clerk.sessions.getSession(sessionId),
        clerk.sessions.getToken(sessionId),
      ]);
    } catch {
      throw new Error("Authenticated Clerk session could not be verified");
    }
    const nowMs = Date.now();
    if (
      session.id !== sessionId ||
      session.userId !== actor.clerkUserId ||
      session.status !== "active" ||
      session.expireAt <= nowMs
    ) {
      throw new Error(
        "Authenticated Clerk session is not active for this Production Operator",
      );
    }

    const claims = decodeSessionToken(token.jwt);
    if (
      !claims ||
      claims.sid !== sessionId ||
      claims.sub !== actor.clerkUserId
    ) {
      return reverificationError("strict_mfa");
    }

    await ctx.runMutation(
      internal.operatorStepUpInternal.recordVerifiedOperatorStepUp,
      {
        tokenIdentifier: actor.tokenIdentifier,
        clerkUserId: actor.clerkUserId,
        sessionId,
        verifiedAtMs: nowMs,
      },
    );
    return {
      operatorStepUpVerifiedAtMs: nowMs,
      sessionId,
      expiresAtMs: nowMs + PRODUCTION_OPERATOR_STEP_UP_TTL_MS,
    };
  },
});
