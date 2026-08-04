import { describe, expect, it } from "vitest";
import { clerkAppearance } from "./clerkAppearance";

describe("clerkAppearance", () => {
  it("points SignUp legal consent links at the public Terms and Privacy pages", () => {
    expect(clerkAppearance.options.termsPageUrl).toBe("/terms");
    expect(clerkAppearance.options.privacyPageUrl).toBe("/privacy");
    expect(clerkAppearance.options.helpPageUrl).toBe("/help");
  });
});
