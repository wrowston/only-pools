import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();

vi.mock("convex/browser", () => ({
  ConvexHttpClient: vi.fn(function MockConvexHttpClient() {
    return { query: queryMock };
  }),
}));

import { ConvexHttpClient } from "convex/browser";
import { fetchInviteSharePreview } from "./fetchInviteSharePreview";

describe("fetchInviteSharePreview", () => {
  const envSnapshot = { ...process.env };

  beforeEach(() => {
    queryMock.mockReset();
    vi.mocked(ConvexHttpClient).mockClear();
    process.env = { ...envSnapshot };
  });

  afterEach(() => {
    process.env = { ...envSnapshot };
    vi.useRealTimers();
  });

  it("skips remote I/O during page-load bench runs", async () => {
    process.env.PAGE_LOAD_BENCH = "1";
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";

    await expect(fetchInviteSharePreview("invite-token")).resolves.toBeNull();
    expect(ConvexHttpClient).not.toHaveBeenCalled();
  });

  it("returns null without Convex URL or token", async () => {
    delete process.env.NEXT_PUBLIC_CONVEX_URL;

    await expect(fetchInviteSharePreview("")).resolves.toBeNull();
    await expect(fetchInviteSharePreview("tok")).resolves.toBeNull();
    expect(ConvexHttpClient).not.toHaveBeenCalled();
  });

  it("returns null when the Convex query exceeds 400ms", async () => {
    vi.useFakeTimers();
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    queryMock.mockReturnValue(new Promise(() => {}));

    const pending = fetchInviteSharePreview("slow-token");
    await vi.advanceTimersByTimeAsync(400);

    await expect(pending).resolves.toBeNull();
    expect(queryMock).toHaveBeenCalledWith(
      expect.anything(),
      { token: "slow-token" },
    );
  });

  it("returns the share preview on success", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    const preview = {
      poolName: "Sunday Survivor",
      inviteeLabel: "Alex",
    };
    queryMock.mockResolvedValue(preview);

    await expect(fetchInviteSharePreview("good-token")).resolves.toEqual(
      preview,
    );
  });

  it("returns null when the Convex client throws", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    queryMock.mockRejectedValue(new Error("network down"));

    await expect(fetchInviteSharePreview("bad-token")).resolves.toBeNull();
  });
});
