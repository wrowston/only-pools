import { guides, type Guide, type GuideSlug } from "@/lib/guides";
import {
  HELP_RESPONSE_EXPECTATION,
  SUPPORT_CATEGORIES,
  type SupportCategory,
} from "@/lib/helpConstants";

export { HELP_RESPONSE_EXPECTATION, SUPPORT_CATEGORIES, type SupportCategory };

const guideBySlug = new Map<GuideSlug, Guide>(
  guides.map((guide) => [guide.slug, guide]),
);

function guidesForSlugs(slugs: readonly GuideSlug[]): Guide[] {
  return slugs.flatMap((slug) => {
    const guide = guideBySlug.get(slug);
    return guide ? [guide] : [];
  });
}

/**
 * Suggest contextual Guides from a `source` query param on /help.
 */
export function suggestGuidesForHelpContext(source: string | null): Guide[] {
  const normalized = source?.trim().toLowerCase() ?? "";

  if (/(board|picks|week-board)/.test(normalized)) {
    return guidesForSlugs([
      "week-board-picks-and-locks",
      "survivor-picks",
      "confidence-picks",
    ]);
  }

  if (/standings/.test(normalized)) {
    return guidesForSlugs(["standings-and-results"]);
  }

  if (/(pool|members)/.test(normalized)) {
    return guidesForSlugs([
      "members-roles-and-ownership",
      "invites-and-joining",
    ]);
  }

  if (/(account|sign-in|signin)/.test(normalized)) {
    return guidesForSlugs([
      "accounts-verification-and-privacy",
      "getting-started",
    ]);
  }

  if (/(invite|join)/.test(normalized)) {
    return guidesForSlugs(["invites-and-joining"]);
  }

  return guidesForSlugs([
    "faq",
    "getting-started",
    "week-board-picks-and-locks",
  ]);
}
