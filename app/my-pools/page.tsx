"use client";

import { useAuth, useUser } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { CreatePoolForm } from "@/components/CreatePoolForm";
import { EmptyState } from "@/components/EmptyState";
import { api } from "@/convex/_generated/api";
import {
  evaluateVerificationGate,
  type VerificationClaims,
} from "@/convex/lib/verificationGate";

function claimsFromClerkUser(
  user: {
    primaryEmailAddress?: { verification?: { status?: string | null } } | null;
    primaryPhoneNumber?: { verification?: { status?: string | null } } | null;
  } | null | undefined,
): VerificationClaims {
  return {
    emailVerified:
      user?.primaryEmailAddress?.verification?.status === "verified",
    phoneVerified:
      user?.primaryPhoneNumber?.verification?.status === "verified",
  };
}

function VerificationIncomplete({ missing }: { missing: string[] }) {
  return (
    <EmptyState
      title="Finish verification"
      description="Sign-in requires a verified email and a verified phone number before you can open Pool surfaces."
    >
      <ul className="list-disc space-y-1 pl-5 text-sm text-op-text">
        {missing.includes("email") ? <li>Verify your email address</li> : null}
        {missing.includes("phone") ? <li>Verify your phone number</li> : null}
      </ul>
      <p className="text-sm text-op-secondary">
        Use your account menu to manage email and phone, then refresh this page.
      </p>
    </EmptyState>
  );
}

