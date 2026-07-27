import type { MutationCtx, QueryCtx } from "../_generated/server";
import { AuthError, requireParticipant } from "./auth";
import { isProductionOperator } from "./operator";

export const PRODUCTION_OPERATOR_STEP_UP_TTL_MS = 5 * 60 * 1_000;

export type ProductionOperatorActor = Readonly<{
  tokenIdentifier: string;
  clerkUserId: string;
}>;

type OperatorAuthCtx = QueryCtx | MutationCtx;

export async function requireProductionOperatorIdentity(
  ctx: OperatorAuthCtx,
  env: Record<string, string | undefined>,
): Promise<ProductionOperatorActor> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) {
    throw new AuthError("Unauthenticated");
  }
  const actor = {
    tokenIdentifier: identity.tokenIdentifier,
    clerkUserId: identity.subject,
  };
  if (!isProductionOperator(actor, env)) {
    throw new AuthError("Production Operator required");
  }
  return actor;
}

export async function requireProductionOperatorWithStepUp(
  ctx: OperatorAuthCtx,
  nowMs: number,
  env: Record<string, string | undefined>,
): Promise<ProductionOperatorActor> {
  const actor = await requireProductionOperatorIdentity(ctx, env);
  const participant = await requireParticipant(ctx);
  const verifiedAtMs = participant.stepUpVerifiedAtMs;
  if (
    verifiedAtMs === undefined ||
    verifiedAtMs > nowMs ||
    nowMs - verifiedAtMs > PRODUCTION_OPERATOR_STEP_UP_TTL_MS
  ) {
    throw new AuthError(
      "Fresh Step-up Verification required for clean Season Bootstrap activation",
    );
  }
  if (participant.tokenIdentifier !== actor.tokenIdentifier) {
    throw new AuthError("Production Operator identity mismatch");
  }
  return actor;
}
