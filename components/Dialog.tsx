"use client";

import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from "react";

type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Optional header accessory (e.g. guide link). */
  titleAccessory?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  /** Wider panel for multi-step flows. */
  size?: "md" | "lg";
  /** When true, Escape / backdrop click do not close. */
  preventClose?: boolean;
};

/**
 * Accessible modal shell aligned with FieldInfo’s overlay styling.
 */
export function Dialog({
  open,
  onClose,
  title,
  titleAccessory,
  description,
  children,
  size = "md",
  preventClose = false,
}: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !preventClose) onClose();
    }

    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Focus the panel so keyboard users land inside the dialog.
    panelRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose, preventClose]);

  if (!open) return null;

  const maxWidth = size === "lg" ? "max-w-lg" : "max-w-md";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/35 p-4 sm:items-center"
      onClick={() => {
        if (!preventClose) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={`flex max-h-[90vh] w-full ${maxWidth} flex-col overflow-hidden rounded-[16px] border border-op-border bg-op-surface shadow-lg outline-none`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-1 border-b border-op-border px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <h2
              id={titleId}
              className="text-lg font-semibold text-op-text"
            >
              {title}
            </h2>
            {titleAccessory}
          </div>
          {description ? (
            <div
              id={descriptionId}
              className="text-xs text-op-muted"
            >
              {description}
            </div>
          ) : null}
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-4">
          {children}
        </div>
      </div>
    </div>
  );
}
