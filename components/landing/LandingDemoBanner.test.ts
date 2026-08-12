import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LandingDemoBanner } from "./LandingDemoBanner";

describe("landing demo banner", () => {
  it("shows a visible Cursor 101 demo announcement", () => {
    const markup = renderToStaticMarkup(createElement(LandingDemoBanner));

    expect(markup).toContain("data-landing-demo-banner");
    expect(markup).toContain("role=\"status\"");
    expect(markup).toContain("Demo for a cloud agent — welcome to Cursor 101");
  });
});
