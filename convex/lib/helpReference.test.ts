import { describe, expect, it } from "vitest";
import { generateHelpReference, isOpaqueHelpReference } from "./helpReference";

describe("helpReference", () => {
  it("generates opaque OP- prefixed references", () => {
    const a = generateHelpReference();
    const b = generateHelpReference();
    expect(a).toMatch(/^OP-[0-9A-F]{24}$/);
    expect(b).toMatch(/^OP-[0-9A-F]{24}$/);
    expect(a).not.toBe(b);
    expect(isOpaqueHelpReference(a)).toBe(true);
  });

  it("rejects sequential-looking values", () => {
    expect(isOpaqueHelpReference("OP-000000000000000000000001")).toBe(true);
    expect(isOpaqueHelpReference("1")).toBe(false);
    expect(isOpaqueHelpReference("OP-1234")).toBe(false);
  });
});
