import { httpRouter } from "convex/server";
import { httpAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  assertHelpIntakeOperational,
  corsHeaders,
  getHelpAllowedOrigin,
  getHelpNetworkHashSecret,
  isHelpOriginAllowed,
} from "./lib/helpConfig";
import { MAX_HELP_REQUEST_BODY_BYTES } from "./lib/helpConstants";
import {
  extractClientNetworkAddress,
  hashHelpAccountKey,
  hashHelpNetworkKey,
} from "./lib/helpThrottle";
import {
  parsePoolIdHint,
  resolveStoredHelpContext,
  validateFeedbackIntake,
  validateFormTiming,
  validateSupportIntake,
} from "./helpIntake";

const http = httpRouter();

const GENERIC_RATE_LIMIT_ERROR = "Please try again later.";

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

function rejectOversizedBody(
  req: Request,
  cors: Record<string, string>,
): Response | null {
  const contentLengthHeader = req.headers.get("Content-Length")?.trim();
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);
    if (
      Number.isFinite(contentLength) &&
      contentLength > MAX_HELP_REQUEST_BODY_BYTES
    ) {
      return jsonResponse(
        { ok: false, errors: { body: "Request body is too large" } },
        413,
        cors,
      );
    }
  }
  return null;
}

async function parseJsonBody(
  req: Request,
  cors: Record<string, string>,
): Promise<
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; response: Response }
> {
  const oversize = rejectOversizedBody(req, cors);
  if (oversize) {
    return { ok: false, response: oversize };
  }

  let rawBody: ArrayBuffer;
  try {
    rawBody = await req.arrayBuffer();
  } catch {
    return {
      ok: false,
      response: jsonResponse(
        { ok: false, errors: { body: "Invalid request body" } },
        400,
        cors,
      ),
    };
  }

  if (rawBody.byteLength > MAX_HELP_REQUEST_BODY_BYTES) {
    return {
      ok: false,
      response: jsonResponse(
        { ok: false, errors: { body: "Request body is too large" } },
        413,
        cors,
      ),
    };
  }

  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    return {
      ok: false,
      response: jsonResponse(
        { ok: false, errors: { body: "Invalid JSON body" } },
        400,
        cors,
      ),
    };
  }

  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      response: jsonResponse(
        { ok: false, errors: { body: "Request body must be a JSON object" } },
        400,
        cors,
      ),
    };
  }

  return { ok: true, payload: body as Record<string, unknown> };
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
  tokenIdentifier?: string;
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
    return { tokenIdentifier: identity.tokenIdentifier };
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
    tokenIdentifier: identity.tokenIdentifier,
  };
}

async function resolveThrottleKeyHashes(
  ctx: ActionCtx,
  args: {
    anonymous: boolean;
    poolIdHint?: Id<"pools">;
    req: Request;
  },
): Promise<{
  accountKeyHash?: string;
  networkKeyHash?: string;
}> {
  const secret = getHelpNetworkHashSecret();
  if (!secret) {
    return {};
  }

  const identity = await resolveIdentityContext(ctx, {
    anonymous: args.anonymous,
    poolIdHint: args.poolIdHint,
  });

  const accountSource =
    identity.participantId ?? identity.tokenIdentifier ?? undefined;

  const accountKeyHash = accountSource
    ? await hashHelpAccountKey(secret, accountSource)
    : undefined;

  const networkAddress = extractClientNetworkAddress(args.req.headers);
  const networkKeyHash = networkAddress
    ? await hashHelpNetworkKey(secret, networkAddress)
    : undefined;

  return { accountKeyHash, networkKeyHash };
}

type AcceptResult =
  | {
      ok: true;
      reference: string;
      acceptedAtMs: number;
      lane: "support" | "feedback";
      contactable?: boolean;
    }
  | { ok: false; status: number; body: Record<string, unknown> };

