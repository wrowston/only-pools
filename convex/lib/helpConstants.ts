/** Help & Feedback intake constants — shared by HTTP, mutations, and tests. */

export const HELP_RETENTION_DAYS = 90;
export const HELP_RETENTION_MS = HELP_RETENTION_DAYS * 24 * 60 * 60 * 1000;

export const HELP_THROTTLE_WINDOW_HOURS = 24;
export const HELP_THROTTLE_WINDOW_MS =
  HELP_THROTTLE_WINDOW_HOURS * 60 * 60 * 1000;

/** Approved Support categories (exact display strings). */
export const SUPPORT_CATEGORIES = [
  "Account or sign-in",
  "Joining or Pool Invites",
  "Picks or Pick Locks",
  "Scoring or Standings",
  "Running a Pool",
  "Technical problem",
  "Other",
] as const;

export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

export const SUPPORT_CATEGORY_SET = new Set<string>(SUPPORT_CATEGORIES);

/** Feedback sentiment values. */
export const FEEDBACK_SENTIMENTS = [
  "negative",
  "neutral",
  "positive",
] as const;

export type FeedbackSentiment = (typeof FEEDBACK_SENTIMENTS)[number];

export const FEEDBACK_SENTIMENT_SET = new Set<string>(FEEDBACK_SENTIMENTS);

/** Feedback type values. */
export const FEEDBACK_TYPES = ["problem", "idea", "liked"] as const;

export type FeedbackType = (typeof FEEDBACK_TYPES)[number];

export const FEEDBACK_TYPE_SET = new Set<string>(FEEDBACK_TYPES);

export const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
export const MAX_REPLY_EMAIL_LENGTH = 320;
export const MAX_MESSAGE_LENGTH = 5000;
export const MAX_CONTEXT_FIELD_LENGTH = 500;
export const MAX_CONTEXT_JSON_LENGTH = 2048;

/** Per-account support submissions per 24h window (#22 expands enforcement). */
export const RATE_LIMIT_ACCOUNT_PER_WINDOW = 10;

/** Per-network support submissions per 24h window (#22 expands enforcement). */
export const RATE_LIMIT_NETWORK_PER_WINDOW = 30;

export const HELP_RESPONSE_EXPECTATION =
  "We aim to respond within 2 business days.";
