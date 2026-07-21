import type { ReactNode } from "react";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";

/**
 * Shared empty / unavailable surface — wraps shadcn Empty.
 * Prefer Skeleton for pure loading placeholders.
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
    <Empty className="mx-auto max-w-md border-0 py-16">
      <EmptyHeader className="items-start text-left">
        <EmptyTitle className="text-2xl tracking-tight">{title}</EmptyTitle>
        {description ? (
          <EmptyDescription className="text-[15px] leading-6 text-op-secondary">
            {description}
          </EmptyDescription>
        ) : null}
      </EmptyHeader>
      {children}
      {action ? (
        <EmptyContent className="max-w-none items-start">{action}</EmptyContent>
      ) : null}
    </Empty>
  );
}
