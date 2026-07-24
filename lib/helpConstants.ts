/** Client-safe Help & Feedback constants — keep in sync with convex/lib/helpConstants.ts */

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

/** Feedback sentiment values — keep in sync with convex/lib/helpConstants.ts */
export const FEEDBACK_SENTIMENTS = [
  "negative",
  "neutral",
  "positive",
] as const;

export type FeedbackSentiment = (typeof FEEDBACK_SENTIMENTS)[number];

/** Feedback type values — keep in sync with convex/lib/helpConstants.ts */
export const FEEDBACK_TYPES = ["problem", "idea", "liked"] as const;

export type FeedbackType = (typeof FEEDBACK_TYPES)[number];

export const FEEDBACK_TYPE_LABELS: Record<FeedbackType, string> = {
  problem: "Problem",
  idea: "Idea",
  liked: "Something I liked",
};

export const FEEDBACK_SENTIMENT_LABELS: Record<FeedbackSentiment, string> = {
  negative: "Negative",
  neutral: "Neutral",
  positive: "Positive",
};

export const HELP_RESPONSE_EXPECTATION =
  "We aim to respond within 2 business days.";

export const HELP_RETENTION_DAYS = 90;
