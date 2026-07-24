import { describe, expect, it } from "vitest";
import {
  buildHelpClientContextPayload,
  buildHelpContextDisclosure,
  extractPoolIdFromLocation,
  summarizeBrowser,
} from "@/lib/helpDiagnostics";

describe("helpDiagnostics", () => {
  it("summarizes browser and OS without full user agent", () => {
    expect(
      summarizeBrowser(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
      ),
    ).toBe("Chrome on macOS");
  });

  it("extracts pool id from path and query", () => {
    expect(extractPoolIdFromLocation("/pools/abc123", "")).toBe("abc123");
    expect(extractPoolIdFromLocation("/help", "?poolId=xyz789")).toBe(
      "xyz789",
    );
    expect(extractPoolIdFromLocation("/guides", "")).toBeUndefined();
  });

  it("discloses optional diagnostics when enabled", () => {
    const disclosure = buildHelpContextDisclosure({
      lane: "support",
      pathname: "/help",
      search: "",
      userAgent: "Mozilla/5.0 Chrome Safari",
      includeDiagnostics: true,
      signedIn: false,
      signedInEmail: null,
      signedInAccountId: null,
      anonymousFeedback: false,
    });
    expect(disclosure.optionalDiagnostics.map((d) => d.label)).toEqual([
      "Current page",
      "Browser and operating system",
      "Application version",
    ]);
    expect(disclosure.identityContext).toHaveLength(0);
  });

  it("hides optional diagnostics when toggle is off", () => {
    const disclosure = buildHelpContextDisclosure({
      lane: "support",
      pathname: "/help",
      search: "",
      userAgent: "Mozilla/5.0 Chrome Safari",
      includeDiagnostics: false,
      signedIn: true,
      signedInEmail: "player@example.test",
      signedInAccountId: "participant_1",
      anonymousFeedback: false,
    });
    expect(disclosure.optionalDiagnostics).toHaveLength(0);
    expect(disclosure.identityContext.map((d) => d.label)).toContain(
      "Account identifier",
    );
  });

  it("excludes identity context for anonymous feedback", () => {
    const disclosure = buildHelpContextDisclosure({
      lane: "feedback",
      pathname: "/pools/pool123/board",
      search: "",
      userAgent: "Mozilla/5.0 Chrome Safari",
      includeDiagnostics: true,
      signedIn: true,
      signedInEmail: "player@example.test",
      signedInAccountId: "participant_1",
      anonymousFeedback: true,
    });
    expect(disclosure.optionalDiagnostics.length).toBeGreaterThan(0);
    expect(disclosure.identityContext).toHaveLength(0);
  });

  it("builds client payload without identity fields", () => {
    const payload = buildHelpClientContextPayload({
      lane: "support",
      pathname: "/pools/pool123",
      search: "",
      userAgent: "Mozilla/5.0 Chrome Safari",
      includeDiagnostics: true,
      signedIn: true,
      signedInEmail: "player@example.test",
      signedInAccountId: "participant_1",
      anonymousFeedback: false,
    });
    expect(payload.context.pagePath).toBe("/pools/pool123");
    expect(payload.context.browserSummary).toBeTruthy();
    expect(payload.context.appVersion).toBeTruthy();
    expect(payload.context.participantId).toBeUndefined();
    expect(payload.context.email).toBeUndefined();
    expect(payload.poolIdHint).toBe("pool123");
  });
});
