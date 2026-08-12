import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LandingDemoBanner } from "./LandingDemoBanner";

describe("landing-page Cursor 101 demo banner", () => {
  it("renders a visible Cloud Agent welcome banner", () => {
    const markup = renderToStaticMarkup(createElement(LandingDemoBanner));

    expect(markup).toContain("data-cursor-101-demo-banner");
    expect(markup).toContain("Demo for a Cloud Agent — welcome to Cursor 101");
    expect(markup).toContain('role="status"');
  });
});
