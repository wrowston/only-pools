import { describe, expect, it } from "vitest";
import { HELP_FEEDBACK_LABEL, helpFeedbackHref } from "@/lib/helpNav";

describe("helpFeedbackHref", () => {
  it("preserves pool section as source query param", () => {
    expect(helpFeedbackHref("board")).toBe("/help?source=board");
    expect(helpFeedbackHref("standings")).toBe("/help?source=standings");
    expect(helpFeedbackHref("pool")).toBe("/help?source=pool");
  });
});

describe("HELP_FEEDBACK_LABEL", () => {
  it("uses the Help & feedback label", () => {
    expect(HELP_FEEDBACK_LABEL).toBe("Help & feedback");
  });
});
