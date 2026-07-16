import { describe, expect, it } from "vitest";
import {
  COMPACT_CONTROL_CLASS,
  LIVE_REGION_ALLOWLIST,
  SHELL_BREAKPOINT_PX,
  TOUCH_TARGET_MIN_CLASS,
  backHref,
  backLabel,
  poolNavItems,
  poolSectionFromPath,
  poolSectionHref,
  shellChromeClasses,
} from "./gameDayShell";

describe("game-day shell navigation contract", () => {
  it("uses a hard 900px shell switch", () => {
    expect(SHELL_BREAKPOINT_PX).toBe(900);
    const chrome = shellChromeClasses();
    expect(chrome.mobileChips).toContain("min-[900px]:hidden");
    expect(chrome.desktopSidebar).toContain("min-[900px]:flex");
    expect(chrome.contextRail).toContain("min-[900px]:flex");
  });

  it("treats Week Board as primary with Standings and Pool secondary", () => {
    const items = poolNavItems("pool_abc");
    expect(items.map((i) => i.section)).toEqual([
      "board",
      "standings",
      "pool",
    ]);
    expect(items.find((i) => i.section === "board")?.primary).toBe(true);
    expect(items.find((i) => i.section === "standings")?.primary).toBe(false);
    expect(items.find((i) => i.section === "pool")?.primary).toBe(false);
    expect(items[0]?.href).toBe("/pools/pool_abc");
    expect(items[1]?.href).toBe("/pools/pool_abc/standings");
    expect(items[2]?.href).toBe("/pools/pool_abc/pool");
  });

  it("resolves active section from pool paths", () => {
    expect(poolSectionFromPath("/pools/x")).toBe("board");
    expect(poolSectionFromPath("/pools/x/standings")).toBe("standings");
    expect(poolSectionFromPath("/pools/x/pool")).toBe("pool");
  });

  it("returns to My Pools from Board and to Board from secondary surfaces", () => {
    expect(backHref("p1", "board")).toBe("/my-pools");
    expect(backLabel("board")).toBe("My Pools");
    expect(backHref("p1", "standings")).toBe("/pools/p1");
    expect(backLabel("standings")).toBe("Week Board");
    expect(backHref("p1", "pool")).toBe("/pools/p1");
    expect(backLabel("pool")).toBe("Week Board");
  });

  it("preserves section when switching Pools via the picker", () => {
    expect(poolSectionHref("p2", "board")).toBe("/pools/p2");
    expect(poolSectionHref("p2", "standings")).toBe("/pools/p2/standings");
    expect(poolSectionHref("p2", "pool")).toBe("/pools/p2/pool");
  });

  it("documents 44px touch targets via min-h-11/min-w-11 for pick actions", () => {
    expect(TOUCH_TARGET_MIN_CLASS).toBe("min-h-11 min-w-11");
  });

  it("documents Firecrawl 32px chrome controls via h-8", () => {
    expect(COMPACT_CONTROL_CLASS).toBe("h-8");
  });

  it("allows polite aria-live only on SaveTrust and StatusBanner", () => {
    expect([...LIVE_REGION_ALLOWLIST].sort()).toEqual([
      "SaveTrust",
      "StatusBanner",
    ]);
  });
});