async function acceptValidatedSubmission(
  ctx: ActionCtx,
  args: {
    req: Request;
    acceptedAtMs: number;
    lane: "support" | "feedback";
    idempotencyKey: string;
    message: string;
    replyEmail?: string;
    anonymous: boolean;
    includeDiagnostics: boolean;
    contextJson?: string;
    poolIdHint?: Id<"pools">;
    supportCategory?: string;
    sentiment?: "negative" | "neutral" | "positive";
    feedbackType?: "problem" | "idea" | "liked";
  },
): Promise<AcceptResult> {
  const identity =
    args.lane === "feedback" && args.anonymous
      ? {}
      : await resolveIdentityContext(ctx, {
          anonymous: false,
          poolIdHint: args.poolIdHint,
        });

  let contextJson: string | undefined;
  try {
    contextJson = resolveStoredHelpContext({
      lane: args.lane,
      anonymous: args.anonymous,
      includeDiagnostics: args.includeDiagnostics,
      clientContextJson: args.contextJson,
      identity,
    });
  } catch (error) {
    return {
      ok: false,
      status: 400,
      body: {
        ok: false,
        errors: {
          context:
            error instanceof Error ? error.message : "Invalid context",
        },
      },
    };
  }

  const throttleKeys = await resolveThrottleKeyHashes(ctx, {
    anonymous: args.anonymous,
    poolIdHint: args.poolIdHint,
    req: args.req,
  });

  const result = await ctx.runMutation(internal.helpIntake.acceptSubmission, {
    lane: args.lane,
    idempotencyKey: args.idempotencyKey,
    supportCategory: args.supportCategory,
    sentiment: args.sentiment,
    feedbackType: args.feedbackType,
    message: args.message,
    replyEmail: args.replyEmail,
    anonymous: args.anonymous,
    participantId: identity.participantId,
    poolId: identity.poolId,
    contextJson,
    includeDiagnostics: args.includeDiagnostics,
    acceptedAtMs: args.acceptedAtMs,
    accountKeyHash: throttleKeys.accountKeyHash,
    networkKeyHash: throttleKeys.networkKeyHash,
  });

  if (!result.ok) {
    return {
      ok: false,
      status: 429,
      body: { ok: false, error: GENERIC_RATE_LIMIT_ERROR },
    };
  }

  return {
    ok: true,
    reference: result.reference,
    acceptedAtMs: result.acceptedAtMs,
    lane: result.lane,
    contactable: Boolean(args.replyEmail),
  };
}

http.route({
  path: "/help/intake",
  method: "OPTIONS",
  handler: httpAction(async (_ctx, req) => {
    const allowedOrigin = getHelpAllowedOrigin();
    const origin = requestOrigin(req);

    if (!isHelpOriginAllowed(allowedOrigin, origin)) {
      return new Response(null, { status: 403 });
    }

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

    if (!isHelpOriginAllowed(allowedOrigin, origin)) {
      return jsonResponse({ ok: false, error: "Forbidden" }, 403, cors);
    }

    const operational = assertHelpIntakeOperational();
    if (!operational.ok) {
      return jsonResponse(
        { ok: false, error: operational.reason },
        503,
        cors,
      );
    }

    const parsedBody = await parseJsonBody(req, cors);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }

    const payload = parsedBody.payload;
    const lane = payload.lane;
    const acceptedAtMs = Date.now();
    const poolIdHint = parsePoolIdHint(payload.poolIdHint);

    const timingErrors = validateFormTiming({
      startedAtMs: payload.startedAtMs,
      completedAtMs: payload.completedAtMs,
      acceptedAtMs,
    });
    if (timingErrors) {
      return jsonResponse({ ok: false, errors: timingErrors }, 400, cors);
    }

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

      const accepted = await acceptValidatedSubmission(ctx, {
        req,
        acceptedAtMs,
        lane: "feedback",
        idempotencyKey: validated.value.idempotencyKey,
        message: validated.value.message,
        replyEmail,
        anonymous: validated.value.anonymous,
        includeDiagnostics: validated.value.includeDiagnostics,
        contextJson: validated.value.contextJson,
        poolIdHint,
        sentiment: validated.value.sentiment,
        feedbackType: validated.value.feedbackType,
      });

      if (!accepted.ok) {
        return jsonResponse(accepted.body, accepted.status, cors);
      }

      return jsonResponse(
        {
          ok: true,
          reference: accepted.reference,
          acceptedAtMs: accepted.acceptedAtMs,
          lane: accepted.lane,
          contactable: accepted.contactable ?? false,
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

    const accepted = await acceptValidatedSubmission(ctx, {
      req,
      acceptedAtMs,
      lane: "support",
      idempotencyKey: validated.value.idempotencyKey,
      message: validated.value.message,
      replyEmail: validated.value.replyEmail,
      anonymous: false,
      includeDiagnostics: validated.value.includeDiagnostics,
      contextJson: validated.value.contextJson,
      poolIdHint,
      supportCategory: validated.value.category,
    });

    if (!accepted.ok) {
      return jsonResponse(accepted.body, accepted.status, cors);
    }

    return jsonResponse(
      {
        ok: true,
        reference: accepted.reference,
        acceptedAtMs: accepted.acceptedAtMs,
        lane: accepted.lane,
      },
      200,
      cors,
    );
  }),
});

export default http;
