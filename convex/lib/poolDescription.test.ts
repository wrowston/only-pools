import { describe, expect, it } from "vitest";
import {
  MAX_POOL_DESCRIPTION_LENGTH,
  normalizePoolDescription,
} from "./poolDescription";

describe("normalizePoolDescription", () => {
  it("trims and keeps non-empty text", () => {
    expect(normalizePoolDescription("  Office pool buy-in $20  ")).toBe(
      "Office pool buy-in $20",
    );
  });

  it("treats empty / whitespace as cleared", () => {
    expect(normalizePoolDescription("")).toBeUndefined();
    expect(normalizePoolDescription("   ")).toBeUndefined();
    expect(normalizePoolDescription(undefined)).toBeUndefined();
  });

  it("rejects oversized descriptions", () => {
    expect(() =>
      normalizePoolDescription("x".repeat(MAX_POOL_DESCRIPTION_LENGTH + 1)),
    ).toThrow(/at most 2000/);
  });
});
