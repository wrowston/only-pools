import { describe, expect, it } from "vitest";
import {
  isNoisyClerkClientMessage,
  isNoisyClerkClientUrl,
} from "@/lib/clerkClientNoise";

describe("clerkClientNoise", () => {
  it("filters opaque and Clerk session-touch failures", () => {
    expect(isNoisyClerkClientMessage("Script error.")).toBe(true);
    expect(isNoisyClerkClientMessage("Load failed")).toBe(true);
    expect(isNoisyClerkClientMessage("Failed to fetch")).toBe(true);
    expect(
      isNoisyClerkClientMessage(
        'ClerkJS: Network error at "https://viable-eagle-73.clerk.accounts.dev/v1/client/sessions/sess_x/touch"',
      ),
    ).toBe(true);
    expect(isNoisyClerkClientMessage("TypeError: Cannot read properties")).toBe(
      false,
    );
  });

  it("filters Clerk CDN / accounts URLs", () => {
    expect(
      isNoisyClerkClientUrl(
        "https://viable-eagle-73.clerk.accounts.dev/npm/@clerk/clerk-js@6.26.0/dist/clerk.browser.js",
      ),
    ).toBe(true);
    expect(isNoisyClerkClientUrl("https://onlypools.app/join/abc")).toBe(false);
  });
});
