import { httpRouter } from "convex/server";
import { httpAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  assertHelpIntakeOperational,
  corsHeaders,
  getHelpAllowedOrigin,
} from "./lib/helpConfig";
import {
  parsePoolIdHint,
  resolveStoredHelpContext,
  validateFeedbackIntake,
  validateSupportIntake,
} from "./helpIntake";

const http = httpRouter();

function jsonResponse(
  body: unknown,
  status: number,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders,
    },
  });
}

function requestOrigin(req: Request): string | null {
  return req.headers.get("Origin")?.trim() || null;
}

async function resolveAuthorizedPoolId(
  ctx: ActionCtx,
  participantId: Id<"participants"> | undefined,
  poolIdHint: Id<"pools"> | undefined,
): Promise<Id<"pools"> | undefined> {
  if (!participantId || !poolIdHint) return undefined;

  const isMember = await ctx.runQuery(
    internal.helpIntake.verifyPoolMembership,
    { poolId: poolIdHint, participantId },
  );
  return isMember ? poolIdHint : undefined;
}

async function resolveIdentityContext(
  ctx: ActionCtx,
  args: {
    anonymous: boolean;
    poolIdHint?: Id<"pools">;
  },
): Promise<{
  participantId?: Id<"participants">;
  email?: string;
  poolId?: Id<"pools">;
}> {
  if (args.anonymous) {
    return {};
  }

  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) {
    return {};
  }

  const participant = await ctx.runQuery(
    internal.helpIntake.lookupParticipantByToken,
    { tokenIdentifier: identity.tokenIdentifier },
  );
  if (!participant) {
    return {};
  }

  const poolId = await resolveAuthorizedPoolId(
    ctx,
    participant._id,
    args.poolIdHint,
  );

  return {
    participantId: participant._id,
    email: participant.email ?? identity.email ?? undefined,
    poolId,
  };
}

http.route({
  path: "/help/intake",
  method: "OPTIONS",
  handler: httpAction(async (_ctx, req) => {
    const allowedOrigin = getHelpAllowedOrigin();
    const origin = requestOrigin(req);
    return new Response(null, {
      status: 204,
      headers: corsHeaders(allowedOrigin, origin),
    });
  }),
});

http.route({
  path: "/help/intake",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const allowedOrigin = getHelpAllowedOrigin();
    const origin = requestOrigin(req);
    const cors = corsHeaders(allowedOrigin, origin);

    const operational = assertHelpIntakeOperational();
    if (!operational.ok) {
      return jsonResponse(
        { ok: false, error: operational.reason },
        503,
        cors,
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return jsonResponse(
        { ok: false, errors: { body: "Invalid JSON body" } },
        400,
        cors,
      );
    }

    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return jsonResponse(
        { ok: false, errors: { body: "Request body must be a JSON object" } },
        400,
        cors,
      );
    }

    const payload = body as Record<string, unknown>;
    const lane = payload.lane;
    const acceptedAtMs = Date.now();
    const poolIdHint = parsePoolIdHint(payload.poolIdHint);

    if (lane === "feedback") {
      const validated = validateFeedbackIntake({
        lane: payload.lane,
        idempotencyKey: payload.idempotencyKey,
        sentiment: payload.sentiment,
        feedbackType: payload.feedbackType,
        message: payload.message,
        replyEmail: payload.replyEmail,
        anonymous: payload.anonymous,
        honeypot: payload.honeypot,
        includeDiagnostics: payload.includeDiagnostics,
        context: payload.context,
        participantIdFromClient: payload.participantId,
      });

      if (!validated.ok) {
        return jsonResponse({ ok: false, errors: validated.errors }, 400, cors);
      }

      let replyEmail: string | undefined = validated.value.replyEmail;

      if (validated.value.anonymous) {
        replyEmail = undefined;
      }

      const identity = validated.value.anonymous
        ? {}
        : await resolveIdentityContext(ctx, {
            anonymous: false,
            poolIdHint,
          });

      let contextJson: string | undefined;
      try {
        contextJson = resolveStoredHelpContext({
          lane: "feedback",
          anonymous: validated.value.anonymous,
          includeDiagnostics: validated.value.includeDiagnostics,
          clientContextJson: validated.value.contextJson,
          identity,
        });
      } catch (error) {
        return jsonResponse(
          {
            ok: false,
            errors: {
              context:
                error instanceof Error ? error.message : "Invalid context",
            },
          },
          400,
          cors,
        );
      }

      const result = await ctx.runMutation(
        internal.helpIntake.acceptSubmission,
        {
          lane: validated.value.lane,
          idempotencyKey: validated.value.idempotencyKey,
          sentiment: validated.value.sentiment,
          feedbackType: validated.value.feedbackType,
          message: validated.value.message,
          replyEmail,
          anonymous: validated.value.anonymous,
          participantId: identity.participantId,
          poolId: identity.poolId,
          contextJson,
          includeDiagnostics: validated.value.includeDiagnostics,
          acceptedAtMs,
        },
      );

      return jsonResponse(
        {
          ok: true,
          reference: result.reference,
          acceptedAtMs: result.acceptedAtMs,
          lane: result.lane,
          contactable: Boolean(replyEmail),
        },
        200,
        cors,
      );
    }

    const validated = validateSupportIntake({
      lane: payload.lane,
      idempotencyKey: payload.idempotencyKey,
      replyEmail: payload.replyEmail,
      category: payload.category,
      message: payload.message,
      honeypot: payload.honeypot,
      includeDiagnostics: payload.includeDiagnostics,
      context: payload.context,
      participantIdFromClient: payload.participantId,
    });

    if (!validated.ok) {
      const status = validated.errors.lane?.includes("not yet") ? 501 : 400;
      return jsonResponse({ ok: false, errors: validated.errors }, status, cors);
    }

    const identity = await resolveIdentityContext(ctx, {
      anonymous: false,
      poolIdHint,
    });

    let contextJson: string | undefined;
    try {
      contextJson = resolveStoredHelpContext({
        lane: "support",
        anonymous: false,
        includeDiagnostics: validated.value.includeDiagnostics,
        clientContextJson: validated.value.contextJson,
        identity,
      });
    } catch (error) {
      return jsonResponse(
        {
          ok: false,
          errors: {
            context:
              error instanceof Error ? error.message : "Invalid context",
          },
        },
        400,
        cors,
      );
    }

    const result = await ctx.runMutation(
      internal.helpIntake.acceptSubmission,
      {
        lane: validated.value.lane,
        idempotencyKey: validated.value.idempotencyKey,
        supportCategory: validated.value.category,
        message: validated.value.message,
        replyEmail: validated.value.replyEmail,
        anonymous: validated.value.anonymous,
        participantId: identity.participantId,
        poolId: identity.poolId,
        contextJson,
        includeDiagnostics: validated.value.includeDiagnostics,
        acceptedAtMs,
      },
    );

    return jsonResponse(
      {
        ok: true,
        reference: result.reference,
        acceptedAtMs: result.acceptedAtMs,
        lane: result.lane,
      },
      200,
      cors,
    );
  }),
});

export default http;
