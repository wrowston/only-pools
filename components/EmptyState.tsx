import type { ReactNode } from "react";

/**
 * Shared empty / unavailable surface — never leave a blank white main area.
 */
export function EmptyState({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-6 py-16">
      <h1 className="text-2xl font-medium tracking-tight text-op-text">
        {title}
      </h1>
      {description ? (
        <p className="text-[15px] leading-6 text-op-secondary">{description}</p>
      ) : null}
      {children}
      {action ? <div className="flex flex-wrap items-center gap-3">{action}</div> : null}
    </div>
  );
}
