import { describe, expect, it } from "vitest";
import { clerkPhoneFirstInitialValues } from "./clerkPhoneFirst";

describe("clerkPhoneFirstInitialValues", () => {
  it("uses a truthy phone seed so Clerk opens on phone, not email", () => {
    expect(clerkPhoneFirstInitialValues.phoneNumber).toBeTruthy();
    expect(clerkPhoneFirstInitialValues.phoneNumber).toBe("+");
  });

  it("does not prefill email or username", () => {
    expect(clerkPhoneFirstInitialValues).not.toHaveProperty("emailAddress");
    expect(clerkPhoneFirstInitialValues).not.toHaveProperty("username");
  });
});
