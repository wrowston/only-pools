import type { ComponentType } from "react";

type GuideModule = { default: ComponentType };

export const guideContentLoaders: Record<string, () => Promise<GuideModule>> = {
  "getting-started": () => import("@/content/guides/getting-started.mdx"),
  "create-a-pool": () => import("@/content/guides/create-a-pool.mdx"),
  "invites-and-joining": () => import("@/content/guides/invites-and-joining.mdx"),
  "members-roles-and-ownership": () => import("@/content/guides/members-roles-and-ownership.mdx"),
  "archive-audit-and-reports": () => import("@/content/guides/archive-audit-and-reports.mdx"),
  "week-board-picks-and-locks": () => import("@/content/guides/week-board-picks-and-locks.mdx"),
  "survivor-picks": () => import("@/content/guides/survivor-picks.mdx"),
  "confidence-picks": () => import("@/content/guides/confidence-picks.mdx"),
  "standings-and-results": () => import("@/content/guides/standings-and-results.mdx"),
  "pool-rules-and-lifecycle": () => import("@/content/guides/pool-rules-and-lifecycle.mdx"),
  "accounts-verification-and-privacy": () => import("@/content/guides/accounts-verification-and-privacy.mdx"),
  faq: () => import("@/content/guides/faq.mdx"),
};
