import Link from "next/link";
import { Show, SignInButton, SignUpButton } from "@clerk/nextjs";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 px-6 py-20">
      <h1 className="text-4xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Only Pools
      </h1>
      <p className="max-w-md text-base leading-7 text-zinc-600 dark:text-zinc-400">
        Private NFL prediction competitions for verified adults.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Show when="signed-out">
          <SignInButton>
            <button
              type="button"
              className="rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
            >
              Sign in
            </button>
          </SignInButton>
          <SignUpButton>
            <button
              type="button"
              className="rounded-md border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-900 dark:border-zinc-700 dark:text-zinc-50"
            >
              Sign up
            </button>
          </SignUpButton>
        </Show>
        <Show when="signed-in">
          <Link
            href="/my-pools"
            className="rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            Go to My Pools
          </Link>
        </Show>
      </div>
    </main>
  );
}
