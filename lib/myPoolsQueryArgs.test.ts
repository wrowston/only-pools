import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getMyPoolsEssentialSpecs } from "./convexRouteData";
import { myPoolsQueryArgs } from "./myPoolsQueryArgs";

describe("myPoolsQueryArgs", () => {
  it("matches prewarm essential specs so back-nav can hit cache", () => {
    expect(myPoolsQueryArgs()).toEqual({ includeArchived: false });
    expect(myPoolsQueryArgs(true)).toEqual({ includeArchived: true });
    expect(getMyPoolsEssentialSpecs()[0]?.args).toEqual(myPoolsQueryArgs());
    expect(getMyPoolsEssentialSpecs({ includeArchived: true })[0]?.args).toEqual(
      myPoolsQueryArgs(true),
    );
  });

  it("keeps PoolPicker on the canonical args shape", () => {
    const picker = readFileSync(
      path.join(process.cwd(), "components/PoolPicker.tsx"),
      "utf8",
    );
    expect(picker).toContain("myPoolsQueryArgs(");
    expect(picker).not.toMatch(
      /useQuery\(\s*api\.participants\.myPools,\s*isAuthenticated \? \{\} : "skip"/,
    );
  });

  it("keeps My Pools page free of client search-params Suspense bailout", () => {
    const page = readFileSync(
      path.join(process.cwd(), "app/(app)/my-pools/page.tsx"),
      "utf8",
    );
    expect(page).not.toContain('"use client"');
    expect(page).not.toContain('from "next/navigation"');
    expect(page).not.toContain("Suspense");
    expect(page).toContain("MyPoolsClient");
  });
});
