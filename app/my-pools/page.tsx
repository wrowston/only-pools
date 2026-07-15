"use client";

import { useAuth, useUser } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CreatePoolForm } from "@/components/CreatePoolForm";
import { api } from "@/convex/_generated/api";
import {
  evaluateVerificationGate,
  type VerificationClaims,
} from "@/convex/lib/verificationGate";

function claimsFromClerkUser(
  user: {
    primaryEmailAddress?: { verification?: { status?: string | null } } | null;
    primaryPhoneNumber?: { verification?: { status?: string | null } } | null;
    publicMetadata?: Record<string, unknown>;
    unsafeMetadata?: Record<string, unknown>;
  } | null | undefined,
): VerificationClaims {
  const ageConfirmed =
    user?.publicMetadata?.ageConfirmed === true ||
    user?.unsafeMetadata?.ageConfirmed === true;

  return {
    emailVerified:
      user?.primaryEmailAddress?.verification?.status === "verified",
    phoneVerified:
      user?.primaryPhoneNumber?.verification?.status === "verified",
    ageConfirmed,
  };
}

/**
 * Age confirmation gate.
 *
 * Clerk Dashboard options (pick one):
 * 1. Custom sign-up field that writes `publicMetadata.ageConfirmed`, OR
 * 2. This post-auth gate writing `unsafeMetadata.ageConfirmed` (MVP default).
 *
 * Also enable Email + Phone verification in Clerk (Identifiers & authentication).
 */
function AgeConfirmationGate({
  onConfirmed,
}: {
  onConfirmed: () => void;
}) {
  const { user } = useUser();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const confirmMyAge = useMutation(api.participants.confirmMyAge);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmAge() {
    if (!user || !isAuthenticated) return;
    setBusy(true);
    setError(null);
    try {
      await user.update({
        unsafeMetadata: {
          ...user.unsafeMetadata,
          ageConfirmed: true,
        },
      });
      await confirmMyAge({});
      onConfirmed();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save confirmation");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Confirm you are 18 or older
      </h1>
      <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
        Only Pools is for adults. Confirm your age to continue to My Pools.
      </p>
      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        disabled={busy || isLoading || !isAuthenticated}
        onClick={() => void confirmAge()}
        className="rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {busy || isLoading
          ? "Saving…"
          : "I confirm I am 18 or older"}
      </button>
    </div>
  );
}

function VerificationIncomplete({ missing }: { missing: string[] }) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Finish verification
      </h1>
      <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
        Sign-in requires a verified email, a verified phone number, and age
        confirmation before you can open Pool surfaces.
      </p>
      <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-700 dark:text-zinc-300">
        {missing.includes("email") ? <li>Verify your email address</li> : null}
        {missing.includes("phone") ? <li>Verify your phone number</li> : null}
        {missing.includes("age") ? (
          <li>Confirm you are 18 or older</li>
        ) : null}
      </ul>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Use your account menu to manage email and phone, then refresh this page.
      </p>
    </div>
  );
}

function MyPoolsHome() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const ensureMyParticipant = useMutation(api.participants.ensureMyParticipant);
  const myPools = useQuery(
    api.participants.myPools,
    isAuthenticated ? {} : "skip",
  );
  const [ensureError, setEnsureError] = useState<string | null>(null);
  const [ensured, setEnsured] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || ensured) return;
    let cancelled = false;
    void (async () => {
      try {
        await ensureMyParticipant({});
        if (!cancelled) {
          setEnsured(true);
          setEnsureError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setEnsureError(
            e instanceof Error ? e.message : "Could not establish Participant",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, ensureMyParticipant, ensured]);

  if (isLoading || (isAuthenticated && myPools === undefined && !ensureError)) {
    return (
      <div className="px-6 py-16 text-sm text-zinc-600 dark:text-zinc-400">
        Loading My Pools…
      </div>
    );
  }

  if (ensureError) {
    return (
      <div className="mx-auto max-w-md px-6 py-16">
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {ensureError}
        </p>
      </div>
    );
  }

  if (!myPools) {
    return null;
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          My Pools
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Your Pool memberships and entry points to create or join.
        </p>
      </header>

      <section aria-labelledby="memberships-heading" className="flex flex-col gap-3">
        <h2
          id="memberships-heading"
          className="text-sm font-medium uppercase tracking-wide text-zinc-500"
        >
          Memberships
        </h2>
        {myPools.memberships.length === 0 ? (
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            You are not in any Pools yet.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {myPools.memberships.map((m) => (
              <li key={m.poolId} className="py-3">
                <Link
                  href={`/pools/${m.poolId}`}
                  className="flex flex-col gap-0.5 text-sm hover:opacity-80"
                >
                  <span className="font-medium text-zinc-900 dark:text-zinc-50">
                    {m.name}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {m.role === "owner" ? "Owner" : m.role} · Week {m.startWeek}{" "}
                    · Open Week Board
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {showCreate && myPools.createPoolEnabled ? (
        <CreatePoolForm onCancel={() => setShowCreate(false)} />
      ) : (
        <section
          aria-labelledby="actions-heading"
          className="flex flex-wrap items-center gap-3"
        >
          <h2 id="actions-heading" className="sr-only">
            Create or join
          </h2>
          <button
            type="button"
            disabled={!myPools.createPoolEnabled}
            onClick={() => setShowCreate(true)}
            title={
              myPools.createPoolEnabled
                ? "Create a Pool"
                : "Create Pool is disabled until an Available Season exists"
            }
            className="rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
          >
            Create Pool
          </button>
          <Link
            href="/join"
            className="rounded-md border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-900 dark:border-zinc-700 dark:text-zinc-50"
          >
            Join a Pool
          </Link>
          {!myPools.createPoolEnabled ? (
            <p className="basis-full text-xs text-zinc-500">
              Create Pool stays disabled until Season Bootstrap finishes and an
              Available Season exists.
            </p>
          ) : null}
        </section>
      )}
    </div>
  );
}

export default function MyPoolsPage() {
  const { isLoaded, isSignedIn } = useAuth();
  const { user, isLoaded: userLoaded } = useUser();
  const [ageBump, setAgeBump] = useState(0);

  const claims = useMemo(
    () => claimsFromClerkUser(user),
    // ageBump forces re-read after unsafeMetadata write
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, ageBump],
  );

  const decision = useMemo(
    () =>
      evaluateVerificationGate(claims, {
        // Client gate treats each page load after auth as establishing access;
        // mid-session lapse continuity is enforced on the Convex path.
        previouslyEstablished: false,
      }),
    [claims],
  );

  if (!isLoaded || !userLoaded) {
    return (
      <div className="px-6 py-16 text-sm text-zinc-600 dark:text-zinc-400">
        Loading…
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="mx-auto max-w-md px-6 py-16 text-sm text-zinc-700 dark:text-zinc-300">
        Sign in to open My Pools.{" "}
        <Link href="/sign-in" className="underline">
          Sign in
        </Link>
      </div>
    );
  }

  if (decision.action === "refuse") {
    if (decision.missing.length === 1 && decision.missing[0] === "age") {
      return (
        <AgeConfirmationGate onConfirmed={() => setAgeBump((n) => n + 1)} />
      );
    }
    return <VerificationIncomplete missing={decision.missing} />;
  }

  return <MyPoolsHome />;
}
