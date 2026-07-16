import { InteractiveStandingsSnapshot } from "./InteractiveStandingsSnapshot";
import {
  InteractiveConfidenceSnapshot,
  InteractiveSurvivorSnapshot,
} from "./InteractiveWeekBoardSnapshots";

export function MarketingShowcase() {
  return (
    <>
      <section className="relative px-4 pb-24 sm:px-6 sm:pb-32">
        <div
          className="op-grid-bg-soft pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,black_0%,black_64%,transparent_100%)]"
          aria-hidden
        />
        <div className="op-marketing-enter op-marketing-enter-delay-2 relative mx-auto max-w-[1040px]">
          <InteractiveSurvivorSnapshot />
        </div>
      </section>

      <section
        id="pool-types"
        className="scroll-mt-28 border-y border-op-border bg-op-surface px-5 py-20 sm:px-8 sm:py-28"
      >
        <div className="mx-auto max-w-[1040px]">
          <div className="max-w-xl">
            <p className="op-eyebrow text-op-heat">Pick your pool</p>
            <h2 className="mt-3 text-3xl font-medium leading-tight tracking-[-0.03em] text-op-text sm:text-5xl">
              Two ways to play. One simple home.
            </h2>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-2">
            <article className="rounded-[16px] border border-op-border bg-op-canvas p-6 sm:p-8">
              <span className="font-mono text-[10px] tracking-[0.08em] text-op-heat">
                01 / SURVIVOR
              </span>
              <h3 className="mt-8 text-2xl font-medium tracking-tight text-op-text">
                One team. One week.
              </h3>
              <p className="mt-3 max-w-sm text-[15px] leading-7 text-op-secondary">
                Pick one team each week. Win and move on. Use each team once.
              </p>
            </article>
            <article className="rounded-[16px] border border-op-border bg-op-canvas p-6 sm:p-8">
              <span className="font-mono text-[10px] tracking-[0.08em] text-op-heat">
                02 / CONFIDENCE
              </span>
              <h3 className="mt-8 text-2xl font-medium tracking-tight text-op-text">
                Every game. Ranked your way.
              </h3>
              <p className="mt-3 max-w-sm text-[15px] leading-7 text-op-secondary">
                Pick every winner. Rank each pick by how sure you are.
              </p>
            </article>
          </div>
        </div>
      </section>

      <section className="px-5 py-20 sm:px-8 sm:py-32">
        <div className="mx-auto max-w-[1040px]">
          <div className="mx-auto max-w-2xl text-center">
            <p className="op-eyebrow text-op-heat">Game day, handled</p>
            <h2 className="mt-3 text-3xl font-medium leading-tight tracking-[-0.03em] text-op-text sm:text-5xl">
              Everything that matters. Nothing that doesn’t.
            </h2>
          </div>
          <div className="mt-16 grid items-center gap-10 md:grid-cols-[0.72fr_1.28fr] md:gap-16">
            <div className="max-w-md">
              <span className="font-mono text-[10px] tracking-[0.08em] text-op-heat">
                MAKE YOUR PICKS
              </span>
              <h3 className="mt-3 text-2xl font-medium tracking-tight text-op-text sm:text-3xl">
                Sure about that one?
              </h3>
              <p className="mt-4 text-[15px] leading-7 text-op-secondary">
                Choose every winner, then put more points behind the picks you
                trust most. Only Pools keeps every value unique and every open
                game editable.
              </p>
            </div>
            <InteractiveConfidenceSnapshot />
          </div>
          <div className="mt-20 grid items-center gap-10 md:mt-28 md:grid-cols-[1.18fr_0.82fr] md:gap-16">
            <InteractiveStandingsSnapshot />
            <div className="max-w-md md:order-last">
              <span className="font-mono text-[10px] tracking-[0.08em] text-op-heat">
                SEE WHERE YOU STAND
              </span>
              <h3 className="mt-3 text-2xl font-medium tracking-tight text-op-text sm:text-3xl">
                Standings without the wait.
              </h3>
              <p className="mt-4 text-[15px] leading-7 text-op-secondary">
                Standings update as verified results arrive, so everyone sees
                the same score without waiting for someone to do the math.
              </p>
            </div>
          </div>
          <div className="mt-20 grid gap-px overflow-hidden rounded-[16px] border border-op-border bg-op-border sm:grid-cols-3 md:mt-28">
            {[
              {
                title: "Autosaves as you go",
                copy: "Make a pick and keep moving. Your latest saved choice is always clear.",
              },
              {
                title: "Locks at kickoff",
                copy: "Each choice closes when its game begins. Everything else stays open.",
              },
              {
                title: "Hidden until lock",
                copy: "Other participants cannot see your choice before it is locked.",
              },
            ].map((item) => (
              <article key={item.title} className="bg-op-surface p-6 sm:p-7">
                <span className="mb-5 block h-2 w-2 rounded-full bg-op-heat" />
                <h3 className="text-base font-medium text-op-text">
                  {item.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-op-secondary">
                  {item.copy}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
