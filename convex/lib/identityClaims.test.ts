import { describe, expect, it } from "vitest";
import {
  asBool,
  emailVerifiedFromIdentity,
  phoneFromIdentity,
  phoneVerifiedFromIdentity,
} from "./identityClaims";

describe("identity claim normalization", () => {
  it("treats Clerk string booleans as verified", () => {
    expect(asBool("true")).toBe(true);
    expect(asBool(true)).toBe(true);
    expect(asBool("false")).toBe(false);
    expect(asBool(false)).toBe(false);
    expect(
      emailVerifiedFromIdentity({ email_verified: "true" }),
    ).toBe(true);
    expect(
      phoneVerifiedFromIdentity({ phone_number_verified: "true" }),
    ).toBe(true);
  });

  it("reads camelCase Convex mappings", () => {
    expect(
      emailVerifiedFromIdentity({ emailVerified: true }),
    ).toBe(true);
    expect(
      phoneVerifiedFromIdentity({ phoneNumberVerified: true }),
    ).toBe(true);
    expect(phoneFromIdentity({ phoneNumber: "+15555550100" })).toBe(
      "+15555550100",
    );
  });

  it("treats primary email/phone presence as verified when flag shortcodes are empty", () => {
    expect(
      emailVerifiedFromIdentity({
        email: "will@example.com",
        email_verified: "",
      }),
    ).toBe(true);
    expect(
      phoneVerifiedFromIdentity({
        phone_number: "+15555550100",
        phone_number_verified: "",
      }),
    ).toBe(true);
    expect(emailVerifiedFromIdentity({})).toBe(false);
    expect(phoneVerifiedFromIdentity({})).toBe(false);
  });
});
