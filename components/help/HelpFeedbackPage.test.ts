import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  HelpFeedbackView,
  type HelpFeedbackViewProps,
} from "@/components/help/HelpFeedbackView";
import { guides } from "@/lib/guides";
import { suggestGuidesForHelpContext } from "@/lib/help";

function noop() {}

function baseProps(
  overrides: Partial<HelpFeedbackViewProps> = {},
): HelpFeedbackViewProps {
  return {
    source: "board",
    suggestedGuides: suggestGuidesForHelpContext("board"),
    signedInEmail: "player@example.test",
    activeLane: "support",
    onLaneChange: noop,
    category: "",
    replyEmail: "",
    message: "",
    honeypot: "",
    onCategoryChange: noop,
    onReplyEmailChange: noop,
    onMessageChange: noop,
    onHoneypotChange: noop,
    fieldErrors: {},
    formError: null,
    feedbackNotice: null,
    submitting: false,
    onSupportSubmit: (event) => event.preventDefault(),
    onFeedbackSubmit: (event) => event.preventDefault(),
    acceptance: null,
    ...overrides,
  };
}

function renderView(overrides: Partial<HelpFeedbackViewProps> = {}): string {
  return renderToStaticMarkup(
    createElement(HelpFeedbackView, baseProps(overrides)),
  );
}

describe("HelpFeedbackView", () => {
  it("shows both Get support and Share feedback lane toggles", () => {
    const markup = renderView();
    expect(markup).toContain("Get support");
    expect(markup).toContain("Share feedback");
    expect(markup).toContain('aria-pressed="true"');
  });

  it("renders required support fields and scope copy", () => {
    const markup = renderView();
    expect(markup).toContain('name="category"');
    expect(markup).toContain('name="replyEmail"');
    expect(markup).toContain('name="message"');
    expect(markup).toContain('name="company_website"');
    expect(markup).toContain("respond within 2 business days");
    expect(markup).toContain("does not pause or reopen Pick Locks");
  });

  it("links Pool conduct guidance to the abuse report guide", () => {
    const markup = renderView();
    expect(markup).toContain("/guides/archive-audit-and-reports#abuse-report");
    expect(markup).toContain("Abuse Report");
    expect(markup).toContain("Pool panel");
  });

  it("shows feedback placeholder when feedback lane is active", () => {
    const markup = renderView({ activeLane: "feedback" });
    expect(markup).toContain("Feedback intake is next");
    expect(markup).toContain("Coming soon");
  });

  it("shows a receipt when support is accepted", () => {
    const markup = renderView({
      acceptance: {
        reference: "OP-HELP-TEST-REF",
        category: "Technical problem",
        acceptedAtMs: 1_700_000_000_000,
      },
    });
    expect(markup).toContain("Support request received");
    expect(markup).toContain("OP-HELP-TEST-REF");
    expect(markup).toContain("Technical problem");
    expect(markup).toContain("respond within 2 business days");
  });

  it("lists suggested guides without blocking support", () => {
    const suggested = guides.filter((g) =>
      ["week-board-picks-and-locks", "survivor-picks"].includes(g.slug),
    );
    const markup = renderView({ suggestedGuides: suggested });
    expect(markup).toContain("Suggested guides");
    expect(markup).toContain("/guides/week-board-picks-and-locks");
    expect(markup).toContain("/guides/survivor-picks");
  });
});
