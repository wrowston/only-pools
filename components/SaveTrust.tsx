"use client";

import { CircleCheckBigIcon, LoaderCircleIcon } from "lucide-react";

type SaveTrustProps = {
  status: "idle" | "saving" | "saved" | "error";
  explanation?: string;
};

/**
 * Quiet inline save confirmation — no toast. Polite live region for
 * save-trust only (scenario 47 / shell contract).
 */
export function SaveTrust({ status, explanation }: SaveTrustProps) {
  if (status === "idle") {
    return null;
  }

  if (status === "saved") {
    return (
      <p
        className="inline-flex items-center gap-1.5 text-sm font-medium text-op-won-fg"
        aria-live="polite"
        data-save-trust={status}
        data-live-region="save-trust"
      >
        <CircleCheckBigIcon className="size-4 shrink-0" aria-hidden="true" />
        Saved
      </p>
    );
  }

  if (status === "saving") {
    return (
      <p
        className="inline-flex items-center gap-1.5 text-sm text-op-secondary"
        aria-live="polite"
        data-save-trust={status}
        data-live-region="save-trust"
      >
        <LoaderCircleIcon
          className="size-4 shrink-0 animate-spin text-op-muted"
          aria-hidden="true"
        />
        Saving…
      </p>
    );
  }

  return (
    <p
      className="text-sm text-op-lost-fg"
      aria-live="polite"
      data-save-trust={status}
      data-live-region="save-trust"
    >
      {explanation ?? "Save failed — tap a team to retry"}
    </p>
  );
}
