"use client";

import { useEffect, useEffectEvent } from "react";

type ToastProps = {
  message: string | null;
  onDismiss: () => void;
  /** Auto-dismiss delay in ms. Default 4500. */
  durationMs?: number;
};

/**
 * Ephemeral feedback for user-triggered rule violations (e.g. Survivor one-use).
 * Not used for routine save trust — that stays inline via SaveTrust.
 */
export function Toast({
  message,
  onDismiss,
  durationMs = 4500,
}: ToastProps) {
  const dismiss = useEffectEvent(onDismiss);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => dismiss(), durationMs);
    return () => window.clearTimeout(timer);
  }, [message, durationMs]);

  if (!message) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-toast="true"
      className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4"
    >
      <p className="pointer-events-auto max-w-md rounded-[10px] border border-op-banner-border bg-op-banner-bg px-4 py-3 text-sm text-op-banner-fg shadow-sm">
        {message}
      </p>
    </div>
  );
}
