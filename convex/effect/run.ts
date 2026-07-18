import { Cause, Effect, Exit } from "effect";

/**
 * Run an Effect at a Convex action / HTTP edge and return its success value.
 * Failures (typed or defect) become thrown Errors for Promise call sites.
 */
export function runEffect<A, E>(
  effect: Effect.Effect<A, E>,
): Promise<A> {
  return Effect.runPromise(effect);
}

/**
 * Run an Effect and return an Exit for callers that want typed failure handling.
 */
export function runEffectExit<A, E>(
  effect: Effect.Effect<A, E>,
): Promise<Exit.Exit<A, E>> {
  return Effect.runPromiseExit(effect);
}

/**
 * Convert a failed Exit into a thrown Error (useful behind Promise adapters).
 */
export function throwExitFailure<A, E>(exit: Exit.Exit<A, E>): A {
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }
  const failure = Cause.squash(exit.cause);
  if (failure instanceof Error) {
    throw failure;
  }
  throw new Error(String(failure));
}
