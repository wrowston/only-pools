import type { Metadata } from "next";
import { Suspense } from "react";
import { HelpFeedbackPage } from "@/components/help/HelpFeedbackPage";

export const metadata: Metadata = {
  title: "Help & feedback",
  description:
    "Get product support or share feedback for Only Pools Survivor and Confidence Pools.",
  alternates: { canonical: "/help" },
};

function HelpFallback() {
  return (
    <div className="px-5 py-10 sm:px-8 sm:py-14">
      <div className="mx-auto max-w-3xl">
        <p className="op-eyebrow text-op-heat">Help & feedback</p>
        <h1 className="mt-3 text-3xl font-medium tracking-tight text-op-text">
          How can we help?
        </h1>
      </div>
    </div>
  );
}

export default function HelpPage() {
  return (
    <Suspense fallback={<HelpFallback />}>
      <HelpFeedbackPage />
    </Suspense>
  );
}
