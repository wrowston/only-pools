import { describe, expect, it } from "vitest";
import { GUIDE_CATEGORIES, guides, searchGuides } from "./guides";

describe("guides catalog", () => {
  it("publishes the approved 12-page documentation set", () => {
    expect(guides.map((guide) => guide.slug)).toEqual([
      "getting-started",
      "create-a-pool",
      "invites-and-joining",
      "members-roles-and-ownership",
      "archive-audit-and-reports",
      "week-board-picks-and-locks",
      "survivor-picks",
      "confidence-picks",
      "standings-and-results",
      "pool-rules-and-lifecycle",
      "accounts-verification-and-privacy",
      "faq",
    ]);

    expect(new Set(guides.map((guide) => guide.slug)).size).toBe(12);
    expect(new Set(guides.map((guide) => guide.category))).toEqual(
      new Set(GUIDE_CATEGORIES),
    );
    expect(guides.every((guide) => guide.title && guide.summary)).toBe(true);
  });
});

describe("guide search", () => {
  it("finds guides from titles, summaries, headings, and keywords", () => {
    expect(searchGuides("weekly tiebreaker")[0]?.slug).toBe(
      "confidence-picks",
    );
    expect(searchGuides("rotate invitation link")[0]?.slug).toBe(
      "invites-and-joining",
    );
    expect(searchGuides("who can see my phone")[0]?.slug).toBe(
      "accounts-verification-and-privacy",
    );
  });
});
