import { describe, expect, it } from "vitest";
import { POST_AUTH_HOME, PUBLIC_ROUTE_PATTERNS } from "./authRoutes";

describe("POST_AUTH_HOME", () => {
  it("sends signed-in users to My Pools, not the landing page", () => {
    expect(POST_AUTH_HOME).toBe("/my-pools");
    expect(POST_AUTH_HOME).not.toBe("/");
  });
});

describe("PUBLIC_ROUTE_PATTERNS", () => {
  it("keeps the complete guides section available without signing in", () => {
    expect(PUBLIC_ROUTE_PATTERNS).toContain("/guides(.*)");
    expect(PUBLIC_ROUTE_PATTERNS).toContain("/sitemap.xml");
  });
});
