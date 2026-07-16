import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { guideContentLoaders } from "@/lib/guideContent";
import { guides } from "@/lib/guides";

type GuidePageProps = { params: Promise<{ slug: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return guides.map((guide) => ({ slug: guide.slug }));
}

export async function generateMetadata({ params }: GuidePageProps): Promise<Metadata> {
  const { slug } = await params;
  const guide = guides.find((candidate) => candidate.slug === slug);
  if (!guide) return {};
  return {
    title: guide.title,
    description: guide.summary,
    alternates: { canonical: `/guides/${guide.slug}` },
  };
}

export default async function GuidePage({ params }: GuidePageProps) {
  const { slug } = await params;
  const guideIndex = guides.findIndex((candidate) => candidate.slug === slug);
  const guide = guides[guideIndex];
  if (!guide) notFound();
  const loader = guideContentLoaders[guide.slug];

  const { default: Content } = await loader();
  const previous = guides[guideIndex - 1];
  const next = guides[guideIndex + 1];

  return (
    <article className="px-5 py-10 sm:px-8 sm:py-14">
      <div className="mx-auto max-w-3xl">
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium uppercase tracking-[0.07em] text-op-muted">
          <span>{guide.category}</span><span aria-hidden>·</span><span>{guide.audience}</span>
        </div>
        <h1 className="mt-3 max-w-3xl text-3xl font-medium leading-tight tracking-[-0.035em] text-op-text sm:text-4xl">{guide.title}</h1>
        <p className="mt-4 border-b border-op-border pb-8 text-[16px] leading-7 text-op-secondary">{guide.summary}</p>
        <div className="guide-content"><Content /></div>
        {guide.slug !== "faq" ? (
          <p className="mt-12 rounded-[12px] border border-op-border bg-op-surface px-4 py-3 text-sm leading-6 text-op-secondary">
            Still looking for an answer? Check the{" "}
            <Link href="/guides/faq" className="font-medium text-op-selected-fg underline underline-offset-4">
              Frequently Asked Questions
            </Link>
            .
          </p>
        ) : null}
        <nav aria-label="Adjacent guides" className="mt-10 grid gap-3 border-t border-op-border pt-6 sm:grid-cols-2">
          {previous ? <Link href={`/guides/${previous.slug}`} className="rounded-[10px] border border-op-border bg-op-surface p-4 text-sm hover:border-op-heat-20"><span className="block text-xs text-op-muted">Previous</span><span className="mt-1 block font-medium text-op-text">← {previous.title}</span></Link> : <span />}
          {next ? <Link href={`/guides/${next.slug}`} className="rounded-[10px] border border-op-border bg-op-surface p-4 text-right text-sm hover:border-op-heat-20"><span className="block text-xs text-op-muted">Next</span><span className="mt-1 block font-medium text-op-text">{next.title} →</span></Link> : null}
        </nav>
      </div>
    </article>
  );
}
