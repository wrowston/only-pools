import { describe, expect, it } from "vitest";
import {
  evaluateVerificationGate,
  isFullyVerified,
} from "./verificationGate";

describe("adult dual verification (acceptance scenario 1)", () => {
  it("refuses when there is no authenticated Clerk identity", () => {
    expect(
      evaluateVerificationGate(
        {
          authenticated: false,
          emailVerified: false,
          phoneVerified: false,
        },
        { previouslyEstablished: false },
      ),
    ).toEqual({
      action: "refuse",
      missing: ["auth"],
    });
  });

  it("allows an authenticated Clerk session even when contact claims are absent", () => {
    expect(
      evaluateVerificationGate(
        {
          authenticated: true,
          emailVerified: false,
          phoneVerified: false,
        },
        { previouslyEstablished: false },
      ),
    ).toEqual({ action: "allow" });
  });

  it("allows continuing an already-valid session", () => {
    expect(
      evaluateVerificationGate(
        {
          authenticated: true,
          emailVerified: false,
          phoneVerified: false,
        },
        { previouslyEstablished: true },
      ),
    ).toEqual({ action: "allow" });
  });

  it("isFullyVerified matches authenticated Clerk identity", () => {
    expect(
      isFullyVerified({
        authenticated: true,
        emailVerified: false,
        phoneVerified: false,
      }),
    ).toBe(true);
    expect(
      isFullyVerified({
        authenticated: false,
        emailVerified: true,
        phoneVerified: true,
      }),
    ).toBe(false);
  });
});
