import Link from "next/link";
import type { AnchorHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import type { MDXComponents } from "mdx/types";

function headingId(children: ReactNode): string {
  return String(children)
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function GuideLink({ href = "", children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  if (href.startsWith("/")) {
    return (
      <Link href={href} className="font-medium text-op-selected-fg underline decoration-op-heat-20 underline-offset-4 hover:decoration-op-heat" {...props}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} className="font-medium text-op-selected-fg underline decoration-op-heat-20 underline-offset-4 hover:decoration-op-heat" {...props}>
      {children}
    </a>
  );
}

export function GuideCallout({ children }: { children: ReactNode }) {
  return (
    <aside className="my-7 rounded-[12px] border border-op-heat-20 bg-op-heat-4 px-4 py-3 text-sm leading-6 text-op-secondary">
      {children}
    </aside>
  );
}

const components = {
  h2: ({ children, ...props }: HTMLAttributes<HTMLHeadingElement>) => (
    <h2 id={headingId(children)} className="mb-3 mt-10 scroll-mt-24 text-2xl font-medium tracking-[-0.025em] text-op-text" {...props}>
      {children}
    </h2>
  ),
  h3: ({ children, ...props }: HTMLAttributes<HTMLHeadingElement>) => (
    <h3 id={headingId(children)} className="mb-2 mt-7 scroll-mt-24 text-lg font-medium text-op-text" {...props}>
      {children}
    </h3>
  ),
  p: ({ children, ...props }: HTMLAttributes<HTMLParagraphElement>) => (
    <p className="my-4 text-[15px] leading-7 text-op-secondary" {...props}>{children}</p>
  ),
  ol: ({ children, ...props }: HTMLAttributes<HTMLOListElement>) => (
    <ol className="my-5 ml-5 list-decimal space-y-2 text-[15px] leading-7 text-op-secondary marker:font-medium marker:text-op-text" {...props}>{children}</ol>
  ),
  ul: ({ children, ...props }: HTMLAttributes<HTMLUListElement>) => (
    <ul className="my-5 ml-5 list-disc space-y-2 text-[15px] leading-7 text-op-secondary marker:text-op-heat" {...props}>{children}</ul>
  ),
  strong: ({ children, ...props }: HTMLAttributes<HTMLElement>) => (
    <strong className="font-medium text-op-text" {...props}>{children}</strong>
  ),
  a: GuideLink,
  hr: (props: HTMLAttributes<HTMLHRElement>) => <hr className="my-10 border-op-border" {...props} />,
  GuideCallout,
} satisfies MDXComponents;

export function useMDXComponents(): MDXComponents {
  return components;
}
