/**
 * Resolves with the promise result, or `null` if it does not settle within `ms`.
 * Clears the timer when the primary promise wins the race.
 */
export async function promiseWithTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
