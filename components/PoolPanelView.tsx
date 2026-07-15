"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

function absoluteInviteUrl(path: string): string {
  if (typeof window === "undefined") return path;
  return `${window.location.origin}${path}`;
}

export function PoolPanelView({ poolId }: { poolId: Id<"pools"> }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const members = useQuery(
    api.invites.listPoolMembers,
    isAuthenticated ? { poolId } : "skip",
  );
  const inviteStatus = useQuery(
    api.invites.getInviteStatus,
    isAuthenticated && members?.canManageInvites ? { poolId } : "skip",
  );
  const confirmStepUp = useMutation(api.invites.confirmStepUp);
  const createOrRetrieve = useMutation(api.invites.createOrRetrieveInvite);
  const rotateInvite = useMutation(api.invites.rotateInvite);

  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [expiresAtMs, setExpiresAtMs] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function withStepUpRetrieve() {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      await confirmStepUp({});
      const result = await createOrRetrieve({ poolId });
      setInviteUrl(absoluteInviteUrl(result.url));
      setExpiresAtMs(result.expiresAtMs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not retrieve invite");
    } finally {
      setBusy(false);
    }
  }

  async function withStepUpRotate() {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      await confirmStepUp({});
      const result = await rotateInvite({ poolId });
      setInviteUrl(absoluteInviteUrl(result.url));
      setExpiresAtMs(result.expiresAtMs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not rotate invite");
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
    } catch {
      setError("Could not copy link");
    }
  }

  if (isLoading || (isAuthenticated && members === undefined)) {
    return (
      <div className="px-6 py-16 text-sm text-zinc-600 dark:text-zinc-400">
        Loading Pool…
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="mx-auto max-w-md px-6 py-16 text-sm">
        <Link href="/sign-in" className="underline">
          Sign in
        </Link>{" "}
        to open this Pool.
      </div>
    );
  }

  if (!members) {
    return null;
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 py-10">
      <div className="flex flex-col gap-3">
        <Link
          href={`/pools/${poolId}`}
          className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          ← Week Board
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {members.poolName}
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Members and Pool Invite
        </p>
      </div>

      {members.canManageInvites ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            Pool Invite
          </h2>
          {members.admissionClosed ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Membership admission is closed for this Pool.
            </p>
          ) : (
            <>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Retrieve or rotate the reusable invite after Step-up Verification.
                {inviteStatus?.hasActiveInvite
                  ? " An active invite already exists."
                  : " No active invite yet."}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void withStepUpRetrieve()}
                  className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
                >
                  {busy ? "Working…" : "Create / retrieve invite"}
                </button>
                <button
                  type="button"
                  disabled={busy || !inviteStatus?.hasActiveInvite}
                  onClick={() => void withStepUpRotate()}
                  className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-800 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200"
                >
                  Rotate invite
                </button>
              </div>
              {inviteUrl ? (
                <div className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
                  <code className="break-all text-xs text-zinc-800 dark:text-zinc-200">
                    {inviteUrl}
                  </code>
                  {expiresAtMs ? (
                    <p className="text-xs text-zinc-500">
                      Expires{" "}
                      {new Intl.DateTimeFormat(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(expiresAtMs))}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void copyLink()}
                    className="self-start text-sm font-medium text-zinc-700 underline dark:text-zinc-300"
                  >
                    {copied ? "Copied" : "Copy link"}
                  </button>
                </div>
              ) : null}
            </>
          )}
          {error ? (
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Members
        </h2>
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {members.members.map((m) => (
            <li
              key={m.participantId}
              className="flex flex-col gap-0.5 py-3 sm:flex-row sm:items-baseline sm:justify-between"
            >
              <div>
                <p className="font-medium text-zinc-900 dark:text-zinc-50">
                  {m.displayName}
                </p>
                <p className="text-xs uppercase tracking-wide text-zinc-500">
                  {m.role}
                </p>
              </div>
              {"email" in m || "phone" in m ? (
                <div className="text-sm text-zinc-600 dark:text-zinc-400">
                  {m.email ? <p>{m.email}</p> : null}
                  {m.phone ? <p>{m.phone}</p> : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
