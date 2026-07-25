import type { ReactNode } from "react";
import { ConvexClientProvider } from "@/components/ConvexClientProvider";

/**
 * Help & Feedback needs Convex for signed-in identity disclosure
 * (`myHelpIdentity`). Keep the provider scoped to /help so the rest of the
 * marketing tree stays Convex-free.
 */
export default function HelpLayout({ children }: { children: ReactNode }) {
  return <ConvexClientProvider>{children}</ConvexClientProvider>;
}
