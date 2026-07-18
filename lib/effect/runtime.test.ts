import { Data, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";

import {
  runAppEffect,
  runAppEffectExit,
  throwAppExitFailure,
} from "./runtime";

class DemoError extends Data.TaggedError("DemoError")<{
  readonly reason: string;
}> {}

describe("runAppEffect", () => {
  it("returns success values", async () => {
    await expect(runAppEffect(Effect.succeed(42))).resolves.toBe(42);
  });

  it("rejects on failure", async () => {
    await expect(
      runAppEffect(Effect.fail(new DemoError({ reason: "nope" }))),
    ).rejects.toThrow(/DemoError|An error has occurred/);
  });
});

describe("runAppEffectExit", () => {
  it("returns Exit.success", async () => {
    const exit = await runAppEffectExit(Effect.succeed("ok"));
    expect(Exit.isSuccess(exit)).toBe(true);
  });
});

describe("throwAppExitFailure", () => {
  it("returns success value", () => {
    expect(throwAppExitFailure(Exit.succeed(7))).toBe(7);
  });

  it("throws failure", () => {
    expect(() =>
      throwAppExitFailure(Exit.fail(new DemoError({ reason: "x" }))),
    ).toThrow(DemoError);
  });
});
