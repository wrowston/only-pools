"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GUIDE_CATEGORIES, guides } from "@/lib/guides";

function GuideLinks() {
  const pathname = usePathname();
  return GUIDE_CATEGORIES.map((category) => (
    <section key={category} className="mb-5">
      <h2 className="op-eyebrow px-2.5 pb-1.5">{category}</h2>
      <ul className="space-y-0.5">
        {guides.filter((guide) => guide.category === category).map((guide) => {
          const href = `/guides/${guide.slug}`;
          const active = pathname === href;
          return (
            <li key={guide.slug}>
              <Link href={href} aria-current={active ? "page" : undefined} className={`block rounded-[8px] px-2.5 py-2 text-[13px] leading-5 transition-colors ${active ? "bg-op-selected font-medium text-op-selected-fg" : "text-op-secondary hover:bg-op-control hover:text-op-text"}`}>
                {guide.title}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  ));
}

export function GuidesNav() {
  return (
    <>
      <aside className="hidden w-72 shrink-0 border-r border-op-border px-4 py-8 lg:block" aria-label="Guide navigation">
        <nav className="sticky top-24"><GuideLinks /></nav>
      </aside>
      <details className="border-b border-op-border bg-op-surface px-5 py-3 lg:hidden">
        <summary className="cursor-pointer text-sm font-medium text-op-text">Browse all guides</summary>
        <nav aria-label="Guide navigation" className="mt-4 max-h-[65vh] overflow-y-auto"><GuideLinks /></nav>
      </details>
    </>
  );
}
