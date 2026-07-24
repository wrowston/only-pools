import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, type ActionCtx } from "./_generated/server";
import * as Effect from "effect/Effect";
import { HELP_RESPONSE_EXPECTATION } from "./lib/helpConstants";
import {
  classifyDeliveryError,
  shouldAttemptDelivery,
  type DeliveryRecipient,
} from "./lib/helpDeliveryPolicy";
import { createLogger } from "./lib/log";
import { runEffect } from "./effect/run";
import {
  resolveSupportFromEmail,
  sendEmail,
} from "./effect/resend/client";

const log = createLogger("helpDelivery");

type IntakeForDelivery = {
  _id: Id<"helpIntake">;
  reference: string;
  lane: "support" | "feedback";
  supportCategory?: string;
  sentiment?: "negative" | "neutral" | "positive";
  feedbackType?: "problem" | "idea" | "liked";
  message: string;
  replyEmail?: string;
  participantId?: Id<"participants">;
  anonymous: boolean;
  contextJson?: string;
  includeDiagnostics: boolean;
  mailboxDelivery: {
    status: "pending" | "sent" | "failed" | "skipped";
    attemptCount: number;
    nextAttemptAtMs?: number;
  };
  receiptDelivery: {
    status: "pending" | "sent" | "failed" | "skipped";
    attemptCount: number;
    nextAttemptAtMs?: number;
  };
};

function formatSupportMailboxBody(args: {
  reference: string;
  category: string;
  message: string;
  replyEmail: string;
  participantId?: string;
  contextJson?: string;
}): string {
  const lines = [
    `Reference: ${args.reference}`,
    `Category: ${args.category}`,
    `Reply-To: ${args.replyEmail}`,
    "",
    "Message:",
    args.message,
  ];
  if (args.participantId) {
    lines.push("", `Participant: ${args.participantId}`);
  }
  if (args.contextJson) {
    lines.push("", "Context:", args.contextJson);
  }
  return lines.join("\n");
}

function formatSupportReceiptBody(args: {
  reference: string;
  category: string;
  message: string;
}): string {
  return [
    "Thank you for contacting Only Pools Support.",
    "",
    `Reference: ${args.reference}`,
    `Category: ${args.category}`,
    "",
    HELP_RESPONSE_EXPECTATION,
    "",
    "Your message:",
    args.message,
  ].join("\n");
}

function formatFeedbackMailboxBody(args: {
  reference: string;
  feedbackType: string;
  sentiment: string;
  message: string;
  replyEmail?: string;
  participantId?: string;
  anonymous: boolean;
  contextJson?: string;
}): string {
  const lines = [
    `Reference: ${args.reference}`,
    `Type: ${args.feedbackType}`,
    `Sentiment: ${args.sentiment}`,
    args.anonymous
      ? "Submitter: Anonymous"
      : args.participantId
        ? `Participant: ${args.participantId}`
        : "Submitter: Public (no account linked)",
    `Follow-up email: ${args.replyEmail ?? "None"}`,
    "",
    "Message:",
    args.message.length > 0 ? args.message : "(none provided)",
  ];
  if (args.contextJson) {
    lines.push("", "Context:", args.contextJson);
  }
  return lines.join("\n");
}

function formatFeedbackReceiptBody(args: {
  reference: string;
  feedbackType: string;
  sentiment: string;
  message: string;
}): string {
  const lines = [
    "Thank you for sharing feedback with Only Pools.",
    "",
    `Reference: ${args.reference}`,
    `Type: ${args.feedbackType}`,
    `Sentiment: ${args.sentiment}`,
    "",
    "We received your feedback privately. Providing an email does not guarantee a personal reply.",
  ];
  if (args.message.length > 0) {
    lines.push("", "Your message:", args.message);
  }
  return lines.join("\n");
}

function idempotencyKey(intakeId: Id<"helpIntake">, recipient: DeliveryRecipient): string {
  return `${intakeId}:${recipient}`;
}

async function attemptRecipientDelivery(
  ctx: ActionCtx,
  args: {
    intake: IntakeForDelivery;
    channel: DeliveryRecipient;
    from: string;
    to: string;
    subject: string;
    text: string;
    replyTo?: string;
    nowMs: number;
  },
): Promise<void> {
  const state =
    args.channel === "mailbox"
      ? args.intake.mailboxDelivery
      : args.intake.receiptDelivery;

  if (!shouldAttemptDelivery(state, args.nowMs)) {
    return;
  }

  const result = await runEffect(
    sendEmail({
      from: args.from,
      to: args.to,
      subject: args.subject,
      text: args.text,
      replyTo: args.replyTo,
      idempotencyKey: idempotencyKey(args.intake._id, args.channel),
    }).pipe(
      Effect.match({
        onFailure: (error) => ({ ok: false as const, error }),
        onSuccess: (sendResult) => ({ ok: true as const, sendResult }),
      }),
    ),
  );

  if (result.ok) {
    await ctx.runMutation(internal.helpIntake.recordDeliveryAttempt, {
      intakeId: args.intake._id,
      channel: args.channel,
      outcome: {
        kind: "success",
        providerMessageId: result.sendResult.id,
        attemptAtMs: args.nowMs,
      },
    });
    return;
  }

  const classified = classifyDeliveryError(result.error);
  log.error("help_delivery_failed", {
    intakeId: args.intake._id,
    channel: args.channel,
    failureClass: classified.failureClass,
    retryable: classified.retryable,
  });

  await ctx.runMutation(internal.helpIntake.recordDeliveryAttempt, {
    intakeId: args.intake._id,
    channel: args.channel,
    outcome: {
      kind: "failure",
      failureClass: classified.failureClass,
      retryable: classified.retryable,
      attemptAtMs: args.nowMs,
    },
  });
}

