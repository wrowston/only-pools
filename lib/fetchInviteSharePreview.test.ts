import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InviteSharePreview } from "./inviteShareMetadata";

const queryMock = vi.fn<(...args: unknown[]) => Promise<InviteSharePreview | null>>();

vi.mock("react", () => ({
  cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}));

vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    query = queryMock;
    constructor(_url: string) {}
  },
}));

describe("fetchInviteSharePreview", () => {
  const envSnapshot = { ...process.env };

  beforeEach(() => {
    queryMock.mockReset();
    process.env = { ...envSnapshot };
    delete process.env.PAGE_LOAD_BENCH;
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    vi.resetModules();
  });

  afterEach(() => {
    process.env = envSnapshot;
    vi.useRealTimers();
  });

  async function loadFetcher() {
    const mod = await import("./fetchInviteSharePreview");
    return mod.fetchInviteSharePreview;
  }

  it("skips remote I/O during page-load bench", async () => {
    process.env.PAGE_LOAD_BENCH = "1";
    const fetchInviteSharePreview = await loadFetcher();
    await expect(fetchInviteSharePreview("invite-token")).resolves.toBeNull();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("returns null when Convex URL or token is missing", async () => {
    const fetchInviteSharePreview = await loadFetcher();
    delete process.env.NEXT_PUBLIC_CONVEX_URL;
    await expect(fetchInviteSharePreview("invite-token")).resolves.toBeNull();

    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    await expect(fetchInviteSharePreview("")).resolves.toBeNull();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("returns preview data from Convex", async () => {
    const preview: InviteSharePreview = {
      poolName: "Sunday Best Friends",
      poolType: "survivor",
      startWeek: 1,
    };
    queryMock.mockResolvedValue(preview);
    const fetchInviteSharePreview = await loadFetcher();
    await expect(fetchInviteSharePreview("invite-token")).resolves.toEqual(
      preview,
    );
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it("returns null when Convex throws", async () => {
    queryMock.mockRejectedValue(new Error("network down"));
    const fetchInviteSharePreview = await loadFetcher();
    await expect(fetchInviteSharePreview("invite-token")).resolves.toBeNull();
  });

  it("times out slow Convex reads so invite HTML TTFB cannot stall", async () => {
    vi.useFakeTimers();
    queryMock.mockImplementation(
      () =>
        new Promise(() => {
          /* never settles */
        }),
    );
    const fetchInviteSharePreview = await loadFetcher();
    const pending = fetchInviteSharePreview("invite-token");
    await vi.advanceTimersByTimeAsync(400);
    await expect(pending).resolves.toBeNull();
  });
});
