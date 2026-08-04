import Link from "next/link";
import type { ReactNode } from "react";

type LegalDocumentProps = {
  title: string;
  description: string;
  updatedLabel: string;
  children: ReactNode;
};

/**
 * Shared shell for public Terms / Privacy pages — matches guide typography
 * without pulling in MDX.
 */
export function LegalDocument({
  title,
  description,
  updatedLabel,
  children,
}: LegalDocumentProps) {
  return (
    <article className="px-5 py-10 sm:px-8 sm:py-14">
      <div className="mx-auto max-w-3xl">
        <p className="text-[11px] font-medium uppercase tracking-[0.07em] text-op-muted">
          Legal
        </p>
        <h1 className="mt-3 max-w-3xl text-3xl font-medium leading-tight tracking-[-0.035em] text-op-text sm:text-4xl">
          {title}
        </h1>
        <p className="mt-4 text-[16px] leading-7 text-op-secondary">
          {description}
        </p>
        <p className="mt-2 border-b border-op-border pb-8 text-sm text-op-muted">
          {updatedLabel}
        </p>
        <div className="legal-content">{children}</div>
        <p className="mt-12 rounded-[12px] border border-op-border bg-op-surface px-4 py-3 text-sm leading-6 text-op-secondary">
          Questions? Reach us through{" "}
          <Link
            href="/help"
            className="font-medium text-op-selected-fg underline underline-offset-4"
          >
            Help &amp; feedback
          </Link>
          .
        </p>
      </div>
    </article>
  );
}

export function LegalSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-10">
      <h2 className="mb-3 text-2xl font-medium tracking-[-0.025em] text-op-text">
        {title}
      </h2>
      <div className="space-y-4 text-[15px] leading-7 text-op-secondary">
        {children}
      </div>
    </section>
  );
}

export function LegalList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="ml-5 list-disc space-y-2 marker:text-op-heat">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}
