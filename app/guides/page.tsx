import type { Metadata } from "next";
import Link from "next/link";
import { GUIDE_CATEGORIES, guides } from "@/lib/guides";

export const metadata: Metadata = {
  title: "Guides",
  description: "Everything you need to run or play in an Only Pools Survivor or Confidence Pool.",
  alternates: { canonical: "/guides" },
};

export default function GuidesPage() {
  return (
    <div className="px-5 py-10 sm:px-8 sm:py-14">
      <div className="mx-auto max-w-3xl">
        <p className="op-eyebrow text-op-heat">Only Pools help center</p>
        <h1 className="mt-3 text-4xl font-medium leading-tight tracking-[-0.035em] text-op-text sm:text-5xl">Run your Pool. Make your picks.</h1>
        <p className="mt-5 max-w-2xl text-[16px] leading-7 text-op-secondary">Practical guides for Pool Owners, Admins, and Members—from the first invite through final standings.</p>

        <div className="mt-12 space-y-12">
          {GUIDE_CATEGORIES.map((category) => (
            <section key={category} aria-labelledby={`category-${category.toLocaleLowerCase().replace(/[^a-z]+/g, "-")}`}>
              <h2 id={`category-${category.toLocaleLowerCase().replace(/[^a-z]+/g, "-")}`} className="text-xl font-medium text-op-text">{category}</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {guides.filter((guide) => guide.category === category).map((guide) => (
                  <Link key={guide.slug} href={`/guides/${guide.slug}`} className="group rounded-[14px] border border-op-border bg-op-surface p-5 transition-colors hover:border-op-heat-20 hover:bg-op-heat-4">
                    <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-op-muted">{guide.audience}</span>
                    <h3 className="mt-2 text-base font-medium leading-6 text-op-text group-hover:text-op-selected-fg">{guide.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-op-secondary">{guide.summary}</p>
                    <span className="mt-4 inline-block text-sm font-medium text-op-selected-fg">Read guide →</span>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
