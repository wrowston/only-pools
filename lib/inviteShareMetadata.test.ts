import { describe, expect, it } from "vitest";
import {
  inviteShareDescription,
  inviteShareDocumentTitle,
  inviteShareMetadata,
  inviteShareOpenGraphTitle,
  poolTypeLabel,
} from "./inviteShareMetadata";

describe("inviteShareMetadata", () => {
  const preview = {
    poolName: "Sunday Best Friends",
    poolType: "survivor" as const,
    startWeek: 3,
  };

  it("builds a short og:title without site branding", () => {
    expect(inviteShareOpenGraphTitle(preview)).toBe("Join Sunday Best Friends");
    expect(inviteShareOpenGraphTitle(preview).length).toBeLessThanOrEqual(44);
    expect(inviteShareOpenGraphTitle(null)).toBe("Join a pool");
  });

  it("truncates long pool names for iMessage title length", () => {
    const long = inviteShareOpenGraphTitle({
      ...preview,
      poolName: "The Extremely Long Office Pool Name That Will Not Fit",
    });
    expect(long.length).toBeLessThanOrEqual(44);
    expect(long.endsWith("…")).toBe(true);
    expect(long.startsWith("Join ")).toBe(true);
  });

  it("describes the pool type and start week for non-iMessage consumers", () => {
    expect(inviteShareDescription(preview)).toContain("Survivor");
    expect(inviteShareDescription(preview)).toContain("week 3");
    expect(inviteShareDescription(preview)).toMatch(/does not enroll/i);
    expect(poolTypeLabel("confidence")).toBe("Confidence");
  });

  it("keeps document title branded while og:title stays pool-first", () => {
    const metadata = inviteShareMetadata("abc123", preview);
    expect(inviteShareDocumentTitle(preview)).toContain("Only Pools");
    expect(metadata.openGraph?.title).toBe("Join Sunday Best Friends");
    expect(metadata.openGraph?.siteName).toBe("Only Pools");
    expect(metadata.openGraph?.url).toBe("/join/abc123");
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image" });
  });
});
