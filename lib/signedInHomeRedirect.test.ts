import { describe, expect, it } from "vitest";
import { POST_AUTH_HOME } from "./authRoutes";
import { signedInHomeRedirectPath } from "./signedInHomeRedirect";

describe("signedInHomeRedirectPath", () => {
  it("sends signed-in visitors from `/` to My Pools", () => {
    expect(
      signedInHomeRedirectPath("/", "__client_uat=1710000000"),
    ).toBe(POST_AUTH_HOME);
    expect(signedInHomeRedirectPath("/", "__session=abc.def.ghi")).toBe(
      POST_AUTH_HOME,
    );
  });

  it("leaves signed-out visitors on the marketing home page", () => {
    expect(signedInHomeRedirectPath("/", undefined)).toBeNull();
    expect(signedInHomeRedirectPath("/", "")).toBeNull();
    expect(signedInHomeRedirectPath("/", "__client_uat=0")).toBeNull();
  });

  it("does not redirect non-home paths for signed-in users", () => {
    expect(
      signedInHomeRedirectPath("/guides", "__client_uat=1710000000"),
    ).toBeNull();
    expect(
      signedInHomeRedirectPath("/my-pools", "__client_uat=1710000000"),
    ).toBeNull();
    expect(
      signedInHomeRedirectPath("/join/token", "__session=abc"),
    ).toBeNull();
  });

  it("does not treat root matcher expansions as the marketing home", () => {
    expect(
      signedInHomeRedirectPath("/index", "__client_uat=1710000000"),
    ).toBeNull();
    expect(
      signedInHomeRedirectPath("/index.json", "__session=abc"),
    ).toBeNull();
  });
});
