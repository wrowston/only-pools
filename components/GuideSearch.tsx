"use client";

import Link from "next/link";
import { useState } from "react";
import { searchGuides } from "@/lib/guides";

export function GuideSearch() {
  const [query, setQuery] = useState("");
  const results = query.trim() ? searchGuides(query) : [];

  return (
    <div className="relative w-full max-w-xl">
      <label htmlFor="guide-search" className="sr-only">Search guides</label>
      <div className="relative">
        <svg aria-hidden viewBox="0 0 20 20" fill="none" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-op-muted">
          <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="m12.5 12.5 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <input
          id="guide-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search picks, invites, locks, privacy…"
          className="h-11 w-full rounded-[10px] border border-op-border-strong bg-op-surface pl-10 pr-4 text-sm text-op-text shadow-[0_8px_28px_-22px_rgba(38,38,38,0.45)] outline-none placeholder:text-op-muted focus:border-op-heat-40 focus:ring-4 focus:ring-op-heat-8"
        />
      </div>
      {query.trim() ? (
        <div className="absolute inset-x-0 top-[calc(100%+0.5rem)] z-40 overflow-hidden rounded-[12px] border border-op-border-strong bg-op-surface p-1.5 shadow-[0_24px_56px_-28px_rgba(38,38,38,0.5)]">
          {results.length > 0 ? (
            <ul aria-label="Guide search results" className="max-h-80 overflow-y-auto">
              {results.map((guide) => (
                <li key={guide.slug}>
                  <Link href={`/guides/${guide.slug}`} onClick={() => setQuery("")} className="block rounded-[8px] px-3 py-2.5 hover:bg-op-control">
                    <span className="block text-sm font-medium text-op-text">{guide.title}</span>
                    <span className="mt-0.5 block text-xs leading-5 text-op-muted">{guide.category} · {guide.summary}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-4 text-sm text-op-muted">No guides match “{query}”. Try a shorter phrase.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
