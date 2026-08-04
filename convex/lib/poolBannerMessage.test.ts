import { describe, expect, it } from "vitest";
import {
  MAX_POOL_BANNER_MESSAGE_LENGTH,
  normalizePoolBannerMessage,
} from "./poolBannerMessage";

describe("normalizePoolBannerMessage", () => {
  it("trims whitespace", () => {
    expect(normalizePoolBannerMessage("  Buy-in due Friday  ")).toBe(
      "Buy-in due Friday",
    );
  });

  it("clears empty / whitespace-only / undefined", () => {
    expect(normalizePoolBannerMessage("")).toBeUndefined();
    expect(normalizePoolBannerMessage("   ")).toBeUndefined();
    expect(normalizePoolBannerMessage(undefined)).toBeUndefined();
  });

  it("rejects overflow", () => {
    expect(() =>
      normalizePoolBannerMessage(
        "x".repeat(MAX_POOL_BANNER_MESSAGE_LENGTH + 1),
      ),
    ).toThrow(/at most 500/);
  });
});
