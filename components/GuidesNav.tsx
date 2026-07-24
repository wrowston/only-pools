"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GUIDE_CATEGORIES, guides } from "@/lib/guides";
import { HELP_FEEDBACK_LABEL } from "@/lib/helpNav";

function GuideLinks() {
  const pathname = usePathname();
  return GUIDE_CATEGORIES.map((category) => (
    <section key={category} className="mb-6 last:mb-0">
      <h2 className="flex items-center gap-2 px-2.5 pb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-op-selected-fg">
        <span className="h-1.5 w-1.5 rounded-full bg-op-heat" aria-hidden />
        {category}
      </h2>
      <ul className="ml-[13px] space-y-0.5 border-l border-op-border-strong pl-2">
        {guides.filter((guide) => guide.category === category).map((guide) => {
          const href = `/guides/${guide.slug}`;
          const active = pathname === href;
          return (
            <li key={guide.slug}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`block rounded-[8px] px-3 py-2 text-[14px] leading-5 transition-colors ${
                  active
                    ? "bg-op-selected font-medium text-op-selected-fg"
                    : "font-medium text-op-text hover:bg-op-control"
                }`}
              >
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
      <aside
        className="hidden w-72 shrink-0 border-r border-op-border px-4 py-8 lg:block"
        aria-label="Guide navigation"
      >
        <nav className="sticky top-24">
          <Link
            href="/help?source=guides"
            className="mb-6 inline-flex h-8 items-center rounded-[8px] border border-op-border bg-op-surface px-3 text-[13px] font-medium text-op-text transition-colors hover:border-op-heat-20 hover:bg-op-heat-4"
          >
            {HELP_FEEDBACK_LABEL}
          </Link>
          <GuideLinks />
        </nav>
      </aside>
      <details className="border-b border-op-border bg-op-surface px-5 py-3 lg:hidden">
        <summary className="cursor-pointer text-sm font-medium text-op-text">
          Browse all guides
        </summary>
        <nav
          aria-label="Guide navigation"
          className="mt-5 max-h-[65vh] overflow-y-auto"
        >
          <Link
            href="/help?source=guides"
            className="mb-5 inline-flex h-8 items-center rounded-[8px] border border-op-border bg-op-surface px-3 text-[13px] font-medium text-op-text"
          >
            {HELP_FEEDBACK_LABEL}
          </Link>
          <GuideLinks />
        </nav>
      </details>
    </>
  );
}