function MyPoolsHome() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const searchParams = useSearchParams();
  const includeArchived = searchParams.get("archived") === "1";
  const ensureMyParticipant = useMutation(api.participants.ensureMyParticipant);
  const myPools = useQuery(
    api.participants.myPools,
    isAuthenticated ? { includeArchived } : "skip",
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
      <EmptyState
        title="Loading My Pools"
        description="Connecting your account…"
      />
    );
  }

  if (!isAuthenticated) {
    return (
      <EmptyState
        title="Still connecting"
        description="You are signed in with Clerk, but Convex has not accepted the session yet. Sign out completely, sign back in, then open My Pools again (an old session token will keep failing)."
        action={
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-md bg-op-ink px-4 py-2.5 text-sm font-medium text-white hover:bg-op-ink-hover"
          >
            Refresh
          </button>
        }
      />
    );
  }

  if (ensureError) {
    return (
      <EmptyState title="Could not open My Pools" description={ensureError} />
    );
  }

  if (!myPools) {
    return (
      <EmptyState
        title="My Pools unavailable"
        description="Your memberships could not be loaded. Refresh and try again."
        action={
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-md bg-op-ink px-4 py-2.5 text-sm font-medium text-white hover:bg-op-ink-hover"
          >
            Refresh
          </button>
        }
      />
    );
  }

  if (myPools.authError) {
    const missing: string[] = [];
    if (myPools.authError.includes("email")) missing.push("email");
    if (myPools.authError.includes("phone")) missing.push("phone");
    return (
      <VerificationIncomplete
        missing={missing.length > 0 ? missing : ["email", "phone"]}
      />
    );
  }

  const createJoinActions = (
    <>
      <button
        type="button"
        disabled={!myPools.createPoolEnabled}
        onClick={() => setShowCreate(true)}
        title={
          myPools.createPoolEnabled
            ? "Create a Pool"
            : "Create Pool is disabled until an Available Season exists"
        }
        className="rounded-md bg-op-ink px-4 py-2.5 text-sm font-medium text-white hover:bg-op-ink-hover disabled:cursor-not-allowed disabled:opacity-40"
      >
        Create Pool
      </button>
      <Link
        href="/join"
        className="rounded-md border border-op-border-strong px-4 py-2.5 text-sm font-medium text-op-text"
      >
        Join a Pool
      </Link>
    </>
  );

  if (myPools.memberships.length === 0) {
    if (showCreate && myPools.createPoolEnabled) {
      return (
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 py-12">
          <header className="flex flex-col gap-2">
            <h1 className="text-3xl font-semibold tracking-tight text-op-text">
              My Pools
            </h1>
          </header>
          <CreatePoolForm onCancel={() => setShowCreate(false)} />
        </div>
      );
    }

    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 py-12">
        <header className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight text-op-text">
            My Pools
          </h1>
        </header>
        <EmptyState
          title="No Pools yet"
          description={
            myPools.createPoolEnabled
              ? "Create a Pool for the Available Season, or join one with an invite link."
              : "You are not in any Pools yet. Create Pool stays disabled until Season Bootstrap finishes and an Available Season exists. You can still join with an invite link."
          }
          action={createJoinActions}
        >
          {myPools.archivedCount > 0 ? (
            <p className="text-xs text-op-muted">
              {myPools.archivedCount} archived{" "}
              {myPools.archivedCount === 1 ? "Pool is" : "Pools are"} hidden.{" "}
              <Link
                href="/my-pools?archived=1"
                className="underline hover:text-op-text"
              >
                Show archived
              </Link>
            </p>
          ) : null}
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight text-op-text">
          My Pools
        </h1>
        <p className="text-sm text-op-secondary">
          {includeArchived
            ? "Including archived Pools in this list."
            : "Your Pool memberships and entry points to create or join."}
        </p>
        {includeArchived ? (
          <Link
            href="/my-pools"
            className="text-xs text-op-muted underline hover:text-op-text"
          >
            Hide archived
          </Link>
        ) : null}
      </header>

      <section aria-labelledby="memberships-heading" className="flex flex-col gap-3">
        <h2
          id="memberships-heading"
          className="text-sm font-medium uppercase tracking-wide text-op-muted"
        >
          Memberships
        </h2>
        <ul className="divide-y divide-op-border rounded-xl border border-op-border bg-op-surface px-4">
          {myPools.memberships.map((m) => (
            <li key={m.poolId} className="py-3">
              <Link
                href={`/pools/${m.poolId}`}
                className="flex flex-col gap-0.5 text-sm hover:opacity-80"
              >
                <span className="font-medium text-op-text">{m.name}</span>
                <span className="text-xs text-op-muted">
                  {m.role === "owner" ? "Owner" : m.role}
                  {m.archived ? " · Archived" : ""} · Week {m.startWeek} · Open
                  Week Board
                </span>
              </Link>
            </li>
          ))}
        </ul>
        {myPools.archivedCount > 0 ? (
          <p className="text-xs text-op-muted">
            {myPools.archivedCount} archived{" "}
            {myPools.archivedCount === 1 ? "Pool is" : "Pools are"} hidden from
            this list.{" "}
            <Link
              href="/my-pools?archived=1"
              className="underline hover:text-op-text"
            >
              Show archived
            </Link>
          </p>
        ) : null}
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
          {createJoinActions}
          {!myPools.createPoolEnabled ? (
            <p className="basis-full text-xs text-op-muted">
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
  return (
    <Suspense
      fallback={
        <div className="px-6 py-16 text-sm text-zinc-600 dark:text-zinc-400">
          Loading My Pools…
        </div>
      }
    >
      <MyPoolsGate />
    </Suspense>
  );
}

function MyPoolsGate() {
  const { isLoaded, isSignedIn } = useAuth();
  const { user, isLoaded: userLoaded } = useUser();

  const claims = useMemo(() => claimsFromClerkUser(user), [user]);

  const decision = useMemo(
    () =>
      evaluateVerificationGate(claims, {
        previouslyEstablished: false,
      }),
    [claims],
  );

  if (!isLoaded || !userLoaded) {
    return (
      <EmptyState title="Loading…" description="Checking your session…" />
    );
  }

  if (!isSignedIn) {
    return (
      <EmptyState
        title="Sign in to open My Pools"
        description="Your Pool memberships live here after you sign in."
        action={
          <Link
            href="/sign-in"
            className="rounded-md bg-op-ink px-4 py-2.5 text-sm font-medium text-white hover:bg-op-ink-hover"
          >
            Sign in
          </Link>
        }
      />
    );
  }

  if (decision.action === "refuse") {
    return <VerificationIncomplete missing={decision.missing} />;
  }

  return <MyPoolsHome />;
}
