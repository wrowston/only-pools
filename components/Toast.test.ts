import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Toast } from "./Toast";

describe("Toast", () => {
  it("renders a success tone for pick-save confirmation", () => {
    const markup = renderToStaticMarkup(
      createElement(Toast, {
        message: "Hidden from others until Pick Lock.",
        title: "Pick saved",
        tone: "success",
        onDismiss: vi.fn(),
      }),
    );

    expect(markup).toContain('data-toast="true"');
    expect(markup).toContain('data-toast-tone="success"');
    expect(markup).toContain("Pick saved");
    expect(markup).toContain("Hidden from others until Pick Lock.");
    expect(markup).toContain("bg-op-won-bg");
    expect(markup).toContain('role="alert"');
  });

  it("defaults error tone title when omitted", () => {
    const markup = renderToStaticMarkup(
      createElement(Toast, {
        message: "You've already used that team.",
        onDismiss: vi.fn(),
      }),
    );

    expect(markup).toContain("Can&#x27;t save that pick");
    expect(markup).toContain('data-toast-tone="error"');
  });
});
