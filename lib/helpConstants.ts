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

export const HELP_RESPONSE_EXPECTATION =
  "We aim to respond within 2 business days.";
