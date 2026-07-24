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

function formatMailboxBody(args: {
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
  if (args.includeDiagnostics && args.contextJson) {
    lines.push("", "Diagnostics:", args.contextJson);
  }
  return lines.join("\n");
}

function formatReceiptBody(args: {
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

    if (intake.lane !== "support") {
      await ctx.runMutation(internal.helpIntake.recordDeliveryResult, {
        intakeId: args.intakeId,
        channel: "mailbox",
        status: "skipped",
        attemptAtMs: Date.now(),
        failureClass: "unsupported_lane",
      });
      await ctx.runMutation(internal.helpIntake.recordDeliveryResult, {
        intakeId: args.intakeId,
        channel: "receipt",
        status: "skipped",
        attemptAtMs: Date.now(),
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

    const configEffect = resolveSupportFromEmail();
    const config = await runEffect(configEffect);

    const mailboxSubject = `[Support] ${category} · ${intake.reference}`;
    const mailboxText = formatMailboxBody({
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
    const receiptText = formatReceiptBody({
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
