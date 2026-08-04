import type { ReactNode } from "react";
import { ConvexClientProvider } from "@/components/ConvexClientProvider";
import { SiteHeader } from "@/components/SiteHeader";

/**
 * Invite join shell: Convex is required for signed-in accept, but we skip
 * app analytics identify hooks, route prewarm, and the FeedbackPrompt so
 * guest invite LCP stays closer to the marketing tree.
 */
export default function InviteLayout({ children }: { children: ReactNode }) {
  return (
    <ConvexClientProvider>
      <SiteHeader variant="marketing" />
      <div id="main" className="flex min-h-0 flex-1 flex-col">
        {children}
      </div>
    </ConvexClientProvider>
  );
}
