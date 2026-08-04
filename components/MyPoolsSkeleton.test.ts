import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MyPoolsSkeleton } from "./MyPoolsSkeleton";

describe("MyPoolsSkeleton", () => {
  it("uses a visible placeholder tone so loading never looks blank on canvas", () => {
    const markup = renderToStaticMarkup(createElement(MyPoolsSkeleton));
    expect(markup).toContain('aria-label="Loading My Pools"');
    // shadcn bg-muted (#f0f0f0) is ~1.08:1 on --op-canvas (#f9f9f9) and reads
    // as an empty screen — especially after soft-nav Suspense fallbacks.
    expect(markup).toContain("bg-op-border-strong");
    expect(markup.includes("bg-muted")).toBe(false);
  });
});
