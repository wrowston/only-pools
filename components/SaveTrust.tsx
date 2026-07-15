"use client";

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

  const label =
    status === "saving"
      ? "Saving…"
      : status === "saved"
        ? "Saved"
        : explanation ?? "Save failed — tap a team to retry";

  return (
    <p
      className={
        status === "error"
          ? "text-sm text-op-lost-fg"
          : "text-sm text-op-secondary"
      }
      aria-live="polite"
      data-save-trust={status}
      data-live-region="save-trust"
    >
      {label}
    </p>
  );
}
