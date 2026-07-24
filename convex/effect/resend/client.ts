import * as Effect from "effect/Effect";
import { ParseResult, Schema } from "effect";

import { createLogger, errorMessage } from "../../lib/log";
import {
  canDeliverRealEmail,
  getFromEmail,
  getSupportMailbox,
} from "../../lib/helpConfig";
import { resendSink } from "../../lib/resendSink";
import {
  ResendConfigError,
  ResendDecodeError,
  ResendHttpError,
} from "./errors";
import {
  ResendSendRequestSchema,
  ResendSendResponseSchema,
} from "./schemas";

const log = createLogger("resend");

const RESEND_API_URL = "https://api.resend.com/emails";

export type SendEmailInput = {
  from: string;
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string | string[];
};

export type SendEmailResult = {
  id: string;
  usedSink: boolean;
};

function normalizeReplyTo(
  replyTo: string | string[] | undefined,
): string | string[] | undefined {
  if (replyTo === undefined) return undefined;
  return replyTo;
}

export function sendEmail(
  input: SendEmailInput,
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): Effect.Effect<
  SendEmailResult,
  ResendHttpError | ResendDecodeError | ResendConfigError
> {
  return Effect.gen(function* () {
    const useRealApi = canDeliverRealEmail(env);

    if (!useRealApi) {
      const recorded = resendSink.record({
        from: input.from,
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,
        replyTo: normalizeReplyTo(input.replyTo),
      });
      log.debug("resend_sink_recorded", {
        to: Array.isArray(input.to) ? input.to.join(",") : input.to,
        subject: input.subject,
        providerMessageId: recorded.providerMessageId,
      });
      return { id: recorded.providerMessageId, usedSink: true };
    }

    const apiKey = env.RESEND_API_KEY?.trim();
    if (!apiKey) {
      return yield* Effect.fail(
        new ResendConfigError({ detail: "RESEND_API_KEY is missing" }),
      );
    }

    const body = {
      from: input.from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
      reply_to: normalizeReplyTo(input.replyTo),
    };

    const encoded = yield* Schema.encode(ResendSendRequestSchema)(body).pipe(
      Effect.mapError(
        (cause) =>
          new ResendDecodeError({
            detail: ParseResult.TreeFormatter.formatErrorSync(cause),
          }),
      ),
    );

    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(RESEND_API_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(encoded),
        }),
      catch: (cause) =>
        new ResendHttpError({
          status: 0,
          statusText:
            cause instanceof Error ? cause.message : String(cause),
        }),
    });

    if (!response.ok) {
      const detail = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: () => new ResendHttpError({
          status: response.status,
          statusText: response.statusText,
        }),
      });
      log.error("resend_http_failed", {
        status: response.status,
        detail: detail.slice(0, 200),
      });
      return yield* Effect.fail(
        new ResendHttpError({
          status: response.status,
          statusText: response.statusText,
          detail,
        }),
      );
    }

    const json = yield* Effect.tryPromise({
      try: () => response.json() as Promise<unknown>,
      catch: (cause) =>
        new ResendDecodeError({
          detail: errorMessage(cause),
        }),
    });

    const decoded = yield* Schema.decodeUnknown(ResendSendResponseSchema)(
      json,
    ).pipe(
      Effect.mapError(
        (cause) =>
          new ResendDecodeError({
            detail: ParseResult.TreeFormatter.formatErrorSync(cause),
          }),
      ),
    );

    log.info("resend_sent", { providerMessageId: decoded.id });
    return { id: decoded.id, usedSink: false };
  });
}

/** Resolve configured from/to for support mailbox delivery. */
export function resolveSupportFromEmail(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): Effect.Effect<{ from: string; mailbox: string }, ResendConfigError> {
  const from = getFromEmail(env);
  const mailbox = getSupportMailbox(env);
  if (!from || !mailbox) {
    return Effect.fail(
      new ResendConfigError({
        detail: "HELP_FROM_EMAIL or HELP_SUPPORT_MAILBOX is not configured",
      }),
    );
  }
  return Effect.succeed({ from, mailbox });
}
