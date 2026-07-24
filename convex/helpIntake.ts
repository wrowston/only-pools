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
  MIN_HELP_FORM_COMPLETION_MS,
  SUPPORT_CATEGORY_SET,
  FEEDBACK_SENTIMENT_SET,
  FEEDBACK_TYPE_SET,
  type FeedbackSentiment,
  type FeedbackType,
  type SupportCategory,
} from "./lib/helpConstants";
import {
  computeNextAttemptDelayMs,
  isDeliveryExhausted,
  type DeliveryRecipient,
} from "./lib/helpDeliveryPolicy";
import { generateHelpReference } from "./lib/helpReference";
import { captureHelpDeliveryExhausted } from "./lib/sentry";
import { enqueueSentryDelivery } from "./sentry";
import { checkAndIncrementHelpThrottle } from "./lib/helpThrottle";
import {
  assertTextSafeForHelp,
  buildStoredHelpContext,
  sanitizeClientHelpContext,
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

export type ValidatedFeedbackSubmission = {
  lane: "feedback";
  idempotencyKey: string;
  sentiment: FeedbackSentiment;
  feedbackType: FeedbackType;
  message: string;
  replyEmail?: string;
  anonymous: boolean;
  includeDiagnostics: boolean;
  contextJson?: string;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateFormTiming(args: {
  startedAtMs: unknown;
  completedAtMs?: unknown;
  acceptedAtMs: number;
}): FieldErrors | null {
  if (
    typeof args.startedAtMs !== "number" ||
    !Number.isFinite(args.startedAtMs) ||
    args.startedAtMs <= 0
  ) {
    return {
      form: "Please take a moment to review before submitting.",
    };
  }

  const completedAtMs =
    typeof args.completedAtMs === "number" &&
    Number.isFinite(args.completedAtMs) &&
    args.completedAtMs > 0
      ? args.completedAtMs
      : args.acceptedAtMs;

  if (completedAtMs - args.startedAtMs < MIN_HELP_FORM_COMPLETION_MS) {
    return {
      form: "Please take a moment to review before submitting.",
    };
  }

  return null;
}

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
    errors.lane = "lane must be support";
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
        contextJson = sanitizeClientHelpContext(
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

export function validateFeedbackIntake(args: {
  lane: unknown;
  idempotencyKey: unknown;
  sentiment: unknown;
  feedbackType: unknown;
  message: unknown;
  replyEmail: unknown;
  anonymous: unknown;
  honeypot: unknown;
  includeDiagnostics: unknown;
  context: unknown;
  participantIdFromClient?: unknown;
}):
  | { ok: true; value: ValidatedFeedbackSubmission }
  | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};

  if (args.lane !== "feedback") {
    errors.lane = "lane must be feedback";
  }

  if (typeof args.idempotencyKey !== "string" || args.idempotencyKey.trim().length === 0) {
    errors.idempotencyKey = "idempotencyKey is required";
  } else if (args.idempotencyKey.trim().length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    errors.idempotencyKey = "idempotencyKey is too long";
  }

  let sentiment: FeedbackSentiment | undefined;
  if (typeof args.sentiment !== "string" || args.sentiment.trim().length === 0) {
    errors.sentiment = "sentiment is required for feedback";
  } else if (!FEEDBACK_SENTIMENT_SET.has(args.sentiment)) {
    errors.sentiment = "sentiment is not a valid feedback sentiment";
  } else {
    sentiment = args.sentiment as FeedbackSentiment;
  }

  let feedbackType: FeedbackType | undefined;
  if (typeof args.feedbackType !== "string" || args.feedbackType.trim().length === 0) {
    errors.feedbackType = "feedbackType is required for feedback";
  } else if (!FEEDBACK_TYPE_SET.has(args.feedbackType)) {
    errors.feedbackType = "feedbackType is not a valid feedback type";
  } else {
    feedbackType = args.feedbackType as FeedbackType;
  }

  let message = "";
  if (args.message !== undefined && args.message !== null) {
    if (typeof args.message !== "string") {
      errors.message = "message must be a string";
    } else {
      message = args.message.trim();
      if (message.length > MAX_MESSAGE_LENGTH) {
        errors.message = `message must be at most ${MAX_MESSAGE_LENGTH} characters`;
      }
    }
  }

  const anonymous = args.anonymous === true;

  let replyEmail: string | undefined;
  if (!anonymous && args.replyEmail !== undefined && args.replyEmail !== null) {
    if (typeof args.replyEmail !== "string") {
      errors.replyEmail = "replyEmail must be a string";
    } else {
      const trimmed = args.replyEmail.trim();
      if (trimmed.length > 0) {
        if (trimmed.length > MAX_REPLY_EMAIL_LENGTH) {
          errors.replyEmail = "replyEmail is too long";
        } else if (!EMAIL_PATTERN.test(trimmed)) {
          errors.replyEmail = "replyEmail must be a valid email address";
        } else {
          replyEmail = trimmed;
        }
      }
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
        contextJson = sanitizeClientHelpContext(
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
      lane: "feedback",
      idempotencyKey: (args.idempotencyKey as string).trim(),
      sentiment: sentiment!,
      feedbackType: feedbackType!,
      message,
      replyEmail,
      anonymous,
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

export const verifyPoolMembership = internalQuery({
  args: {
    poolId: v.id("pools"),
    participantId: v.id("participants"),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const membership = await ctx.db
      .query("poolMemberships")
      .withIndex("by_poolId_and_participantId", (q) =>
        q.eq("poolId", args.poolId).eq("participantId", args.participantId),
      )
      .unique();
    return membership?.status === "active";
  },
});

export type ResolvedIntakeIdentity = {
  participantId?: Id<"participants">;
  email?: string;
  poolId?: Id<"pools">;
};

export function resolveStoredHelpContext(args: {
  lane: "support" | "feedback";
  anonymous: boolean;
  includeDiagnostics: boolean;
  clientContextJson?: string;
  identity: ResolvedIntakeIdentity;
}): string | undefined {
  const enrichIdentity =
    args.lane === "support" ||
    (args.lane === "feedback" && !args.anonymous && args.identity.participantId);

  try {
    return buildStoredHelpContext(
      {
        includeDiagnostics: args.includeDiagnostics,
        clientContextJson: args.clientContextJson,
        accountId: enrichIdentity ? args.identity.participantId : undefined,
        email: enrichIdentity ? args.identity.email : undefined,
        poolId: enrichIdentity ? args.identity.poolId : undefined,
      },
      MAX_CONTEXT_FIELD_LENGTH,
      MAX_CONTEXT_JSON_LENGTH,
    );
  } catch (error) {
    throw error instanceof Error ? error : new Error("Invalid context");
  }
}

export function parsePoolIdHint(value: unknown): Id<"pools"> | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed as Id<"pools">;
}

export const getIntakeById = internalQuery({
  args: { intakeId: v.id("helpIntake") },
  returns: v.union(
    v.object({
      _id: v.id("helpIntake"),
      reference: v.string(),
      lane: laneValidator,
      supportCategory: v.optional(v.string()),
      sentiment: v.optional(
        v.union(
          v.literal("negative"),
          v.literal("neutral"),
          v.literal("positive"),
        ),
      ),
      feedbackType: v.optional(
        v.union(v.literal("problem"), v.literal("idea"), v.literal("liked")),
      ),
      message: v.string(),
      replyEmail: v.optional(v.string()),
      participantId: v.optional(v.id("participants")),
      anonymous: v.boolean(),
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
      sentiment: doc.sentiment,
      feedbackType: doc.feedbackType,
      message: doc.message,
      replyEmail: doc.replyEmail,
      participantId: doc.participantId,
      anonymous: doc.anonymous,
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
    sentiment: v.optional(
      v.union(
        v.literal("negative"),
        v.literal("neutral"),
        v.literal("positive"),
      ),
    ),
    feedbackType: v.optional(
      v.union(v.literal("problem"), v.literal("idea"), v.literal("liked")),
    ),
    message: v.string(),
    replyEmail: v.optional(v.string()),
    anonymous: v.boolean(),
    participantId: v.optional(v.id("participants")),
    poolId: v.optional(v.id("pools")),
    contextJson: v.optional(v.string()),
    includeDiagnostics: v.boolean(),
    acceptedAtMs: v.number(),
    accountKeyHash: v.optional(v.string()),
    networkKeyHash: v.optional(v.string()),
  },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      intakeId: v.id("helpIntake"),
      reference: v.string(),
      acceptedAtMs: v.number(),
      lane: laneValidator,
      isReplay: v.boolean(),
    }),
    v.object({
      ok: v.literal(false),
      reason: v.union(v.literal("rate_limited")),
    }),
  ),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("helpIntake")
      .withIndex("by_idempotencyKey", (q) =>
        q.eq("idempotencyKey", args.idempotencyKey),
      )
      .unique();

    if (existing) {
      return {
        ok: true as const,
        intakeId: existing._id,
        reference: existing.reference,
        acceptedAtMs: existing.acceptedAtMs,
        lane: existing.lane,
        isReplay: true,
      };
    }

    const throttleOk = await checkAndIncrementHelpThrottle(ctx, {
      accountKeyHash: args.accountKeyHash,
      networkKeyHash: args.networkKeyHash,
      nowMs: args.acceptedAtMs,
    });
    if (!throttleOk) {
      return { ok: false as const, reason: "rate_limited" as const };
    }

    const reference = generateHelpReference();
    const expiresAtMs = args.acceptedAtMs + HELP_RETENTION_MS;

    const intakeId = await ctx.db.insert("helpIntake", {
      reference,
      idempotencyKey: args.idempotencyKey,
      lane: args.lane,
      supportCategory: args.supportCategory,
      sentiment: args.sentiment,
      feedbackType: args.feedbackType,
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
      ok: true as const,
      intakeId,
      reference,
      acceptedAtMs: args.acceptedAtMs,
      lane: args.lane,
      isReplay: false,
    };
  },
});

export const recordDeliveryAttempt = internalMutation({
  args: {
    intakeId: v.id("helpIntake"),
    channel: v.union(v.literal("mailbox"), v.literal("receipt")),
    outcome: v.union(
      v.object({
        kind: v.literal("success"),
        providerMessageId: v.string(),
        attemptAtMs: v.number(),
      }),
      v.object({
        kind: v.literal("failure"),
        failureClass: v.string(),
        retryable: v.boolean(),
        attemptAtMs: v.number(),
      }),
      v.object({
        kind: v.literal("skipped"),
        failureClass: v.string(),
        attemptAtMs: v.number(),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const doc = await ctx.db.get("helpIntake", args.intakeId);
    if (!doc) return null;

    const current =
      args.channel === "mailbox" ? doc.mailboxDelivery : doc.receiptDelivery;

    if (current.status === "sent" || current.status === "skipped") {
      return null;
    }

    if (args.outcome.kind === "skipped") {
      if (current.status === "failed") {
        return null;
      }
      await ctx.db.patch(args.intakeId, {
        [args.channel === "mailbox" ? "mailboxDelivery" : "receiptDelivery"]: {
          status: "skipped" as const,
          attemptCount: current.attemptCount,
          lastAttemptAtMs: args.outcome.attemptAtMs,
          failureClass: args.outcome.failureClass,
        },
      });
      return null;
    }

    const attemptCount = current.attemptCount + 1;

    if (args.outcome.kind === "success") {
      await ctx.db.patch(args.intakeId, {
        [args.channel === "mailbox" ? "mailboxDelivery" : "receiptDelivery"]: {
          status: "sent" as const,
          attemptCount,
          lastAttemptAtMs: args.outcome.attemptAtMs,
          providerMessageId: args.outcome.providerMessageId,
          failureClass: undefined,
          nextAttemptAtMs: undefined,
        },
      });
      return null;
    }

    const classified = {
      failureClass: args.outcome.failureClass,
      retryable: args.outcome.retryable,
    };
    const retryable = classified.retryable && !isDeliveryExhausted(attemptCount);

    if (retryable) {
      const delayMs = computeNextAttemptDelayMs(attemptCount);
      const nextAttemptAtMs = args.outcome.attemptAtMs + delayMs;
      await ctx.db.patch(args.intakeId, {
        [args.channel === "mailbox" ? "mailboxDelivery" : "receiptDelivery"]: {
          status: "pending" as const,
          attemptCount,
          lastAttemptAtMs: args.outcome.attemptAtMs,
          failureClass: classified.failureClass,
          nextAttemptAtMs,
        },
      });
      await ctx.scheduler.runAfter(
        delayMs,
        internal.helpDelivery.deliverIntake,
        { intakeId: args.intakeId },
      );
      return null;
    }

    await ctx.db.patch(args.intakeId, {
      [args.channel === "mailbox" ? "mailboxDelivery" : "receiptDelivery"]: {
        status: "failed" as const,
        attemptCount,
        lastAttemptAtMs: args.outcome.attemptAtMs,
        failureClass: classified.failureClass,
        nextAttemptAtMs: undefined,
      },
    });

    if (classified.retryable && isDeliveryExhausted(attemptCount)) {
      const capture = captureHelpDeliveryExhausted({
        lane: doc.lane,
        recipient: args.channel as DeliveryRecipient,
        failureClass: classified.failureClass,
        attemptCount,
      });
      await enqueueSentryDelivery(ctx, capture);
    }

    return null;
  },
});

export type HelpIntakeDoc = Doc<"helpIntake">;
