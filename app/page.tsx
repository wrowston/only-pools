import Link from "next/link";
import { Show, SignInButton, SignUpButton } from "@clerk/nextjs";
import { BrandMark } from "@/components/BrandMark";

export default function Home() {
  return (
    <main className="op-grid-bg relative flex flex-1 flex-col overflow-hidden">
      <div className="relative z-20 px-3 pt-3 sm:px-5">
        <Link
          href="/my-pools"
          className="mx-auto flex max-w-[920px] items-center justify-center gap-2 rounded-[10px] bg-op-heat px-4 py-2.5 text-center text-[13px] font-medium leading-snug text-white"
        >
          <span>
            Week Board locks at kickoff — picks autosave, standings stay live.{" "}
            <span className="underline underline-offset-2">Open My Pools →</span>
          </span>
        </Link>
      </div>

      <div
        className="pointer-events-none absolute inset-0 overflow-hidden"
        aria-hidden
      >
        <span className="absolute left-[11%] top-[32%] text-op-heat">
          <StarPlus />
        </span>
        <span className="absolute right-[12%] top-[36%] text-op-heat">
          <StarPlus />
        </span>
        <span className="absolute bottom-[24%] left-[20%] text-op-heat/45">
          <StarPlus />
        </span>
        <span className="absolute right-[7%] top-[22%] font-mono text-[10px] tracking-wider text-op-muted/55">
          [ LIVE ]
        </span>
        <span className="absolute bottom-[28%] left-[5%] font-mono text-[10px] tracking-wider text-op-muted/55">
          [ WEEK ]
        </span>
        <span className="absolute left-[6%] top-[54%] font-mono text-[10px] tracking-wider text-op-muted/40">
          [ 200 OK ]
        </span>
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-7 px-6 pb-24 pt-12 text-center sm:gap-8 sm:pt-16">
        <div className="inline-flex items-center gap-2 rounded-[10px] border border-op-border bg-op-surface px-3 py-1.5 text-[13px] font-medium text-op-secondary">
          Private NFL pools · verified adults
          <span className="grid h-5 w-5 place-items-center rounded-full bg-op-text text-white">
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              aria-hidden
            >
              <path
                d="M2 5h6M5.5 2.5 8 5 5.5 7.5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </div>

        <h1 className="max-w-[16ch] text-[clamp(2.75rem,8vw,3.75rem)] font-medium leading-[1.06] tracking-[-0.03em] text-op-text">
          Run your pool with{" "}
          <span className="text-op-heat">clean game-day data</span>
        </h1>

        <p className="max-w-md text-[15px] leading-7 text-op-secondary sm:text-base">
          The complete toolkit for survivor and confidence — locked picks, live
          standings, and operator-grade trust.{" "}
          <span className="font-medium text-op-text">
            Built for serious leagues.
          </span>
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
          <Show when="signed-out">
            <SignUpButton>
              <button
                type="button"
                className="op-btn op-btn-primary h-9 min-w-[9rem] px-4"
              >
                Start for free
              </button>
            </SignUpButton>
            <SignInButton>
              <button
                type="button"
                className="op-btn op-btn-secondary h-9 min-w-[9rem] px-4"
              >
                Log in
              </button>
            </SignInButton>
          </Show>
          <Show when="signed-in">
            <Link
              href="/my-pools"
              className="op-btn op-btn-primary h-9 min-w-[9rem] px-4"
            >
              Go to My Pools
            </Link>
            <Link
              href="/join"
              className="op-btn op-btn-secondary h-9 min-w-[9rem] px-4"
            >
              Join a Pool
            </Link>
          </Show>
        </div>

        <div className="mt-10 flex items-center gap-2 text-[13px] text-op-muted">
          <BrandMark />
          <span>Only Pools · week board · standings · invites</span>
        </div>
      </div>
    </main>
  );
}

/** Firecrawl-style four-pointed star at grid intersections */
function StarPlus() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="currentColor"
      aria-hidden
    >
      <path d="M9 0c.2 3.2 1.4 5.6 3.6 7.2C10.4 8.8 9.2 11.2 9 14.4 8.8 11.2 7.6 8.8 5.4 7.2 7.6 5.6 8.8 3.2 9 0Z" />
    </svg>
  );
}
