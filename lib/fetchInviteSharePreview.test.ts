import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const queryMock = vi.fn();

vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    query = queryMock;
  },
}));

describe("fetchInviteSharePreview", () => {
  const envSnapshot = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    queryMock.mockReset();
    process.env = { ...envSnapshot };
  });

  afterEach(() => {
    process.env = envSnapshot;
    vi.useRealTimers();
  });

  async function loadFetch() {
    const { fetchInviteSharePreview } = await import("./fetchInviteSharePreview");
    return fetchInviteSharePreview;
  }

  it("skips remote I/O when PAGE_LOAD_BENCH is set", async () => {
    process.env.PAGE_LOAD_BENCH = "1";
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    const fetch = await loadFetch();
    await expect(fetch("invite-token")).resolves.toBeNull();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("returns null when Convex URL or token is missing", async () => {
    const fetch = await loadFetch();
    await expect(fetch("")).resolves.toBeNull();
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    await expect(fetch("")).resolves.toBeNull();
    delete process.env.NEXT_PUBLIC_CONVEX_URL;
    await expect(fetch("invite-token")).resolves.toBeNull();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("returns null when the Convex query exceeds 400ms", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    queryMock.mockImplementation(() => new Promise(() => {}));
    vi.useFakeTimers();
    const fetch = await loadFetch();
    const pending = fetch("invite-token");
    await vi.advanceTimersByTimeAsync(400);
    await expect(pending).resolves.toBeNull();
  });

  it("returns share preview data on success", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    const preview = {
      poolName: "Sunday Best",
      poolType: "survivor" as const,
      startWeek: 1,
    };
    queryMock.mockResolvedValue(preview);
    const fetch = await loadFetch();
    await expect(fetch("invite-token")).resolves.toEqual(preview);
    expect(queryMock).toHaveBeenCalledOnce();
  });

  it("returns null when Convex throws", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    queryMock.mockRejectedValue(new Error("network down"));
    const fetch = await loadFetch();
    await expect(fetch("invite-token")).resolves.toBeNull();
  });
});
