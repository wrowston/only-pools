import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FeedbackPromptPanel } from "@/components/help/FeedbackPromptDialog";

describe("FeedbackPrompt rendered contract", () => {
  it("exposes accessible prompt controls and dismissal actions", () => {
    const markup = renderToStaticMarkup(
      createElement(FeedbackPromptPanel, {
        onSentiment: () => undefined,
        onSnooze: () => undefined,
        onRetire: () => undefined,
      }),
    );

    expect(markup).toContain("How is Only Pools going?");
    expect(markup).toContain("Negative");
    expect(markup).toContain("Neutral");
    expect(markup).toContain("Positive");
    expect(markup).toContain("Not now");
    expect(markup).toContain("Don&#x27;t ask again");
    expect(markup).toContain('aria-label="How is Only Pools going?"');
  });
});
