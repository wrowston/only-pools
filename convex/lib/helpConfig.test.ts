import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertHelpIntakeOperational,
  canDeliverRealEmail,
  getHelpAllowedOrigin,
  isDoubleEmailMode,
} from "./helpConfig";

describe("helpConfig", () => {
  const prev: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of [
      "DEPLOYMENT_KIND",
      "HELP_ALLOWED_ORIGIN",
      "CLIENT_ORIGIN",
      "HELP_SUPPORT_MAILBOX",
      "HELP_FROM_EMAIL",
      "HELP_EMAIL_MODE",
      "RESEND_API_KEY",
    ]) {
      prev[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("prefers HELP_ALLOWED_ORIGIN for CORS", () => {
    process.env.HELP_ALLOWED_ORIGIN = "http://localhost:3000";
    expect(getHelpAllowedOrigin()).toBe("http://localhost:3000");
  });

  it("uses double email mode in tests without real Resend", () => {
    process.env.DEPLOYMENT_KIND = "test";
    process.env.HELP_EMAIL_MODE = "double";
    expect(isDoubleEmailMode()).toBe(true);
    expect(canDeliverRealEmail()).toBe(false);
  });

  it("fails closed in production without mailbox config", () => {
    process.env.DEPLOYMENT_KIND = "production";
    delete process.env.HELP_SUPPORT_MAILBOX;
    delete process.env.HELP_FROM_EMAIL;
    delete process.env.RESEND_API_KEY;
    delete process.env.HELP_NETWORK_HASH_SECRET;

    const check = assertHelpIntakeOperational();
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.reason).toMatch(/HELP_SUPPORT_MAILBOX/i);
    }
  });

  it("fails closed in production without network hash secret", () => {
    process.env.DEPLOYMENT_KIND = "production";
    process.env.HELP_SUPPORT_MAILBOX = "support@example.test";
    process.env.HELP_FROM_EMAIL = "Only Pools <noreply@example.test>";
    process.env.RESEND_API_KEY = "re_test_key";
    delete process.env.HELP_NETWORK_HASH_SECRET;
    delete process.env.HELP_RATE_LIMIT_SECRET;
    delete process.env.HELP_EMAIL_MODE;

    const check = assertHelpIntakeOperational();
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.reason).toMatch(/HELP_NETWORK_HASH_SECRET/i);
    }
  });

  it("allows non-production intake without Resend key", () => {
    process.env.DEPLOYMENT_KIND = "development";
    delete process.env.RESEND_API_KEY;
    expect(assertHelpIntakeOperational().ok).toBe(true);
  });
});
