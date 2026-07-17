"use client";

import posthog from "posthog-js";
import { SignInButton, useAuth } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { convexErrorMessage } from "@/lib/convexErrorMessage";
import { EmptyState } from "./EmptyState";

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
      posthog.capture("invite_accepted", { pool_id: result.poolId });
      router.push(`/pools/${result.poolId}`);
    } catch (e) {
      setError(convexErrorMessage(e, "Could not join Pool"));
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <EmptyState
        title="Join a Pool"
        description="Open a Pool Invite link from a Pool Owner or Pool Admin to join. Opening a link alone does not enroll you."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Link href="/my-pools" className="rounded-md border border-op-border-strong px-4 py-2.5 text-sm font-medium text-op-text">Back to My Pools</Link>
            <Link href="/guides/invites-and-joining" className="rounded-md px-4 py-2.5 text-sm font-medium text-op-selected-fg underline underline-offset-4">How joining works</Link>
          </div>
        }
      />
    );
  }

  if (!isSignedIn) {
    return (
      <EmptyState
        title="Join a Pool"
        description="Sign in with a verified email and phone to preview this Pool Invite. Opening the link alone does not enroll you."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <SignInButton mode="modal"><button type="button" className="op-btn op-btn-primary">Sign in to continue</button></SignInButton>
            <Link href="/guides/invites-and-joining" className="op-btn op-btn-ghost">Joining guide</Link>
          </div>
        }
      />
    );
  }

  if (isLoading || preview === undefined) {
    return (
      <EmptyState title="Loading invite" description="Checking this invite…" />
    );
  }

  if (preview === null) {
    return (
      <EmptyState
        title="Invite unavailable"
        description="This invite link is invalid, expired, or no longer active."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Link href="/my-pools" className="rounded-md border border-op-border-strong px-4 py-2.5 text-sm font-medium text-op-text">Back to My Pools</Link>
            <Link href="/guides/invites-and-joining" className="rounded-md px-4 py-2.5 text-sm font-medium text-op-selected-fg underline underline-offset-4">Troubleshoot invites</Link>
          </div>
        }
      />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight text-op-text">
        Join {preview.poolName}
      </h1>
      <p className="text-sm text-op-secondary">
        {preview.poolType === "survivor" ? "Survivor" : "Confidence"} · Start
        Week {preview.startWeek}
      </p>

      {preview.alreadyMember ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-op-secondary">
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
        <p className="text-sm text-op-secondary">
          Membership admission is closed for this Pool.
        </p>
      ) : (
        <>
          <label className="flex items-start gap-3 text-sm leading-6 text-op-text">
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
            className="op-btn op-btn-primary"
          >
            {busy ? "Joining…" : "Accept invite"}
          </button>
        </>
      )}

      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}
      <Link href="/guides/invites-and-joining" className="text-sm font-medium text-op-selected-fg underline underline-offset-4">
        Read the joining guide
      </Link>
    </div>
  );
}
