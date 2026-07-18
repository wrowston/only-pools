import { describe, expect, it } from "vitest";
import {
  POST_AUTH_HOME,
  PROTECTED_ROUTE_PATTERNS,
  PUBLIC_ROUTE_PATTERNS,
} from "./authRoutes";

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

  it("lets link-preview crawlers fetch the Open Graph image", () => {
    expect(PUBLIC_ROUTE_PATTERNS).toContain("/opengraph-image(.*)");
  });
});

describe("PROTECTED_ROUTE_PATTERNS", () => {
  it("covers product routes that require a Participant session", () => {
    expect(PROTECTED_ROUTE_PATTERNS).toEqual(
      expect.arrayContaining([
        "/my-pools(.*)",
        "/pools(.*)",
        "/join(.*)",
        "/return(.*)",
        "/operator(.*)",
        "/prototype(.*)",
      ]),
    );
  });

  it("does not overlap public marketing routes", () => {
    for (const pattern of PROTECTED_ROUTE_PATTERNS) {
      expect(PUBLIC_ROUTE_PATTERNS).not.toContain(pattern);
    }
  });
});
