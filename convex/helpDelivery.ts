import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import * as Effect from "effect/Effect";
import { HELP_RESPONSE_EXPECTATION } from "./lib/helpConstants";
import { createLogger } from "./lib/log";
import { runEffect } from "./effect/run";
import {
  resolveSupportFromEmail,
  sendEmail,
} from "./effect/resend/client";

const log = createLogger("helpDelivery");

function formatSupportMailboxBody(args: {
  reference: string;
  category: string;
  message: string;
  replyEmail: string;
  participantId?: string;
  contextJson?: string;
  includeDiagnostics: boolean;
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
  includeDiagnostics: boolean;
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

function failureClassFromError(error: unknown): string {
  if (error instanceof Error) return error.name || "Error";
  return "UnknownError";
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
        includeDiagnostics: intake.includeDiagnostics,
      });

      const attemptAtMs = Date.now();

      const mailboxResult = await runEffect(
        sendEmail({
          from: config.from,
          to: config.mailbox,
          subject: mailboxSubject,
          text: mailboxText,
          replyTo: intake.replyEmail,
        }).pipe(
          Effect.match({
            onFailure: (error) => ({ ok: false as const, error }),
            onSuccess: (result) => ({ ok: true as const, result }),
          }),
        ),
      );

      if (mailboxResult.ok) {
        await ctx.runMutation(internal.helpIntake.recordDeliveryResult, {
          intakeId: args.intakeId,
          channel: "mailbox",
          status: "sent",
          providerMessageId: mailboxResult.result.id,
          attemptAtMs,
        });
      } else {
        log.error("feedback_mailbox_delivery_failed", {
          intakeId: args.intakeId,
          error: mailboxResult.error.message,
        });
        await ctx.runMutation(internal.helpIntake.recordDeliveryResult, {
          intakeId: args.intakeId,
          channel: "mailbox",
          status: "failed",
          attemptAtMs,
          failureClass: failureClassFromError(mailboxResult.error),
        });
      }

      if (intake.anonymous || !intake.replyEmail) {
        await ctx.runMutation(internal.helpIntake.recordDeliveryResult, {
          intakeId: args.intakeId,
          channel: "receipt",
          status: "skipped",
          attemptAtMs: Date.now(),
          failureClass: intake.anonymous ? "anonymous_feedback" : "no_reply_email",
        });
        return null;
      }

      const receiptSubject = `Only Pools Feedback — ${intake.reference}`;
      const receiptText = formatFeedbackReceiptBody({
        reference: intake.reference,
        feedbackType,
        sentiment,
        message: intake.message,
      });

      const receiptResult = await runEffect(
        sendEmail({
          from: config.from,
          to: intake.replyEmail,
          subject: receiptSubject,
          text: receiptText,
        }).pipe(
          Effect.match({
            onFailure: (error) => ({ ok: false as const, error }),
            onSuccess: (result) => ({ ok: true as const, result }),
          }),
        ),
      );

      if (receiptResult.ok) {
        await ctx.runMutation(internal.helpIntake.recordDeliveryResult, {
          intakeId: args.intakeId,
          channel: "receipt",
          status: "sent",
          providerMessageId: receiptResult.result.id,
          attemptAtMs: Date.now(),
        });
      } else {
        log.error("feedback_receipt_delivery_failed", {
          intakeId: args.intakeId,
          error: receiptResult.error.message,
        });
        await ctx.runMutation(internal.helpIntake.recordDeliveryResult, {
          intakeId: args.intakeId,
          channel: "receipt",
          status: "failed",
          attemptAtMs: Date.now(),
          failureClass: failureClassFromError(receiptResult.error),
        });
      }

      return null;
    }

    if (intake.lane !== "support") {
      const nowMs = Date.now();
      await ctx.runMutation(internal.helpIntake.recordDeliveryResult, {
        intakeId: args.intakeId,
        channel: "mailbox",
        status: "skipped",
        attemptAtMs: nowMs,
        failureClass: "unsupported_lane",
      });
      await ctx.runMutation(internal.helpIntake.recordDeliveryResult, {
        intakeId: args.intakeId,
        channel: "receipt",
        status: "skipped",
        attemptAtMs: nowMs,
        failureClass: "unsupported_lane",
      });
      return null;
    }

    const category = intake.supportCategory ?? "Other";
    const replyEmail = intake.replyEmail;
    if (!replyEmail) {
      const nowMs = Date.now();
      await ctx.runMutation(internal.helpIntake.recordDeliveryResult, {
        intakeId: args.intakeId,
        channel: "mailbox",
        status: "failed",
        attemptAtMs: nowMs,
        failureClass: "missing_reply_email",
      });
      await ctx.runMutation(internal.helpIntake.recordDeliveryResult, {
        intakeId: args.intakeId,
        channel: "receipt",
        status: "skipped",
        attemptAtMs: nowMs,
        failureClass: "missing_reply_email",
      });
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
      includeDiagnostics: intake.includeDiagnostics,
    });

    const attemptAtMs = Date.now();

    const mailboxResult = await runEffect(
      sendEmail({
        from: config.from,
        to: config.mailbox,
        subject: mailboxSubject,
        text: mailboxText,
        replyTo: replyEmail,
      }).pipe(
        Effect.match({
          onFailure: (error) => ({ ok: false as const, error }),
          onSuccess: (result) => ({ ok: true as const, result }),
        }),
      ),
    );

    if (mailboxResult.ok) {
      await ctx.runMutation(internal.helpIntake.recordDeliveryResult, {
        intakeId: args.intakeId,
        channel: "mailbox",
        status: "sent",
        providerMessageId: mailboxResult.result.id,
        attemptAtMs,
      });
    } else {
      log.error("mailbox_delivery_failed", {
        intakeId: args.intakeId,
        error: mailboxResult.error.message,
      });
      await ctx.runMutation(internal.helpIntake.recordDeliveryResult, {
        intakeId: args.intakeId,
        channel: "mailbox",
        status: "failed",
        attemptAtMs,
        failureClass: failureClassFromError(mailboxResult.error),
      });
    }

    const receiptSubject = `Only Pools Support — ${intake.reference}`;
    const receiptText = formatSupportReceiptBody({
      reference: intake.reference,
      category,
      message: intake.message,
    });

    const receiptResult = await runEffect(
      sendEmail({
        from: config.from,
        to: replyEmail,
        subject: receiptSubject,
        text: receiptText,
      }).pipe(
        Effect.match({
          onFailure: (error) => ({ ok: false as const, error }),
          onSuccess: (result) => ({ ok: true as const, result }),
        }),
      ),
    );

    if (receiptResult.ok) {
      await ctx.runMutation(internal.helpIntake.recordDeliveryResult, {
        intakeId: args.intakeId,
        channel: "receipt",
        status: "sent",
        providerMessageId: receiptResult.result.id,
        attemptAtMs: Date.now(),
      });
    } else {
      log.error("receipt_delivery_failed", {
        intakeId: args.intakeId,
        error: receiptResult.error.message,
      });
      await ctx.runMutation(internal.helpIntake.recordDeliveryResult, {
        intakeId: args.intakeId,
        channel: "receipt",
        status: "failed",
        attemptAtMs: Date.now(),
        failureClass: failureClassFromError(receiptResult.error),
      });
    }

    return null;
  },
});
