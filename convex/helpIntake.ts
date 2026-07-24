import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
} from "./_generated/server";
import {
  HELP_RETENTION_MS,
  MAX_CONTEXT_FIELD_LENGTH,
  MAX_CONTEXT_JSON_LENGTH,
  MAX_IDEMPOTENCY_KEY_LENGTH,
  MAX_MESSAGE_LENGTH,
  MAX_REPLY_EMAIL_LENGTH,
  SUPPORT_CATEGORY_SET,
  type SupportCategory,
} from "./lib/helpConstants";
import { generateHelpReference } from "./lib/helpReference";
import {
  assertTextSafeForHelp,
  sanitizeHelpContext,
} from "./lib/helpSanitize";

const laneValidator = v.union(v.literal("support"), v.literal("feedback"));

const deliveryStateValidator = v.object({
  status: v.union(
    v.literal("pending"),
    v.literal("sent"),
    v.literal("failed"),
    v.literal("skipped"),
  ),
  attemptCount: v.number(),
  nextAttemptAtMs: v.optional(v.number()),
  providerMessageId: v.optional(v.string()),
  failureClass: v.optional(v.string()),
  lastAttemptAtMs: v.optional(v.number()),
});

const pendingDelivery = {
  status: "pending" as const,
  attemptCount: 0,
};

export type FieldErrors = Record<string, string>;

export type ValidatedSupportSubmission = {
  lane: "support";
  idempotencyKey: string;
  replyEmail: string;
  category: SupportCategory;
  message: string;
  anonymous: boolean;
  includeDiagnostics: boolean;
  contextJson?: string;
  participantId?: Id<"participants">;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateSupportIntake(args: {
  lane: unknown;
  idempotencyKey: unknown;
  replyEmail: unknown;
  category: unknown;
  message: unknown;
  honeypot: unknown;
  includeDiagnostics: unknown;
  context: unknown;
  participantIdFromClient?: unknown;
}): { ok: true; value: Omit<ValidatedSupportSubmission, "participantId"> } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};

  if (args.lane !== "support") {
    if (args.lane === "feedback") {
      return { ok: false, errors: { lane: "Feedback lane is not yet available" } };
    }
    errors.lane = "lane must be support or feedback";
  }

  if (typeof args.idempotencyKey !== "string" || args.idempotencyKey.trim().length === 0) {
    errors.idempotencyKey = "idempotencyKey is required";
  } else if (args.idempotencyKey.trim().length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    errors.idempotencyKey = "idempotencyKey is too long";
  }

  let replyEmail = "";
  if (typeof args.replyEmail !== "string" || args.replyEmail.trim().length === 0) {
    errors.replyEmail = "replyEmail is required for support";
  } else {
    replyEmail = args.replyEmail.trim();
    if (replyEmail.length > MAX_REPLY_EMAIL_LENGTH) {
      errors.replyEmail = "replyEmail is too long";
    } else if (!EMAIL_PATTERN.test(replyEmail)) {
      errors.replyEmail = "replyEmail must be a valid email address";
    }
  }

  let category: SupportCategory | undefined;
  if (typeof args.category !== "string" || args.category.trim().length === 0) {
    errors.category = "category is required for support";
  } else if (!SUPPORT_CATEGORY_SET.has(args.category)) {
    errors.category = "category is not a valid support category";
  } else {
    category = args.category as SupportCategory;
  }

  let message = "";
  if (typeof args.message !== "string" || args.message.trim().length === 0) {
    errors.message = "message is required";
  } else {
    message = args.message.trim();
    if (message.length > MAX_MESSAGE_LENGTH) {
      errors.message = `message must be at most ${MAX_MESSAGE_LENGTH} characters`;
    }
  }

  if (typeof args.honeypot === "string" && args.honeypot.trim().length > 0) {
    errors.honeypot = "Invalid submission";
  }

  const includeDiagnostics = args.includeDiagnostics === true;

  let contextJson: string | undefined;
  if (args.context !== undefined && args.context !== null) {
    if (typeof args.context !== "object" || Array.isArray(args.context)) {
      errors.context = "context must be an object";
    } else {
      try {
        contextJson = sanitizeHelpContext(
          args.context as Record<string, unknown>,
          MAX_CONTEXT_FIELD_LENGTH,
          MAX_CONTEXT_JSON_LENGTH,
        );
      } catch (error) {
        errors.context =
          error instanceof Error ? error.message : "Invalid context";
      }
    }
  }

  if (message.length > 0) {
    try {
      assertTextSafeForHelp(message, "message");
    } catch (error) {
      errors.message =
        error instanceof Error ? error.message : "message contains disallowed content";
    }
  }

  if (args.participantIdFromClient !== undefined) {
    // Silently ignored — never trust client-supplied participant ids.
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      lane: "support",
      idempotencyKey: (args.idempotencyKey as string).trim(),
      replyEmail,
      category: category!,
      message,
      anonymous: false,
      includeDiagnostics,
      contextJson,
    },
  };
}

