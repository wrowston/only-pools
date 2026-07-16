import Link from "next/link";
import type { ReactNode } from "react";
import { COMPACT_CONTROL_CLASS } from "@/lib/gameDayShell";

/**
 * Secondary CTA that reads as an action, not body text.
 */
export function TextLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`${COMPACT_CONTROL_CLASS} inline-flex items-center text-[13px] font-medium text-op-heat underline-offset-2 hover:underline`}
    >
      {children}
    </Link>
  );
}
