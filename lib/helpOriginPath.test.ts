import { afterEach, describe, expect, it } from "vitest";
import {
  HELP_ORIGIN_PATH_STORAGE_KEY,
  isHelpRoute,
  readHelpOriginPath,
  resolveHelpDiagnosticLocation,
  writeHelpOriginPath,
} from "@/lib/helpOriginPath";

describe("helpOriginPath", () => {
  afterEach(() => {
    sessionStorage.clear();
  });

  it("detects help routes", () => {
    expect(isHelpRoute("/help")).toBe(true);
    expect(isHelpRoute("/help/")).toBe(true);
    expect(isHelpRoute("/pools/abc")).toBe(false);
  });

  it("stashes non-help paths and ignores help itself", () => {
    writeHelpOriginPath("/pools/abc/board", "?week=3");
    expect(readHelpOriginPath()).toEqual({
      pathname: "/pools/abc/board",
      search: "?week=3",
    });

    writeHelpOriginPath("/help", "?source=board");
    expect(readHelpOriginPath()).toEqual({
      pathname: "/pools/abc/board",
      search: "?week=3",
    });
  });

  it("normalizes search without a leading question mark", () => {
    writeHelpOriginPath("/my-pools", "tab=active");
    expect(readHelpOriginPath()?.search).toBe("?tab=active");
  });

  it("resolves diagnostics to the stashed origin on /help", () => {
    writeHelpOriginPath("/pools/abc/standings", "");
    expect(
      resolveHelpDiagnosticLocation({
        pathname: "/help",
        search: "?source=standings",
      }),
    ).toEqual({
      pathname: "/pools/abc/standings",
      search: "",
    });
  });

  it("falls back to the current help location when nothing is stashed", () => {
    expect(
      resolveHelpDiagnosticLocation({
        pathname: "/help",
        search: "?source=guides",
      }),
    ).toEqual({
      pathname: "/help",
      search: "?source=guides",
    });
  });

  it("ignores malformed session payloads", () => {
    sessionStorage.setItem(HELP_ORIGIN_PATH_STORAGE_KEY, "{not-json");
    expect(readHelpOriginPath()).toBeNull();
  });
});
