import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarketingShowcase } from "./MarketingShowcase";

function renderShowcase(): string {
  return renderToStaticMarkup(createElement(MarketingShowcase));
}

describe("landing-page product showcase", () => {
  it("shows how a participant makes a Survivor pick", () => {
    const markup = renderShowcase();

    expect(markup).toContain(
      'aria-label="Interactive Survivor Week Board preview"',
    );
    expect(markup).toContain('aria-label="Select Survivor week"');
    expect(markup).toContain('aria-label="Pick Denver Broncos"');
    expect(markup).toContain('aria-pressed="true"');
  });

  it("shows how a participant ranks Confidence picks", () => {
    const markup = renderShowcase();

    expect(markup).toContain(
      'aria-label="Interactive Confidence Pick Sheet preview"',
    );
    expect(markup).toContain('aria-label="Select Confidence week"');
    expect(markup).toContain(
      'aria-label="Confidence for Denver Broncos at New Orleans Saints"',
    );
  });

  it("shows how a participant follows the standings", () => {
    expect(renderShowcase()).toContain(
      'aria-label="Interactive Confidence standings preview for the Sunday Crew pool"',
    );
    expect(renderShowcase()).toContain('role="tablist"');
    expect(renderShowcase()).toContain('aria-selected="true"');
    expect(renderShowcase()).toContain("Season Standing");
  });
});
