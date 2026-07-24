import { describe, expect, it } from "vitest";
import {
  assertTextSafeForHelp,
  findSanitizeViolations,
  sanitizeHelpContext,
} from "./helpSanitize";

describe("helpSanitize", () => {
  it("detects invite credentials and hidden picks", () => {
    expect(findSanitizeViolations("/join/abcDEF1234567890secret")).toContain(
      "invite_credential",
    );
    expect(findSanitizeViolations("pickedTeamId leaked")).toContain(
      "hidden_pick",
    );
  });

  it("rejects password-like secrets in help messages", () => {
    expect(() =>
      assertTextSafeForHelp("my password: hunter2"),
    ).toThrow(/passwords or secret credentials/i);
  });

  it("sanitizes allowed context keys only", () => {
    const json = sanitizeHelpContext(
      {
        pagePath: "/help",
        browserSummary: "Safari",
        appVersion: "1.0",
        secretField: "ignored",
      },
      500,
      2048,
    );
    expect(json).toBeTruthy();
    const parsed = JSON.parse(json!) as Record<string, string>;
    expect(parsed.pagePath).toBe("/help");
    expect(parsed.secretField).toBeUndefined();
  });
});
