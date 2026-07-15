import { describe, expect, it } from "vitest";
import {
  evaluateVerificationGate,
  isFullyVerified,
} from "./verificationGate";

describe("adult dual verification (acceptance scenario 1)", () => {
  it("refuses sign-in without verified email, phone, and age confirmation", () => {
    expect(
      evaluateVerificationGate(
        {
          emailVerified: false,
          phoneVerified: false,
          ageConfirmed: false,
        },
        { previouslyEstablished: false },
      ),
    ).toEqual({
      action: "refuse",
      missing: ["age", "email", "phone"],
    });
  });

  it("refuses when email is verified but phone is not on a new sign-in", () => {
    expect(
      evaluateVerificationGate(
        {
          emailVerified: true,
          phoneVerified: false,
          ageConfirmed: true,
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
          ageConfirmed: true,
        },
        { previouslyEstablished: false },
      ),
    ).toEqual({
      action: "refuse",
      missing: ["email"],
    });
  });

  it("refuses when contacts are verified but age is not confirmed", () => {
    expect(
      evaluateVerificationGate(
        {
          emailVerified: true,
          phoneVerified: true,
          ageConfirmed: false,
        },
        { previouslyEstablished: false },
      ),
    ).toEqual({
      action: "refuse",
      missing: ["age"],
    });
  });

  it("allows a fully verified adult on a new sign-in", () => {
    expect(
      evaluateVerificationGate(
        {
          emailVerified: true,
          phoneVerified: true,
          ageConfirmed: true,
        },
        { previouslyEstablished: false },
      ),
    ).toEqual({ action: "allow" });
  });

  it("requires both email and phone again on the next sign-in if either lapsed", () => {
    // New sign-in after a prior session ended — previouslyEstablished is false.
    expect(
      evaluateVerificationGate(
        {
          emailVerified: true,
          phoneVerified: false,
          ageConfirmed: true,
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
          ageConfirmed: true,
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
          ageConfirmed: true,
        },
        { previouslyEstablished: true },
      ),
    ).toEqual({ action: "allow" });

    expect(
      evaluateVerificationGate(
        {
          emailVerified: true,
          phoneVerified: false,
          ageConfirmed: true,
        },
        { previouslyEstablished: true },
      ),
    ).toEqual({ action: "allow" });
  });

  it("still refuses mid-session if age confirmation is missing", () => {
    expect(
      evaluateVerificationGate(
        {
          emailVerified: true,
          phoneVerified: true,
          ageConfirmed: false,
        },
        { previouslyEstablished: true },
      ),
    ).toEqual({
      action: "refuse",
      missing: ["age"],
    });
  });

  it("isFullyVerified matches dual verification + age", () => {
    expect(
      isFullyVerified({
        emailVerified: true,
        phoneVerified: true,
        ageConfirmed: true,
      }),
    ).toBe(true);
    expect(
      isFullyVerified({
        emailVerified: true,
        phoneVerified: false,
        ageConfirmed: true,
      }),
    ).toBe(false);
  });
});
