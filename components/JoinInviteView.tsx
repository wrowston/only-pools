"use client";

import { SignInButton, useAuth } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/convex/_generated/api";

export function JoinInviteView({ token }: { token: string }) {
  const router = useRouter();
  const { isSignedIn } = useAuth();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const preview = useQuery(
    api.invites.previewInvite,
    isAuthenticated && token ? { token } : "skip",
  );
  const acceptInvite = useMutation(api.invites.acceptInvite);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onAccept() {
    setBusy(true);
    setError(null);
    try {
      const result = await acceptInvite({
        token,
        acknowledgedContactVisibility: acknowledged,
      });
      if (result.refusedReason === "admission_closed") {
        setError("Membership admission is closed for this Pool.");
        setBusy(false);
        return;
      }
      router.push(`/pools/${result.poolId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not join Pool");
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col gap-3 px-6 py-16">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Join a Pool
        </h1>
        <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          Open a Pool Invite link from a Pool Owner or Pool Admin to join.
        </p>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-6 py-16">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Join a Pool
        </h1>
        <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          Sign in with a verified email and phone to preview this Pool Invite.
          Opening the link alone does not enroll you.
        </p>
        <SignInButton mode="modal">
          <button
            type="button"
            className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            Sign in to continue
          </button>
        </SignInButton>
      </div>
    );
  }

  if (isLoading || preview === undefined) {
    return (
      <div className="px-6 py-16 text-sm text-zinc-600 dark:text-zinc-400">
        Loading invite…
      </div>
    );
  }

  if (preview === null) {
    return (
      <div className="mx-auto max-w-md px-6 py-16 text-sm text-zinc-600">
        Invite unavailable.
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Join {preview.poolName}
      </h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {preview.poolType === "survivor" ? "Survivor" : "Confidence"} · Start
        Week {preview.startWeek}
      </p>

      {preview.alreadyMember ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            You are already a member of this Pool.
          </p>
          <Link
            href={`/pools/${preview.poolId}`}
            className="text-sm font-medium underline"
          >
            Open Week Board
          </Link>
        </div>
      ) : preview.admissionClosed ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Membership admission is closed for this Pool.
        </p>
      ) : (
        <>
          <label className="flex items-start gap-3 text-sm leading-6 text-zinc-700 dark:text-zinc-300">
            <input
              type="checkbox"
              className="mt-1"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
            />
            <span>{preview.disclosureText}</span>
          </label>
          <button
            type="button"
            disabled={!acknowledged || busy}
            onClick={() => void onAccept()}
            className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {busy ? "Joining…" : "Accept invite"}
          </button>
        </>
      )}

      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
