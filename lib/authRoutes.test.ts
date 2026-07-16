import { describe, expect, it } from "vitest";
import { POST_AUTH_HOME } from "./authRoutes";

describe("POST_AUTH_HOME", () => {
  it("sends signed-in users to My Pools, not the landing page", () => {
    expect(POST_AUTH_HOME).toBe("/my-pools");
    expect(POST_AUTH_HOME).not.toBe("/");
  });
});
