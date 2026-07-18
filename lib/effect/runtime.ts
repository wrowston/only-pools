import { Cause, Effect, Exit } from "effect";

/**
 * Next.js Server Action / Route Handler edge runner.
 * Prefer this over scattering Effect.runPromise across the app.
 */
export function runAppEffect<A, E>(
  effect: Effect.Effect<A, E>,
): Promise<A> {
  return Effect.runPromise(effect);
}

/**
 * Run an Effect and return Exit for typed failure handling at the UI/HTTP edge.
 */
export function runAppEffectExit<A, E>(
  effect: Effect.Effect<A, E>,
): Promise<Exit.Exit<A, E>> {
  return Effect.runPromiseExit(effect);
}

/** Squash a failed Exit into a thrown Error. */
export function throwAppExitFailure<A, E>(exit: Exit.Exit<A, E>): A {
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }
  const failure = Cause.squash(exit.cause);
  if (failure instanceof Error) {
    throw failure;
  }
  throw new Error(String(failure));
}
