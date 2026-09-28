import { afterEach, describe, expect, it, vi } from "vitest";
import { promiseWithTimeout } from "./promiseWithTimeout";

describe("promiseWithTimeout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the settled value when faster than the timeout", async () => {
    await expect(promiseWithTimeout(Promise.resolve("ok"), 500)).resolves.toBe(
      "ok",
    );
  });

  it("returns null when the timeout elapses first", async () => {
    vi.useFakeTimers();
    const pending = promiseWithTimeout(
      new Promise<string>(() => {
        /* never settles */
      }),
      400,
    );
    await vi.advanceTimersByTimeAsync(400);
    await expect(pending).resolves.toBeNull();
  });

  it("clears the timer when the promise settles before the timeout", async () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    await promiseWithTimeout(Promise.resolve(1), 400);
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});