export const lookupParticipantByToken = internalQuery({
  args: { tokenIdentifier: v.string() },
  returns: v.union(
    v.object({
      _id: v.id("participants"),
      email: v.optional(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const participant = await ctx.db
      .query("participants")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", args.tokenIdentifier),
      )
      .unique();
    if (!participant) return null;
    return { _id: participant._id, email: participant.email };
  },
});

export const getIntakeById = internalQuery({
  args: { intakeId: v.id("helpIntake") },
  returns: v.union(
    v.object({
      _id: v.id("helpIntake"),
      reference: v.string(),
      lane: laneValidator,
      supportCategory: v.optional(v.string()),
      message: v.string(),
      replyEmail: v.optional(v.string()),
      participantId: v.optional(v.id("participants")),
      contextJson: v.optional(v.string()),
      includeDiagnostics: v.boolean(),
      mailboxDelivery: deliveryStateValidator,
      receiptDelivery: deliveryStateValidator,
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const doc = await ctx.db.get("helpIntake", args.intakeId);
    if (!doc) return null;
    return {
      _id: doc._id,
      reference: doc.reference,
      lane: doc.lane,
      supportCategory: doc.supportCategory,
      message: doc.message,
      replyEmail: doc.replyEmail,
      participantId: doc.participantId,
      contextJson: doc.contextJson,
      includeDiagnostics: doc.includeDiagnostics,
      mailboxDelivery: doc.mailboxDelivery,
      receiptDelivery: doc.receiptDelivery,
    };
  },
});

export const acceptSubmission = internalMutation({
  args: {
    lane: laneValidator,
    idempotencyKey: v.string(),
    supportCategory: v.optional(v.string()),
    message: v.string(),
    replyEmail: v.optional(v.string()),
    anonymous: v.boolean(),
    participantId: v.optional(v.id("participants")),
    poolId: v.optional(v.id("pools")),
    contextJson: v.optional(v.string()),
    includeDiagnostics: v.boolean(),
    acceptedAtMs: v.number(),
  },
  returns: v.object({
    intakeId: v.id("helpIntake"),
    reference: v.string(),
    acceptedAtMs: v.number(),
    lane: laneValidator,
    isReplay: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("helpIntake")
      .withIndex("by_idempotencyKey", (q) =>
        q.eq("idempotencyKey", args.idempotencyKey),
      )
      .unique();

    if (existing) {
      return {
        intakeId: existing._id,
        reference: existing.reference,
        acceptedAtMs: existing.acceptedAtMs,
        lane: existing.lane,
        isReplay: true,
      };
    }

    const reference = generateHelpReference();
    const expiresAtMs = args.acceptedAtMs + HELP_RETENTION_MS;

    const intakeId = await ctx.db.insert("helpIntake", {
      reference,
      idempotencyKey: args.idempotencyKey,
      lane: args.lane,
      supportCategory: args.supportCategory,
      message: args.message,
      replyEmail: args.replyEmail,
      anonymous: args.anonymous,
      participantId: args.participantId,
      poolId: args.poolId,
      contextJson: args.contextJson,
      includeDiagnostics: args.includeDiagnostics,
      acceptedAtMs: args.acceptedAtMs,
      expiresAtMs,
      mailboxDelivery: { ...pendingDelivery },
      receiptDelivery: { ...pendingDelivery },
    });

    await ctx.scheduler.runAfter(0, internal.helpDelivery.deliverIntake, {
      intakeId,
    });

    return {
      intakeId,
      reference,
      acceptedAtMs: args.acceptedAtMs,
      lane: args.lane,
      isReplay: false,
    };
  },
});

export const recordDeliveryResult = internalMutation({
  args: {
    intakeId: v.id("helpIntake"),
    channel: v.union(v.literal("mailbox"), v.literal("receipt")),
    status: v.union(
      v.literal("sent"),
      v.literal("failed"),
      v.literal("skipped"),
    ),
    providerMessageId: v.optional(v.string()),
    failureClass: v.optional(v.string()),
    attemptAtMs: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const doc = await ctx.db.get("helpIntake", args.intakeId);
    if (!doc) return null;

    const current =
      args.channel === "mailbox" ? doc.mailboxDelivery : doc.receiptDelivery;

    const updated = {
      status: args.status,
      attemptCount: current.attemptCount + 1,
      lastAttemptAtMs: args.attemptAtMs,
      providerMessageId: args.providerMessageId,
      failureClass: args.failureClass,
    };

    if (args.channel === "mailbox") {
      await ctx.db.patch(args.intakeId, { mailboxDelivery: updated });
    } else {
      await ctx.db.patch(args.intakeId, { receiptDelivery: updated });
    }
    return null;
  },
});

export type HelpIntakeDoc = Doc<"helpIntake">;
