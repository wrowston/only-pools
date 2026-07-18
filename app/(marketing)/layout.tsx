import type { ReactNode } from "react";
import { SiteHeader } from "@/components/SiteHeader";

/**
 * Public marketing shell: Clerk is in the root layout; Convex / incident
 * banner / analytics user context stay off this tree so prerendered HTML
 * stays light and client work starts later.
 */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader variant="marketing" />
      <div id="main" className="flex min-h-0 flex-1 flex-col">
        {children}
      </div>
    </>
  );
}
