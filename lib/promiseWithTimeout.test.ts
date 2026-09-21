import { describe, expect, it, vi } from "vitest";
import { promiseWithTimeout } from "./promiseWithTimeout";

describe("promiseWithTimeout", () => {
  it("returns the settled value when the promise finishes first", async () => {
    await expect(promiseWithTimeout(Promise.resolve("ok"), 50)).resolves.toBe(
      "ok",
    );
  });

  it("returns null when the promise outlasts the timeout", async () => {
    vi.useFakeTimers();
    const never = new Promise<string>(() => {});
    const result = promiseWithTimeout(never, 400);
    await vi.advanceTimersByTimeAsync(400);
    await expect(result).resolves.toBeNull();
    vi.useRealTimers();
  });

  it("clears the timer when the promise wins", async () => {
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    await promiseWithTimeout(Promise.resolve(1), 400);
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});
