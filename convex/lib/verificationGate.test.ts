import { describe, expect, it } from "vitest";
import {
  evaluateVerificationGate,
  isFullyVerified,
} from "./verificationGate";

describe("adult dual verification (acceptance scenario 1)", () => {
  it("refuses sign-in without verified email and phone", () => {
    expect(
      evaluateVerificationGate(
        {
          emailVerified: false,
          phoneVerified: false,
        },
        { previouslyEstablished: false },
      ),
    ).toEqual({
      action: "refuse",
      missing: ["email", "phone"],
    });
  });

  it("refuses when email is verified but phone is not on a new sign-in", () => {
    expect(
      evaluateVerificationGate(
        {
          emailVerified: true,
          phoneVerified: false,
        },
        { previouslyEstablished: false },
      ),
    ).toEqual({
      action: "refuse",
      missing: ["phone"],
    });
  });

  it("refuses when phone is verified but email is not on a new sign-in", () => {
    expect(
      evaluateVerificationGate(
        {
          emailVerified: false,
          phoneVerified: true,
        },
        { previouslyEstablished: false },
      ),
    ).toEqual({
      action: "refuse",
      missing: ["email"],
    });
  });

  it("allows a dual-verified adult on a new sign-in", () => {
    expect(
      evaluateVerificationGate(
        {
          emailVerified: true,
          phoneVerified: true,
        },
        { previouslyEstablished: false },
      ),
    ).toEqual({ action: "allow" });
  });

  it("requires both email and phone again on the next sign-in if either lapsed", () => {
    expect(
      evaluateVerificationGate(
        {
          emailVerified: true,
          phoneVerified: false,
        },
        { previouslyEstablished: false },
      ),
    ).toEqual({
      action: "refuse",
      missing: ["phone"],
    });

    expect(
      evaluateVerificationGate(
        {
          emailVerified: false,
          phoneVerified: true,
        },
        { previouslyEstablished: false },
      ),
    ).toEqual({
      action: "refuse",
      missing: ["email"],
    });
  });

  it("does not interrupt an already-valid session when a contact factor lapses mid-session", () => {
    expect(
      evaluateVerificationGate(
        {
          emailVerified: false,
          phoneVerified: true,
        },
        { previouslyEstablished: true },
      ),
    ).toEqual({ action: "allow" });

    expect(
      evaluateVerificationGate(
        {
          emailVerified: true,
          phoneVerified: false,
        },
        { previouslyEstablished: true },
      ),
    ).toEqual({ action: "allow" });
  });

  it("isFullyVerified matches email + phone verification", () => {
    expect(
      isFullyVerified({
        emailVerified: true,
        phoneVerified: true,
      }),
    ).toBe(true);
    expect(
      isFullyVerified({
        emailVerified: true,
        phoneVerified: false,
      }),
    ).toBe(false);
  });
});
