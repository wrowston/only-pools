import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  assertHelpIntakeOperational,
  corsHeaders,
  getHelpAllowedOrigin,
} from "./lib/helpConfig";
import { validateSupportIntake } from "./helpIntake";

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

    if (payload.lane === "feedback") {
      return jsonResponse(
        {
          ok: false,
          errors: { lane: "Feedback lane is not yet available" },
        },
        501,
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

    let participantId = undefined;
    const identity = await ctx.auth.getUserIdentity();
    if (identity !== null) {
      const participant = await ctx.runQuery(
        internal.helpIntake.lookupParticipantByToken,
        { tokenIdentifier: identity.tokenIdentifier },
      );
      participantId = participant?._id;
    }

    const acceptedAtMs = Date.now();

    const result = await ctx.runMutation(
      internal.helpIntake.acceptSubmission,
      {
        lane: validated.value.lane,
        idempotencyKey: validated.value.idempotencyKey,
        supportCategory: validated.value.category,
        message: validated.value.message,
        replyEmail: validated.value.replyEmail,
        anonymous: validated.value.anonymous,
        participantId,
        contextJson: validated.value.contextJson,
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
