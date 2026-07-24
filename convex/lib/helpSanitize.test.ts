import { describe, expect, it } from "vitest";
import {
  assertSafeClientContextKeys,
  assertTextSafeForHelp,
  buildStoredHelpContext,
  findSanitizeViolations,
  sanitizeClientHelpContext,
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

  it("sanitizes allowed client context keys only", () => {
    const json = sanitizeClientHelpContext(
      {
        pagePath: "/help",
        browserSummary: "Safari",
        appVersion: "1.0",
      },
      500,
      2048,
    );
    expect(json).toBeTruthy();
    const parsed = JSON.parse(json!) as Record<string, string>;
    expect(parsed.pagePath).toBe("/help");
  });

  it("rejects forbidden client context keys", () => {
    expect(() =>
      assertSafeClientContextKeys({ hiddenPick: "KC" }),
    ).toThrow(/forbidden field/i);
    expect(() =>
      assertSafeClientContextKeys({ participantId: "fake" }),
    ).toThrow(/forbidden field/i);
    expect(() =>
      sanitizeClientHelpContext({ source: "board" }, 500, 2048),
    ).toThrow(/forbidden field|unsupported field/i);
  });

  it("builds stored context matching disclosure groups", () => {
    const clientJson = JSON.stringify({
      pagePath: "/help",
      browserSummary: "Chrome on macOS",
      appVersion: "1.0",
    });
    const stored = buildStoredHelpContext(
      {
        includeDiagnostics: true,
        clientContextJson: clientJson,
        accountId: "participant_abc",
        email: "user@example.test",
        poolId: "pool_xyz",
      },
      500,
      2048,
    );
    const parsed = JSON.parse(stored!) as Record<string, string>;
    expect(parsed.pagePath).toBe("/help");
    expect(parsed.accountId).toBe("participant_abc");
    expect(parsed.poolId).toBe("pool_xyz");

    const diagnosticsOff = buildStoredHelpContext(
      {
        includeDiagnostics: false,
        clientContextJson: clientJson,
        accountId: "participant_abc",
      },
      500,
      2048,
    );
    const offParsed = JSON.parse(diagnosticsOff!) as Record<string, string>;
    expect(offParsed.pagePath).toBeUndefined();
    expect(offParsed.accountId).toBe("participant_abc");
  });
});
