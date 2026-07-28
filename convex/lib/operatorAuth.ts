import type {
  ActionCtx,
  MutationCtx,
  QueryCtx,
} from "../_generated/server";
import { AuthError, requireParticipant } from "./auth";
import { isProductionOperator } from "./operator";

export const PRODUCTION_OPERATOR_STEP_UP_TTL_MS = 5 * 60 * 1_000;

export type ProductionOperatorActor = Readonly<{
  tokenIdentifier: string;
  clerkUserId: string;
}>;

type OperatorIdentityCtx = QueryCtx | MutationCtx | ActionCtx;
type OperatorStepUpCtx = QueryCtx | MutationCtx;

export function operatorSessionId(
  identity: Record<string, unknown>,
): string | null {
  const sid = identity.sid;
  return typeof sid === "string" && sid.trim().length > 0 ? sid : null;
}

export async function requireProductionOperatorIdentity(
  ctx: OperatorIdentityCtx,
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
  ctx: OperatorStepUpCtx,
  nowMs: number,
  env: Record<string, string | undefined>,
): Promise<ProductionOperatorActor> {
  const actor = await requireProductionOperatorIdentity(ctx, env);
  const identity = await ctx.auth.getUserIdentity();
  const sessionId = identity
    ? operatorSessionId(identity as Record<string, unknown>)
    : null;
  if (!sessionId) {
    throw new AuthError(
      "Authenticated Clerk session required for Production Operator Step-up Verification",
    );
  }
  const participant = await requireParticipant(ctx);
  const verifiedAtMs = participant.operatorStepUpVerifiedAtMs;
  if (
    verifiedAtMs === undefined ||
    verifiedAtMs > nowMs ||
    nowMs - verifiedAtMs > PRODUCTION_OPERATOR_STEP_UP_TTL_MS ||
    participant.operatorStepUpSessionId !== sessionId
  ) {
    throw new AuthError(
      "Fresh Step-up Verification required for this Production Operator action",
    );
  }
  if (participant.tokenIdentifier !== actor.tokenIdentifier) {
    throw new AuthError("Production Operator identity mismatch");
  }
  return actor;
}
