/**
 * In-memory Resend sink for tests and non-production delivery.
 * Records sent emails without calling the Resend API.
 */

import { ResendHttpError } from "../effect/resend/errors";

export type ResendSinkEmail = {
  from: string;
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string | string[];
  idempotencyKey?: string;
  atMs: number;
  providerMessageId: string;
};

export type ResendSinkFailureOptions = {
  status: number;
  statusText?: string;
  failureClass?: string;
};

type ResendSink = {
  emails: ResendSinkEmail[];
  record: (
    email: Omit<ResendSinkEmail, "atMs" | "providerMessageId">,
  ) => ResendSinkEmail;
  failNext: (count: number, options: ResendSinkFailureOptions) => void;
  failOnSendNumber: (sendNumber: number, options: ResendSinkFailureOptions) => void;
  failPermanently: (options: ResendSinkFailureOptions) => void;
  reset: () => void;
};

function createSink(): ResendSink {
  const emails: ResendSinkEmail[] = [];
  let counter = 0;
  let failureQueue: ResendSinkFailureOptions[] = [];
  let permanentFailure: ResendSinkFailureOptions | null = null;
  let sendNumber = 0;
  let pendingFailOnSend: {
    sendNumber: number;
    options: ResendSinkFailureOptions;
  } | null = null;
  const idempotencyIndex = new Map<string, ResendSinkEmail>();

  function throwConfiguredFailure(options: ResendSinkFailureOptions): never {
    throw new ResendHttpError({
      status: options.status,
      statusText: options.statusText ?? "Sink failure",
      detail: options.failureClass,
    });
  }

  function consumeFailure(): void {
    if (permanentFailure) {
      throwConfiguredFailure(permanentFailure);
    }
    const next = failureQueue.shift();
    if (next) {
      throwConfiguredFailure(next);
    }
  }

  return {
    emails,
    record(email) {
      sendNumber += 1;
      if (
        pendingFailOnSend &&
        pendingFailOnSend.sendNumber === sendNumber
      ) {
        const options = pendingFailOnSend.options;
        pendingFailOnSend = null;
        throwConfiguredFailure(options);
      }

      consumeFailure();

      if (email.idempotencyKey) {
        const existing = idempotencyIndex.get(email.idempotencyKey);
        if (existing) {
          return existing;
        }
      }

      counter += 1;
      const record: ResendSinkEmail = {
        ...email,
        atMs: Date.now(),
        providerMessageId: `sink_${counter.toString(16).padStart(8, "0")}`,
      };
      emails.push(record);
      if (email.idempotencyKey) {
        idempotencyIndex.set(email.idempotencyKey, record);
      }
      return record;
    },
    failNext(count, options) {
      for (let i = 0; i < count; i += 1) {
        failureQueue.push(options);
      }
    },
    failOnSendNumber(sendNumberArg, options) {
      pendingFailOnSend = { sendNumber: sendNumberArg, options };
    },
    failPermanently(options) {
      permanentFailure = options;
    },
    reset() {
      emails.length = 0;
      counter = 0;
      sendNumber = 0;
      failureQueue = [];
      permanentFailure = null;
      pendingFailOnSend = null;
      idempotencyIndex.clear();
    },
  };
}

/** Process-wide sink (tests call reset between cases). */
export const resendSink = createSink();
