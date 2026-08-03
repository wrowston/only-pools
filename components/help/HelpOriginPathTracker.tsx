"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { writeHelpOriginPath } from "@/lib/helpOriginPath";

function HelpOriginPathTrackerInner() {
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();
  const search = searchParams.toString();

  useEffect(() => {
    writeHelpOriginPath(pathname, search.length > 0 ? `?${search}` : "");
  }, [pathname, search]);

  return null;
}

/** Keeps sessionStorage updated with the latest non-help route for diagnostics. */
export function HelpOriginPathTracker() {
  return (
    <Suspense fallback={null}>
      <HelpOriginPathTrackerInner />
    </Suspense>
  );
}
