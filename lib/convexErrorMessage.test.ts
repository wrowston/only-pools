import { describe, expect, it } from "vitest";
import { ConvexError } from "convex/values";
import { convexErrorMessage } from "./convexErrorMessage";

describe("convexErrorMessage", () => {
  it("reads string ConvexError data", () => {
    expect(
      convexErrorMessage(
        new ConvexError("You've already used that team."),
        "fallback",
      ),
    ).toBe("You've already used that team.");
  });

  it("reads object ConvexError message", () => {
    expect(
      convexErrorMessage(
        new ConvexError({ message: "Pick Lock has been reached" }),
        "fallback",
      ),
    ).toBe("Pick Lock has been reached");
  });

  it("parses wrapped Convex server error text", () => {
    const err = new Error(
      "[CONVEX M(survivorPicks:autosaveSurvivorPick)] [Request ID: abc] Server Error\nUncaught SurvivorPickError: You've already used that team. Survivor picks are one-use — choose a different team.",
    );
    expect(convexErrorMessage(err, "fallback")).toBe(
      "You've already used that team. Survivor picks are one-use — choose a different team.",
    );
  });

  it("strips single-line Convex wrappers and stack location", () => {
    const err = new Error(
      "[CONVEX M(survivorPicks:autosaveSurvivorPick)] [Request ID: 57ca40a0cac4e228] Server Error Uncaught SurvivorPickError: That NFL Team is already reserved under the one-use Survivor rule at handler (../convex/survivorPicks.ts:279:8) Called by client",
    );
    expect(convexErrorMessage(err, "fallback")).toBe(
      "That NFL Team is already reserved under the one-use Survivor rule",
    );
  });

  it("never returns raw [CONVEX] text — uses fallback", () => {
    const err = new Error(
      "[CONVEX M(foo:bar)] [Request ID: abc] Server Error",
    );
    expect(convexErrorMessage(err, "Save failed — try again")).toBe(
      "Save failed — try again",
    );
  });

  it("uses fallback for unknown errors", () => {
    expect(convexErrorMessage(null, "Save failed")).toBe("Save failed");
  });
});
