import { describe, expect, it } from "vitest";
import { SUPPORT_CATEGORIES } from "@/lib/helpConstants";
import { suggestGuidesForHelpContext } from "@/lib/help";

describe("SUPPORT_CATEGORIES", () => {
  it("matches the approved backend category list", () => {
    expect(SUPPORT_CATEGORIES).toEqual([
      "Account or sign-in",
      "Joining or Pool Invites",
      "Picks or Pick Locks",
      "Scoring or Standings",
      "Running a Pool",
      "Technical problem",
      "Other",
    ]);
  });
});

describe("suggestGuidesForHelpContext", () => {
  it("suggests pick guides for board-like sources", () => {
    const slugs = suggestGuidesForHelpContext("board").map((g) => g.slug);
    expect(slugs).toEqual([
      "week-board-picks-and-locks",
      "survivor-picks",
      "confidence-picks",
    ]);
  });

  it("suggests standings guide for standings source", () => {
    expect(suggestGuidesForHelpContext("standings").map((g) => g.slug)).toEqual([
      "standings-and-results",
    ]);
  });

  it("suggests pool membership guides for pool sources", () => {
    expect(suggestGuidesForHelpContext("pool").map((g) => g.slug)).toEqual([
      "members-roles-and-ownership",
      "invites-and-joining",
    ]);
  });

  it("suggests account guides for sign-in sources", () => {
    expect(suggestGuidesForHelpContext("sign-in").map((g) => g.slug)).toEqual([
      "accounts-verification-and-privacy",
      "getting-started",
    ]);
  });

  it("suggests invite guide for join sources", () => {
    expect(suggestGuidesForHelpContext("join").map((g) => g.slug)).toEqual([
      "invites-and-joining",
    ]);
  });

  it("falls back to default guides when source is unknown", () => {
    expect(suggestGuidesForHelpContext(null).map((g) => g.slug)).toEqual([
      "faq",
      "getting-started",
      "week-board-picks-and-locks",
    ]);
  });
});
