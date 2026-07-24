import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  HelpFeedbackView,
  type HelpFeedbackViewProps,
} from "@/components/help/HelpFeedbackView";
import { guides } from "@/lib/guides";
import { suggestGuidesForHelpContext } from "@/lib/help";
import { buildHelpContextDisclosure } from "@/lib/helpDiagnostics";

function noop() {}

const defaultDisclosure = buildHelpContextDisclosure({
  lane: "support",
  pathname: "/help",
  search: "",
  userAgent: "Mozilla/5.0 Chrome Safari",
  includeDiagnostics: true,
  signedIn: true,
  signedInEmail: "player@example.test",
  signedInAccountId: "participant_abc",
  anonymousFeedback: false,
});

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
    feedbackSentiment: "",
    feedbackType: "",
    feedbackMessage: "",
    feedbackReplyEmail: "",
    feedbackAnonymous: false,
    onFeedbackSentimentChange: noop,
    onFeedbackTypeChange: noop,
    onFeedbackMessageChange: noop,
    onFeedbackReplyEmailChange: noop,
    onFeedbackAnonymousChange: noop,
    includeDiagnostics: true,
    onIncludeDiagnosticsChange: noop,
    contextDisclosure: defaultDisclosure,
    fieldErrors: {},
    formError: null,
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
    expect(markup).toContain("Do not include passwords");
    expect(markup).toContain("Hidden Picks");
    expect(markup).toContain("Pool Invite credentials");
  });

  it("links Pool conduct guidance to the abuse report guide", () => {
    const markup = renderView();
    expect(markup).toContain("/guides/archive-audit-and-reports#abuse-report");
    expect(markup).toContain("Abuse Report");
    expect(markup).toContain("Pool panel");
  });

  it("renders feedback form with sentiment, type, optional fields, and privacy copy", () => {
    const markup = renderView({ activeLane: "feedback" });
    expect(markup).toContain('name="sentiment"');
    expect(markup).toContain('name="feedbackType"');
    expect(markup).toContain('name="feedbackMessage"');
    expect(markup).toContain('name="feedbackReplyEmail"');
    expect(markup).toContain("private by default");
    expect(markup).toMatch(/do not publish it as a testimonial/i);
    expect(markup).toContain("Do not include passwords");
    expect(markup).toContain("Submit feedback");
    expect(markup).not.toContain("Coming soon");
  });

  it("shows anonymous checkbox for signed-in users on feedback lane", () => {
    const markup = renderView({
      activeLane: "feedback",
      signedInEmail: "player@example.test",
    });
    expect(markup).toContain('name="anonymous"');
    expect(markup).toContain("Submit anonymously");
    expect(markup).toContain("will not store your account");
  });

  it("hides follow-up email when anonymous feedback is selected", () => {
    const signedIn = renderView({
      activeLane: "feedback",
      signedInEmail: "player@example.test",
      feedbackAnonymous: true,
    });
    expect(signedIn).not.toContain('name="feedbackReplyEmail"');

    const publicMarkup = renderView({
      activeLane: "feedback",
      signedInEmail: null,
      feedbackAnonymous: false,
    });
    expect(publicMarkup).toContain('name="feedbackReplyEmail"');
    expect(publicMarkup).not.toContain('name="anonymous"');
  });

  it("shows support receipt when support is accepted", () => {
    const markup = renderView({
      acceptance: {
        kind: "support",
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

  it("shows anonymous feedback acknowledgement without personal reply promise", () => {
    const markup = renderView({
      acceptance: {
        kind: "feedback",
        reference: "OP-HELP-FB-REF",
        feedbackType: "idea",
        sentiment: "neutral",
        contactable: false,
        acceptedAtMs: 1_700_000_000_000,
      },
    });
    expect(markup).toContain("Feedback received");
    expect(markup).toContain("recorded anonymously");
    expect(markup).toContain("OP-HELP-FB-REF");
    expect(markup).not.toContain("respond within 2 business days");
  });

  it("shows contactable feedback acknowledgement without guaranteeing personal reply", () => {
    const markup = renderView({
      acceptance: {
        kind: "feedback",
        reference: "OP-HELP-FB-REF-2",
        feedbackType: "problem",
        sentiment: "negative",
        contactable: true,
        acceptedAtMs: 1_700_000_000_000,
      },
    });
    expect(markup).toContain("does not guarantee a personal reply");
    expect(markup).not.toContain("will reply to the email you provided");
  });

  it("lists suggested guides without blocking support or feedback lanes", () => {
    const suggested = guides.filter((g) =>
      ["week-board-picks-and-locks", "survivor-picks"].includes(g.slug),
    );
    const supportMarkup = renderView({
      suggestedGuides: suggested,
      activeLane: "support",
    });
    expect(supportMarkup).toContain("Suggested guides");
    expect(supportMarkup).toContain("/guides/week-board-picks-and-locks");

    const feedbackMarkup = renderView({
      suggestedGuides: suggested,
      activeLane: "feedback",
    });
    expect(feedbackMarkup).toContain("Suggested guides");
    expect(feedbackMarkup).toContain("Share feedback");
  });

  it("shows context disclosure summary with optional diagnostics toggle on support", () => {
    const markup = renderView({ activeLane: "support" });
    expect(markup).toContain("Context we may include");
    expect(markup).toContain('name="includeDiagnostics"');
    expect(markup).toContain("Optional diagnostics");
    expect(markup).toContain("Current page");
    expect(markup).toContain("Verified account context");
    expect(markup).toContain("Account identifier");
    expect(markup).toContain("stored temporarily");
  });

  it("shows feedback disclosure without identity when anonymous", () => {
    const anonymousDisclosure = buildHelpContextDisclosure({
      lane: "feedback",
      pathname: "/pools/pool123/board",
      search: "",
      userAgent: "Mozilla/5.0 Chrome Safari",
      includeDiagnostics: true,
      signedIn: true,
      signedInEmail: "player@example.test",
      signedInAccountId: "participant_abc",
      anonymousFeedback: true,
    });
    const markup = renderView({
      activeLane: "feedback",
      feedbackAnonymous: true,
      contextDisclosure: anonymousDisclosure,
    });
    expect(markup).toContain("private by default");
    expect(markup).toContain("Optional diagnostics");
    expect(markup).not.toContain("Verified account context");
    expect(markup).not.toContain("Account identifier");
  });

  it("shows excluded optional diagnostics when toggle is off", () => {
    const diagnosticsOff = buildHelpContextDisclosure({
      lane: "support",
      pathname: "/help",
      search: "",
      userAgent: "Mozilla/5.0 Chrome Safari",
      includeDiagnostics: false,
      signedIn: false,
      signedInEmail: null,
      signedInAccountId: null,
      anonymousFeedback: false,
    });
    const markup = renderView({
      includeDiagnostics: false,
      contextDisclosure: diagnosticsOff,
    });
    expect(markup).toContain("optional diagnostics are turned off");
    expect(markup).not.toContain("Browser and operating system");
  });

  it("preserves anonymous feedback disclosure when opened from prompt draft lane", () => {
    const anonymousDisclosure = buildHelpContextDisclosure({
      lane: "feedback",
      pathname: "/help",
      search: "?source=prompt&lane=feedback&sentiment=negative",
      userAgent: "Mozilla/5.0 Chrome Safari",
      includeDiagnostics: true,
      signedIn: true,
      signedInEmail: "player@example.test",
      signedInAccountId: "participant_abc",
      anonymousFeedback: true,
    });
    const markup = renderView({
      source: "prompt",
      activeLane: "feedback",
      feedbackSentiment: "negative",
      feedbackAnonymous: true,
      contextDisclosure: anonymousDisclosure,
    });
    expect(markup).toContain('name="sentiment"');
    expect(markup).toContain("Submit anonymously");
    expect(markup).not.toContain("Verified account context");
  });
});
