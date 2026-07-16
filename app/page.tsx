import type { Metadata } from "next";
import Link from "next/link";
import { Show, SignInButton, SignUpButton } from "@clerk/nextjs";
import { BrandMark } from "@/components/BrandMark";
import { MarketingShowcase } from "@/components/landing/MarketingShowcase";
import { POST_AUTH_HOME } from "@/lib/authRoutes";

export const metadata: Metadata = {
  title: "Only Pools — Simple NFL Survivor & Confidence Pools",
  description:
    "Create a private NFL Survivor or Confidence pool, invite your people, make picks, and follow the standings—all in one simple place.",
};

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
            Survivor &amp; Confidence
          </div>

          <h1 className="mt-7 max-w-[15ch] text-[clamp(2.75rem,5.5vw,4.25rem)] font-medium leading-[1] tracking-[-0.04em] text-op-text">
            NFL pools
            <span className="block text-op-heat">without the busywork.</span>
          </h1>

          <p className="mt-7 max-w-xl text-[16px] leading-7 text-op-secondary sm:mt-8 sm:text-lg sm:leading-8">
            Create a Survivor or Confidence pool, invite your people, make
            picks, and follow the standings—all in one simple place.
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
          <p className="op-eyebrow text-op-heat">Week one starts here</p>
          <h2 className="mx-auto mt-3 max-w-[12ch] text-4xl font-medium leading-[1.04] tracking-[-0.04em] text-op-text sm:text-6xl">
            Ready for kickoff?
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

function LandingHeader() {
  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-[60] px-3 pt-3 sm:px-5 sm:pt-4">
      <nav
        aria-label="Landing page"
        className="pointer-events-auto mx-auto flex h-14 max-w-[1040px] items-center gap-3 rounded-full border border-op-border-strong bg-op-surface/92 px-3 shadow-[0_12px_36px_-20px_rgba(38,38,38,0.35)] backdrop-blur-xl sm:px-4"
      >
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 text-[14px] font-medium tracking-tight text-op-text"
        >
          <BrandMark />
          Only Pools
        </Link>

        <div className="mx-auto hidden items-center gap-1 md:flex">
          <Link
            href="#pool-types"
            className="rounded-full px-3 py-2 text-[13px] text-op-secondary transition-colors hover:bg-op-control hover:text-op-text"
          >
            Pool Types
          </Link>
          <Link
            href="#how-it-works"
            className="rounded-full px-3 py-2 text-[13px] text-op-secondary transition-colors hover:bg-op-control hover:text-op-text"
          >
            How It Works
          </Link>
        </div>

        <div className="ml-auto hidden items-center gap-1.5 md:flex">
          <Show when="signed-out">
            <SignInButton forceRedirectUrl={POST_AUTH_HOME}>
              <button
                type="button"
                className="op-btn op-btn-ghost h-8 rounded-full px-3 text-[13px]"
              >
                Log in
              </button>
            </SignInButton>
          </Show>
          <Show when="signed-in">
            <Link
              href="/join"
              className="op-btn op-btn-ghost h-8 rounded-full px-3 text-[13px]"
            >
              Join a Pool
            </Link>
          </Show>
          <PrimaryPoolAction className="op-btn op-btn-primary h-8 rounded-full px-4 text-[13px]" />
        </div>

        <div className="ml-auto flex items-center gap-1.5 md:hidden">
          <PrimaryPoolAction className="op-btn op-btn-primary h-8 rounded-full px-3 text-[12px]" />
          <details className="group relative">
            <summary className="grid h-8 w-8 cursor-pointer list-none place-items-center rounded-full text-op-secondary transition-colors hover:bg-op-control hover:text-op-text [&::-webkit-details-marker]:hidden">
              <span className="sr-only">Open navigation</span>
              <MenuIcon />
            </summary>
            <div className="absolute right-0 top-[calc(100%+0.55rem)] w-40 overflow-hidden rounded-[12px] border border-op-border-strong bg-op-surface p-1.5 shadow-[0_18px_42px_-18px_rgba(38,38,38,0.35)]">
              <Show when="signed-out">
                <SignInButton forceRedirectUrl={POST_AUTH_HOME}>
                  <button
                    type="button"
                    className="flex w-full rounded-[8px] px-3 py-2 text-left text-[13px] text-op-secondary hover:bg-op-control hover:text-op-text"
                  >
                    Log in
                  </button>
                </SignInButton>
              </Show>
              <Link
                href="/join"
                className="block rounded-[8px] px-3 py-2 text-[13px] text-op-secondary hover:bg-op-control hover:text-op-text"
              >
                Join a Pool
              </Link>
              <Link
                href="#pool-types"
                className="block rounded-[8px] px-3 py-2 text-[13px] text-op-secondary hover:bg-op-control hover:text-op-text"
              >
                Pool Types
              </Link>
              <Link
                href="#how-it-works"
                className="block rounded-[8px] px-3 py-2 text-[13px] text-op-secondary hover:bg-op-control hover:text-op-text"
              >
                How It Works
              </Link>
            </div>
          </details>
        </div>
      </nav>
    </header>
  );
}

function PrimaryPoolAction({
  className,
  showArrow = false,
}: {
  className: string;
  showArrow?: boolean;
}) {
  return (
    <>
      <Show when="signed-out">
        <SignUpButton forceRedirectUrl={POST_AUTH_HOME}>
          <button type="button" className={className}>
            Start a Pool
            {showArrow ? <ArrowIcon /> : null}
          </button>
        </SignUpButton>
      </Show>
      <Show when="signed-in">
        <Link href={POST_AUTH_HOME} className={className}>
          My Pools
          {showArrow ? <ArrowIcon /> : null}
        </Link>
      </Show>
    </>
  );
}

function ArrowIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
      <path
        d="M2.5 6.5h8m-3-3 3 3-3 3"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
      <path
        d="M2.5 4.25h10M2.5 7.5h10M2.5 10.75h10"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
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
