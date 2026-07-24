import type { ReactNode } from "react";
import { ConvexClientProvider } from "@/components/ConvexClientProvider";
import { PostHogUserContext } from "@/components/PostHogUserContext";
import { SentryUserContext } from "@/components/SentryUserContext";
import { SiteHeader } from "@/components/SiteHeader";
import { StatusBanner } from "@/components/StatusBanner";
import { FeedbackPrompt } from "@/components/help/FeedbackPrompt";

/**
 * Authenticated product shell: Convex session, status banner, and user
 * analytics context only load for Participant routes.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <ConvexClientProvider>
      <SentryUserContext />
      <PostHogUserContext />
      <SiteHeader variant="app" />
      <StatusBanner />
      <FeedbackPrompt />
      <div id="main" className="flex min-h-0 flex-1 flex-col">
        {children}
      </div>
    </ConvexClientProvider>
  );
}
