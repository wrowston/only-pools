import { describe, expect, it } from "vitest";
import { POST_AUTH_HOME } from "@/lib/authRoutes";
import { postAuthRedirect } from "@/lib/postAuthRedirect";

describe("postAuthRedirect", () => {
  it("keeps pool invite deep links after auth", () => {
    expect(postAuthRedirect("/join/abc123")).toBe("/join/abc123");
    expect(postAuthRedirect("/join/abc123/")).toBe("/join/abc123");
  });

  it("keeps returning-invite deep links after auth", () => {
    expect(postAuthRedirect("/return/tok")).toBe("/return/tok");
  });

  it("falls back to My Pools elsewhere", () => {
    expect(postAuthRedirect("/join")).toBe(POST_AUTH_HOME);
    expect(postAuthRedirect("/guides")).toBe(POST_AUTH_HOME);
    expect(postAuthRedirect("/my-pools")).toBe(POST_AUTH_HOME);
  });
});
