import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { GuideSearch } from "@/components/GuideSearch";
import { GuidesNav } from "@/components/GuidesNav";

export const metadata: Metadata = {
  title: { default: "Guides — Only Pools", template: "%s — Only Pools Guides" },
  description: "Learn how to create, join, manage, and play in an Only Pools NFL Survivor or Confidence Pool.",
};

export default function GuidesLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex flex-1 flex-col bg-op-canvas">
      <header className="border-b border-op-border bg-op-canvas-lighter px-5 py-8 sm:px-8">
        <div className="mx-auto flex max-w-[1180px] flex-col gap-5">
          <div className="flex items-center gap-2 text-sm text-op-muted">
            <Link href="/" className="hover:text-op-text">Only Pools</Link>
            <span aria-hidden>/</span>
            <Link href="/guides" className="font-medium text-op-text">Guides</Link>
          </div>
          <GuideSearch />
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-[1180px] flex-1 flex-col lg:flex-row">
        <GuidesNav />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </main>
  );
}
