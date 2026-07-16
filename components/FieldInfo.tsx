"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

type FieldInfoProps = {
  /** Short name used in the button’s accessible label, e.g. "Pool Type". */
  label: string;
  title: string;
  children: ReactNode;
};

/**
 * Compact “i” control that opens a modal with plain-language help for a form field.
 */
export function FieldInfo({ label, title, children }: FieldInfoProps) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }

    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`About ${label}`}
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-op-border-strong bg-op-control text-[11px] font-semibold leading-none text-op-secondary transition-colors hover:bg-[#00000014] hover:text-op-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-op-ink"
      >
        i
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center bg-black/35 p-4 sm:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="flex max-h-[85vh] w-full max-w-md flex-col gap-3 overflow-y-auto rounded-[16px] border border-op-border bg-op-surface p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              id={titleId}
              className="text-base font-semibold text-op-text"
            >
              {title}
            </h3>
            <div className="flex flex-col gap-3 text-sm leading-relaxed text-op-secondary">
              {children}
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={() => setOpen(false)}
              className="op-btn op-btn-primary mt-1 self-stretch sm:self-end"
            >
              Got it
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function FieldInfoTerm({
  term,
  children,
}: {
  term: string;
  children: ReactNode;
}) {
  return (
    <p>
      <span className="font-medium text-op-text">{term}</span>
      {" — "}
      {children}
    </p>
  );
}