async function markReceiptSkipped(
  ctx: ActionCtx,
  intakeId: Id<"helpIntake">,
  failureClass: string,
  nowMs: number,
): Promise<void> {
  await ctx.runMutation(internal.helpIntake.recordDeliveryAttempt, {
    intakeId,
    channel: "receipt",
    outcome: {
      kind: "skipped",
      failureClass,
      attemptAtMs: nowMs,
    },
  });
}

export const deliverIntake = internalAction({
  args: { intakeId: v.id("helpIntake") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const intake = await ctx.runQuery(internal.helpIntake.getIntakeById, {
      intakeId: args.intakeId,
    });
    if (!intake) {
      log.warn("deliver_intake_missing", { intakeId: args.intakeId });
      return null;
    }

    const configEffect = resolveSupportFromEmail();
    const config = await runEffect(configEffect);
    const nowMs = Date.now();

    try {
      if (intake.lane === "feedback") {
        const feedbackType = intake.feedbackType ?? "problem";
        const sentiment = intake.sentiment ?? "neutral";
        const mailboxSubject = `[Feedback] ${feedbackType} · ${sentiment} · ${intake.reference}`;
        const mailboxText = formatFeedbackMailboxBody({
          reference: intake.reference,
          feedbackType,
          sentiment,
          message: intake.message,
          replyEmail: intake.replyEmail,
          participantId: intake.participantId,
          anonymous: intake.anonymous,
          contextJson: intake.contextJson,
        });

        await attemptRecipientDelivery(ctx, {
          intake,
          channel: "mailbox",
          from: config.from,
          to: config.mailbox,
          subject: mailboxSubject,
          text: mailboxText,
          replyTo: intake.replyEmail,
          nowMs,
        });

        if (intake.anonymous || !intake.replyEmail) {
          if (shouldAttemptDelivery(intake.receiptDelivery, nowMs)) {
            await markReceiptSkipped(
              ctx,
              args.intakeId,
              intake.anonymous ? "anonymous_feedback" : "no_reply_email",
              nowMs,
            );
          }
          return null;
        }

        const receiptSubject = `Only Pools Feedback — ${intake.reference}`;
        const receiptText = formatFeedbackReceiptBody({
          reference: intake.reference,
          feedbackType,
          sentiment,
          message: intake.message,
        });

        await attemptRecipientDelivery(ctx, {
          intake,
          channel: "receipt",
          from: config.from,
          to: intake.replyEmail,
          subject: receiptSubject,
          text: receiptText,
          nowMs,
        });

        return null;
      }

      if (intake.lane !== "support") {
        const skippedAtMs = Date.now();
        if (shouldAttemptDelivery(intake.mailboxDelivery, skippedAtMs)) {
          await ctx.runMutation(internal.helpIntake.recordDeliveryAttempt, {
            intakeId: args.intakeId,
            channel: "mailbox",
            outcome: {
              kind: "skipped",
              failureClass: "unsupported_lane",
              attemptAtMs: skippedAtMs,
            },
          });
        }
        if (shouldAttemptDelivery(intake.receiptDelivery, skippedAtMs)) {
          await markReceiptSkipped(ctx, args.intakeId, "unsupported_lane", skippedAtMs);
        }
        return null;
      }

      const category = intake.supportCategory ?? "Other";
      const replyEmail = intake.replyEmail;
      if (!replyEmail) {
        const failedAtMs = Date.now();
        if (shouldAttemptDelivery(intake.mailboxDelivery, failedAtMs)) {
          await ctx.runMutation(internal.helpIntake.recordDeliveryAttempt, {
            intakeId: args.intakeId,
            channel: "mailbox",
            outcome: {
              kind: "failure",
              failureClass: "missing_reply_email",
              retryable: false,
              attemptAtMs: failedAtMs,
            },
          });
        }
        if (shouldAttemptDelivery(intake.receiptDelivery, failedAtMs)) {
          await markReceiptSkipped(ctx, args.intakeId, "missing_reply_email", failedAtMs);
        }
        return null;
      }

      const mailboxSubject = `[Support] ${category} · ${intake.reference}`;
      const mailboxText = formatSupportMailboxBody({
        reference: intake.reference,
        category,
        message: intake.message,
        replyEmail,
        participantId: intake.participantId,
        contextJson: intake.contextJson,
      });

      await attemptRecipientDelivery(ctx, {
        intake,
        channel: "mailbox",
        from: config.from,
        to: config.mailbox,
        subject: mailboxSubject,
        text: mailboxText,
        replyTo: replyEmail,
        nowMs,
      });

      const receiptSubject = `Only Pools Support — ${intake.reference}`;
      const receiptText = formatSupportReceiptBody({
        reference: intake.reference,
        category,
        message: intake.message,
      });

      await attemptRecipientDelivery(ctx, {
        intake,
        channel: "receipt",
        from: config.from,
        to: replyEmail,
        subject: receiptSubject,
        text: receiptText,
        nowMs,
      });
    } finally {
      await ctx.runMutation(internal.helpIntake.scheduleNextDeliveryIfNeeded, {
        intakeId: args.intakeId,
        nowMs: Date.now(),
      });
    }

    return null;
  },
});
