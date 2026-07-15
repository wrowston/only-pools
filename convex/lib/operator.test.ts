import { describe, expect, it } from "vitest";
import { isProductionOperator } from "./operator";

describe("Production Operator allowlist", () => {
  it("denies when no allowlist is configured", () => {
    expect(
      isProductionOperator(
        { tokenIdentifier: "https://clerk|user_1", clerkUserId: "user_1" },
        {},
      ),
    ).toBe(false);
  });

  it("allows when clerkUserId matches PRODUCTION_OPERATOR_CLERK_USER_ID", () => {
    expect(
      isProductionOperator(
        { tokenIdentifier: "https://clerk|user_op", clerkUserId: "user_op" },
        { PRODUCTION_OPERATOR_CLERK_USER_ID: "user_op" },
      ),
    ).toBe(true);
  });

  it("allows when tokenIdentifier matches PRODUCTION_OPERATOR_TOKEN_IDENTIFIER", () => {
    expect(
      isProductionOperator(
        {
          tokenIdentifier: "https://clerk.example|user_op",
          clerkUserId: "user_op",
        },
        {
          PRODUCTION_OPERATOR_TOKEN_IDENTIFIER:
            "https://clerk.example|user_op",
        },
      ),
    ).toBe(true);
  });

  it("denies non-matching identities", () => {
    expect(
      isProductionOperator(
        { tokenIdentifier: "https://clerk|other", clerkUserId: "other" },
        {
          PRODUCTION_OPERATOR_CLERK_USER_ID: "user_op",
          PRODUCTION_OPERATOR_TOKEN_IDENTIFIER: "https://clerk|user_op",
        },
      ),
    ).toBe(false);
  });
});
