import { useEffect, useMemo, useRef } from "react";
import { PREWARM_DEBOUNCE_MS } from "@/lib/convexRouteData";

type PrewarmFn = () => void | Promise<void>;

type UseRoutePrewarmIntentOptions = {
  debounceMs?: number;
};

export type RoutePrewarmIntentHandlers = {
  onMouseEnter: () => void;
  onFocus: () => void;
  onTouchStart: () => void;
  onMouseLeave: () => void;
  onBlur: () => void;
};

export function createRoutePrewarmIntent(
  prewarmFn: PrewarmFn,
  options: UseRoutePrewarmIntentOptions = {},
) {
  const debounceMs = options.debounceMs ?? PREWARM_DEBOUNCE_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const cancel = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = undefined;
  };

  const schedule = () => {
    if (timer) return;

    timer = setTimeout(() => {
      timer = undefined;
      Promise.resolve(prewarmFn()).catch((error) => {
        console.warn("Route prewarm intent failed", error);
      });
    }, debounceMs);
  };

  const handlers: RoutePrewarmIntentHandlers = {
    onMouseEnter: schedule,
    onFocus: schedule,
    onTouchStart: schedule,
    onMouseLeave: cancel,
    onBlur: cancel,
  };

  return { handlers, cancel };
}

/**
 * Stable intent handlers that debounce prewarm work. The latest prewarm fn is
 * read only when an intent fires (not during render).
 */
export function useRoutePrewarmIntent(
  prewarmFn: PrewarmFn,
  options: UseRoutePrewarmIntentOptions = {},
): RoutePrewarmIntentHandlers {
  const debounceMs = options.debounceMs ?? PREWARM_DEBOUNCE_MS;
  const stateRef = useRef({
    prewarmFn,
    debounceMs,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
  });

  useEffect(() => {
    stateRef.current.prewarmFn = prewarmFn;
    stateRef.current.debounceMs = debounceMs;
  }, [prewarmFn, debounceMs]);

  useEffect(() => {
    const state = stateRef.current;
    return () => {
      const timer = state.timer;
      if (!timer) return;
      clearTimeout(timer);
      state.timer = undefined;
    };
  }, []);

  return useMemo((): RoutePrewarmIntentHandlers => {
    const cancel = () => {
      const timer = stateRef.current.timer;
      if (!timer) return;
      clearTimeout(timer);
      stateRef.current.timer = undefined;
    };

    const schedule = () => {
      if (stateRef.current.timer) return;
      stateRef.current.timer = setTimeout(() => {
        stateRef.current.timer = undefined;
        Promise.resolve(stateRef.current.prewarmFn()).catch((error) => {
          console.warn("Route prewarm intent failed", error);
        });
      }, stateRef.current.debounceMs);
    };

    return {
      onMouseEnter: schedule,
      onFocus: schedule,
      onTouchStart: schedule,
      onMouseLeave: cancel,
      onBlur: cancel,
    };
  }, []);
}
