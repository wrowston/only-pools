import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("fetchInviteSharePreview", () => {
  const envSnapshot = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...envSnapshot };
  });

  afterEach(() => {
    process.env = envSnapshot;
  });

  it("skips Convex when PAGE_LOAD_BENCH is set", async () => {
    process.env.PAGE_LOAD_BENCH = "1";
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    const { fetchInviteSharePreview } = await import("./fetchInviteSharePreview");
    await expect(fetchInviteSharePreview("bench-token")).resolves.toBeNull();
  });

  it("returns null without a Convex URL or token", async () => {
    delete process.env.NEXT_PUBLIC_CONVEX_URL;
    const { fetchInviteSharePreview } = await import("./fetchInviteSharePreview");
    await expect(fetchInviteSharePreview("")).resolves.toBeNull();
    await expect(fetchInviteSharePreview("abc")).resolves.toBeNull();
  });
});
