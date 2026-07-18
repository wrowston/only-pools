import type { Metadata } from "next";
import nextDynamic from "next/dynamic";
import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";
import {
  LandingHeader,
  PrimaryPoolAction,
} from "@/components/landing/LandingAuthChrome";

/** Prerender marketing HTML; Clerk chrome hydrates on the client. */
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Only Pools — A Simple Splash Sports Alternative",
  description:
    "Replace Splash Sports with a focused home for private NFL Survivor and Confidence pools. Create a pool, invite your people, make picks, and follow the standings.",
};

const MarketingShowcase = nextDynamic(
  () =>
    import("@/components/landing/MarketingShowcase").then((m) => ({
      default: m.MarketingShowcase,
    })),
  {
    loading: () => (
      <div
        className="min-h-[28rem] bg-op-canvas"
        aria-hidden
        data-showcase-placeholder
      />
    ),
  },
);

export default function Home() {
  return (
    <main className="op-landing relative isolate overflow-clip bg-op-canvas">
      <LandingHeader />

      <section className="relative px-5 pb-10 pt-32 text-center sm:px-8 sm:pb-14 sm:pt-36">
        <div
          className="op-grid-bg-soft pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,black_0%,black_76%,transparent_100%)]"
          aria-hidden
        />
        <span
          className="pointer-events-none absolute left-[7%] top-40 hidden text-op-heat/55 sm:block"
          aria-hidden
        >
          <LandingStar />
        </span>
        <span
          className="pointer-events-none absolute right-[8%] top-60 hidden rotate-45 text-op-heat/35 sm:block"
          aria-hidden
        >
          <LandingStar />
        </span>

        <div className="op-marketing-enter relative mx-auto flex max-w-[900px] flex-col items-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-op-border-strong bg-op-surface/85 px-3 py-1.5 text-[11px] font-medium text-op-secondary backdrop-blur-sm sm:text-xs">
            <span className="h-1.5 w-1.5 rounded-full bg-op-heat" />
            Built to replace Splash Sports
          </div>

          <h1 className="mt-7 max-w-[15ch] text-[clamp(2.75rem,5.5vw,4.25rem)] font-medium leading-[1] tracking-[-0.04em] text-op-text">
            NFL pools
            <span className="block text-op-heat">made simple.</span>
          </h1>

          <p className="mt-7 max-w-xl text-[16px] leading-7 text-op-secondary sm:mt-8 sm:text-lg sm:leading-8">
            A focused home for Survivor and Confidence pools. Invite your
            people, make picks, and follow the standings—all in one place.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <PrimaryPoolAction
              className="op-btn op-btn-primary h-10 min-w-[9.5rem] rounded-[9px] px-5"
              showArrow
            />
            <Link
              href="/join"
              className="op-btn op-btn-secondary h-10 min-w-[9.5rem] rounded-[9px] px-5"
            >
              Join a Pool
            </Link>
          </div>

          <div className="mt-7 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 font-mono text-[9px] tracking-[0.04em] text-op-muted sm:text-[10px]">
            <span>PRIVATE POOLS</span>
            <span className="h-1 w-1 rounded-full bg-op-border-strong" />
            <span>AUTOSAVED PICKS</span>
            <span className="h-1 w-1 rounded-full bg-op-border-strong" />
            <span>LIVE STANDINGS</span>
          </div>
        </div>
      </section>

      <MarketingShowcase />

      <section
        id="how-it-works"
        className="scroll-mt-28 border-t border-op-border bg-op-surface px-5 py-20 sm:px-8 sm:py-28"
      >
        <div className="mx-auto max-w-[1040px]">
          <div className="max-w-xl">
            <p className="op-eyebrow text-op-heat">How it works</p>
            <h2 className="mt-3 text-3xl font-medium leading-tight tracking-[-0.03em] text-op-text sm:text-5xl">
              Your pool. Your people.
            </h2>
            <p className="mt-5 text-[15px] leading-7 text-op-secondary sm:text-base">
              From first invite to final standings, everything stays in one
              place.
            </p>
          </div>

          <ol className="mt-12 grid gap-4 md:grid-cols-3">
            {[
              {
                number: "01",
                title: "Create your pool",
                copy: "Choose Survivor or Confidence, name your pool, and set the lock style.",
              },
              {
                number: "02",
                title: "Share one invite",
                copy: "Send your private invite to the people you want in the pool.",
              },
              {
                number: "03",
                title: "Make your picks",
                copy: "Pick each week and let Only Pools handle locks, results, and standings.",
              },
            ].map((step) => (
              <li
                key={step.number}
                className="rounded-[16px] border border-op-border bg-op-canvas p-6 sm:p-7"
              >
                <span className="inline-flex rounded-full border border-op-heat-20 bg-op-heat-8 px-2.5 py-1 font-mono text-[10px] tracking-[0.08em] text-op-selected-fg">
                  STEP {step.number}
                </span>
                <div className="mt-12">
                  <h3 className="text-lg font-medium text-op-text">
                    {step.title}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-op-secondary">
                    {step.copy}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="relative px-5 py-20 sm:px-8 sm:py-28">
        <div
          className="op-grid-bg-soft pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,transparent_0%,black_24%,black_76%,transparent_100%)]"
          aria-hidden
        />
        <div className="relative mx-auto max-w-[1040px] overflow-hidden rounded-[20px] border border-op-border-strong bg-op-surface px-6 py-16 text-center shadow-[0_30px_80px_-55px_rgba(38,38,38,0.4)] sm:px-12 sm:py-20">
          <p className="op-eyebrow text-op-heat">Your next pool starts here</p>
          <h2 className="mx-auto mt-3 max-w-[12ch] text-4xl font-medium leading-[1.04] tracking-[-0.04em] text-op-text sm:text-6xl">
            Ready to replace Splash Sports?
          </h2>
          <p className="mx-auto mt-5 max-w-lg text-[15px] leading-7 text-op-secondary sm:text-base">
            Start a private NFL pool in minutes, or join your people with an
            invite.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <PrimaryPoolAction
              className="op-btn op-btn-primary h-10 min-w-[9.5rem] px-5"
              showArrow
            />
            <Link
              href="/join"
              className="op-btn op-btn-secondary h-10 min-w-[9.5rem] px-5"
            >
              Join a Pool
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-op-border bg-op-surface px-5 py-8 sm:px-8">
        <div className="mx-auto flex max-w-[1040px] flex-col gap-4 text-sm sm:flex-row sm:items-center sm:justify-between">
          <Link
            href="/"
            className="flex items-center gap-2 font-medium tracking-tight text-op-text"
          >
            <BrandMark />
            Only Pools
          </Link>
          <p className="text-xs text-op-muted">
            Private NFL prediction pools for participants 18+.
          </p>
        </div>
      </footer>
    </main>
  );
}

function LandingStar() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden
    >
      <path d="M10 0c.23 4 1.7 7 4.4 9C11.7 11 10.23 14 10 18c-.23-4-1.7-7-4.4-9C8.3 7 9.77 4 10 0Z" />
    </svg>
  );
}
