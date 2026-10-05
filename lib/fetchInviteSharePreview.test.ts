import { afterEach, describe, expect, it, vi } from "vitest";

describe("fetchInviteSharePreview", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("returns null during page-load bench runs without calling Convex", async () => {
    vi.stubEnv("PAGE_LOAD_BENCH", "1");
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://example.convex.cloud");

    const query = vi.fn();
    vi.doMock("convex/browser", () => ({
      ConvexHttpClient: class {
        query = query;
      },
    }));

    const { fetchInviteSharePreview } = await import(
      "./fetchInviteSharePreview"
    );
    expect(await fetchInviteSharePreview("invite-token")).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it("returns null when Convex URL or token is missing", async () => {
    vi.stubEnv("PAGE_LOAD_BENCH", "");
    delete process.env.NEXT_PUBLIC_CONVEX_URL;

    const { fetchInviteSharePreview } = await import(
      "./fetchInviteSharePreview"
    );
    expect(await fetchInviteSharePreview("")).toBeNull();
    expect(await fetchInviteSharePreview("token")).toBeNull();
  });

  it("returns null when the Convex query exceeds the share preview timeout", async () => {
    vi.stubEnv("PAGE_LOAD_BENCH", "");
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://example.convex.cloud");

    vi.doMock("convex/browser", () => ({
      ConvexHttpClient: class {
        query() {
          return new Promise(() => {
            /* never resolves — simulates a hung provider */
          });
        }
      },
    }));

    const { fetchInviteSharePreview } = await import(
      "./fetchInviteSharePreview"
    );
    await expect(
      fetchInviteSharePreview("slow-token"),
    ).resolves.toBeNull();
  });
});
