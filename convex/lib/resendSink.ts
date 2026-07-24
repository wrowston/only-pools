/**
 * In-memory Resend sink for tests and non-production delivery.
 * Records sent emails without calling the Resend API.
 */

export type ResendSinkEmail = {
  from: string;
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string | string[];
  atMs: number;
  providerMessageId: string;
};

type ResendSink = {
  emails: ResendSinkEmail[];
  record: (email: Omit<ResendSinkEmail, "atMs" | "providerMessageId">) => ResendSinkEmail;
  reset: () => void;
};

function createSink(): ResendSink {
  const emails: ResendSinkEmail[] = [];
  let counter = 0;

  return {
    emails,
    record(email) {
      counter += 1;
      const record: ResendSinkEmail = {
        ...email,
        atMs: Date.now(),
        providerMessageId: `sink_${counter.toString(16).padStart(8, "0")}`,
      };
      emails.push(record);
      return record;
    },
    reset() {
      emails.length = 0;
      counter = 0;
    },
  };
}

/** Process-wide sink (tests call reset between cases). */
export const resendSink = createSink();
