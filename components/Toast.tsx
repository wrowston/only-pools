"use client";

import {
  CircleAlertIcon,
  CircleXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useEffect, useEffectEvent } from "react";

export type ToastTone = "error" | "warning";

type ToastProps = {
  message: string | null;
  /** Short headline above the message. Defaults by tone. */
  title?: string;
  tone?: ToastTone;
  onDismiss: () => void;
  /** Auto-dismiss delay in ms. Default 5500. */
  durationMs?: number;
};

const TONE_STYLES: Record<
  ToastTone,
  {
    shell: string;
    icon: string;
    title: string;
    body: string;
    dismiss: string;
    defaultTitle: string;
    Icon: typeof CircleAlertIcon;
  }
> = {
  error: {
    shell:
      "border-op-lost-border bg-op-lost-bg text-op-lost-fg shadow-md ring-1 ring-op-lost-border/60",
    icon: "text-op-lost-fg",
    title: "text-op-lost-fg",
    body: "text-op-lost-fg/90",
    dismiss:
      "text-op-lost-fg/70 hover:bg-op-lost-border/40 hover:text-op-lost-fg",
    defaultTitle: "Can't save that pick",
    Icon: CircleAlertIcon,
  },
  warning: {
    shell:
      "border-op-banner-border bg-op-banner-bg text-op-banner-fg shadow-md ring-1 ring-op-banner-border/70",
    icon: "text-op-banner-fg",
    title: "text-op-banner-fg",
    body: "text-op-banner-fg/90",
    dismiss:
      "text-op-banner-fg/70 hover:bg-op-banner-border/50 hover:text-op-banner-fg",
    defaultTitle: "Heads up",
    Icon: TriangleAlertIcon,
  },
};

/**
 * Ephemeral feedback for user-triggered rule violations (e.g. Survivor one-use).
 * Not used for routine save trust — that stays inline via SaveTrust.
 * Uses role="alert" (assertive) — not polite aria-live (scenario 47).
 */
export function Toast({
  message,
  title,
  tone = "error",
  onDismiss,
  durationMs = 5500,
}: ToastProps) {
  const dismiss = useEffectEvent(onDismiss);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => dismiss(), durationMs);
    return () => window.clearTimeout(timer);
  }, [message, durationMs]);

  if (!message) return null;

  const styles = TONE_STYLES[tone];
  const Icon = styles.Icon;
  const heading = title ?? styles.defaultTitle;

  return (
    <div
      role="alert"
      data-toast="true"
      className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4 animate-in fade-in-0 slide-in-from-bottom-2 duration-200"
    >
      <div
        className={[
          "pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl border px-3.5 py-3",
          styles.shell,
        ].join(" ")}
      >
        <Icon
          className={`mt-0.5 size-4 shrink-0 ${styles.icon}`}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-semibold tracking-tight ${styles.title}`}>
            {heading}
          </p>
          <p className={`mt-0.5 text-sm leading-snug ${styles.body}`}>
            {message}
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className={[
            "inline-flex size-8 shrink-0 items-center justify-center rounded-md transition-colors",
            styles.dismiss,
          ].join(" ")}
          aria-label="Dismiss"
        >
          <CircleXIcon className="size-4" />
        </button>
      </div>
    </div>
  );
}
