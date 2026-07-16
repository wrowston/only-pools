import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarketingShowcase } from "./MarketingShowcase";

function renderShowcase(): string {
  return renderToStaticMarkup(createElement(MarketingShowcase));
}

describe("landing-page product showcase", () => {
  it("shows how a participant makes a Survivor pick", () => {
    expect(renderShowcase()).toContain(
      'aria-label="Survivor Week Board showing a saved Denver Broncos pick"',
    );
  });

  it("shows how a participant ranks Confidence picks", () => {
    expect(renderShowcase()).toContain(
      'aria-label="Confidence Pick Sheet with winner predictions and confidence values"',
    );
  });

  it("shows how a participant follows the standings", () => {
    expect(renderShowcase()).toContain(
      'aria-label="Live weekly standings for the Sunday Crew pool"',
    );
  });
});
