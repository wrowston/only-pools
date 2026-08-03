import { describe, expect, it, beforeEach, vi } from "vitest";
import { hasClerkSessionCookie } from "./clerkSessionHint";
import {
  buildQueryKey,
  getBoardEssentialSpecs,
  getMyPoolsEssentialSpecs,
  getPoolPanelEssentialSpecs,
  getStandingsEssentialSpecs,
  makeRouteQuerySpec,
  prewarmSpecs,
  resetPrewarmDedupeForTests,
} from "./convexRouteData";
import {
  clearKeepPreviousQuery,
  clearQueryValue,
  peekQueryValue,
  rememberQueryValue,
  resetKeepPreviousQueryForTests,
  resolveKeepPrevious,
} from "./keepPreviousQuery";
import { createRoutePrewarmIntent } from "./useRoutePrewarmIntent";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

describe("hasClerkSessionCookie", () => {
  it("returns false for empty or missing cookies", () => {
    expect(hasClerkSessionCookie(undefined)).toBe(false);
    expect(hasClerkSessionCookie("")).toBe(false);
    expect(hasClerkSessionCookie("__client_uat=0")).toBe(false);
  });

  it("treats non-zero __client_uat as signed in", () => {
    expect(hasClerkSessionCookie("__client_uat=1710000000")).toBe(true);
    expect(hasClerkSessionCookie("foo=1; __client_uat=1710000000; bar=2")).toBe(
      true,
    );
  });

  it("falls back to __session presence", () => {
    expect(hasClerkSessionCookie("__session=abc.def.ghi")).toBe(true);
    expect(hasClerkSessionCookie("__client_uat=0; __session=abc")).toBe(true);
  });
});

describe("convexRouteData", () => {
  beforeEach(() => {
    resetPrewarmDedupeForTests();
  });

  it("builds stable query keys", () => {
    const a = buildQueryKey("participants:myPools", { includeArchived: false });
    const b = buildQueryKey("participants:myPools", { includeArchived: false });
    const c = buildQueryKey("participants:myPools", { includeArchived: true });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("defines my-pools / board / standings / panel essential specs", () => {
    const poolId = "jd7abc123" as Id<"pools">;
    expect(getMyPoolsEssentialSpecs()).toHaveLength(1);
    expect(getBoardEssentialSpecs(poolId).map((s) => s.key)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("getPoolShell"),
        expect.stringContaining("getWeekBoard"),
      ]),
    );
    expect(getStandingsEssentialSpecs(poolId, "confidence")).toHaveLength(2);
    expect(getStandingsEssentialSpecs(poolId, "survivor")).toHaveLength(2);
    expect(getStandingsEssentialSpecs(poolId, null).length).toBeGreaterThan(2);
    expect(getPoolPanelEssentialSpecs(poolId)).toHaveLength(1);
  });

  it("dedupes prewarmSpecs within the dedupe window", () => {
    const prewarmQuery = vi.fn();
    const convex = { prewarmQuery } as unknown as Parameters<
      typeof prewarmSpecs
    >[0];
    const specs = [
      makeRouteQuerySpec(api.participants.myPools, { includeArchived: false }),
    ];
    prewarmSpecs(convex, specs, { dedupeMs: 60_000 });
    prewarmSpecs(convex, specs, { dedupeMs: 60_000 });
    expect(prewarmQuery).toHaveBeenCalledTimes(1);
  });
});

describe("keepPreviousQuery", () => {
  beforeEach(() => {
    resetKeepPreviousQueryForTests();
  });

  it("remembers and peeks values", () => {
    rememberQueryValue("k", { ok: true });
    expect(peekQueryValue<{ ok: boolean }>("k")).toEqual({ ok: true });
    clearQueryValue("k");
    expect(peekQueryValue("k")).toBeUndefined();
  });

  it("falls back to previous while live is undefined", () => {
    const first = resolveKeepPrevious("standings", { rows: [1] });
    expect(first.isPrevious).toBe(false);
    const second = resolveKeepPrevious<{ rows: number[] }>(
      "standings",
      undefined,
    );
    expect(second.isPrevious).toBe(true);
    expect(second.value).toEqual({ rows: [1] });
  });

  it("clears all kept values", () => {
    resolveKeepPrevious("standings", { rows: [1] });
    clearKeepPreviousQuery();
    const after = resolveKeepPrevious<{ rows: number[] }>(
      "standings",
      undefined,
    );
    expect(after.value).toBeUndefined();
    expect(after.isPrevious).toBe(false);
  });
});

describe("createRoutePrewarmIntent", () => {
  it("debounces schedule and cancels on leave", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const { handlers, cancel } = createRoutePrewarmIntent(fn, {
      debounceMs: 120,
    });
    handlers.onMouseEnter();
    handlers.onMouseEnter();
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(120);
    expect(fn).toHaveBeenCalledTimes(1);
    handlers.onMouseEnter();
    handlers.onMouseLeave();
    vi.advanceTimersByTime(120);
    expect(fn).toHaveBeenCalledTimes(1);
    cancel();
    vi.useRealTimers();
  });
});
