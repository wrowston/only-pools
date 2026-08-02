import type { ReactNode } from "react";
import { ConvexClientProvider } from "@/components/ConvexClientProvider";
import { PostHogUserContext } from "@/components/PostHogUserContext";
import { SentryUserContext } from "@/components/SentryUserContext";
import { SiteHeader } from "@/components/SiteHeader";

/**
 * Authenticated product shell: Convex session and user analytics context
 * only load for Participant routes.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <ConvexClientProvider>
      <SentryUserContext />
      <PostHogUserContext />
      <SiteHeader variant="app" />
      <div id="main" className="flex min-h-0 flex-1 flex-col">
        {children}
      </div>
    </ConvexClientProvider>
  );
}
