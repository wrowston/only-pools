"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { PoolShell } from "./PoolShell";

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
    isAuthenticated && members?.canManageInvites && !members.archived
      ? { poolId }
      : "skip",
  );
  const ownership = useQuery(
    api.membershipAdmin.getOwnershipTransferStatus,
    isAuthenticated ? { poolId } : "skip",
  );
  const audit = useQuery(
    api.membershipAdmin.listPoolAuditEvents,
    isAuthenticated ? { poolId, limit: 20 } : "skip",
  );
  const confirmStepUp = useMutation(api.invites.confirmStepUp);
  const createOrRetrieve = useMutation(api.invites.createOrRetrieveInvite);
  const rotateInvite = useMutation(api.invites.rotateInvite);
  const promoteAdmin = useMutation(api.membershipAdmin.promoteAdmin);
  const demoteAdmin = useMutation(api.membershipAdmin.demoteAdmin);
  const removeMember = useMutation(api.membershipAdmin.removeMember);
  const reinstateMember = useMutation(api.membershipAdmin.reinstateMember);
  const offerOwnership = useMutation(api.membershipAdmin.offerOwnershipTransfer);
  const acceptOwnership = useMutation(
    api.membershipAdmin.acceptOwnershipTransfer,
  );
  const cancelOwnership = useMutation(
    api.membershipAdmin.cancelOwnershipTransfer,
  );
  const archivePool = useMutation(api.membershipAdmin.archivePool);
  const restorePool = useMutation(api.membershipAdmin.restorePool);
  const leavePool = useMutation(api.membershipAdmin.leavePool);
  const createAbuseReport = useMutation(api.membershipAdmin.createAbuseReport);

  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [expiresAtMs, setExpiresAtMs] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [abuseReason, setAbuseReason] = useState("");
  const [abuseDescription, setAbuseDescription] = useState("");
  const [abuseSent, setAbuseSent] = useState(false);

  async function runAdminAction(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function withStepUpRetrieve() {
    await runAdminAction(async () => {
      setCopied(false);
      await confirmStepUp({});
      const result = await createOrRetrieve({ poolId });
      setInviteUrl(absoluteInviteUrl(result.url));
      setExpiresAtMs(result.expiresAtMs);
    });
  }

  async function withStepUpRotate() {
    await runAdminAction(async () => {
      setCopied(false);
      await confirmStepUp({});
      const result = await rotateInvite({ poolId });
      setInviteUrl(absoluteInviteUrl(result.url));
      setExpiresAtMs(result.expiresAtMs);
    });
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

  const isOwner = members.callerRole === "owner";
  const isAdmin =
    members.callerRole === "owner" || members.callerRole === "admin";

  return (
    <PoolShell poolId={poolId} poolName={members.poolName}>
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 py-8 min-[900px]:px-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-op-text">
          Pool
        </h1>
        <p className="text-sm text-op-secondary">
          Members, roles, and Pool Invite
          {members.archived ? " · Archived" : ""}
        </p>
      </div>

      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}

      {isOwner ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            Archive
          </h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Archive is a reversible read-only overlay. Locks, sync, and scoring
            continue.
          </p>
          <div className="flex flex-wrap gap-2">
            {!members.archived ? (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void runAdminAction(async () => {
                    await confirmStepUp({});
                    await archivePool({ poolId });
                  })
                }
                className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-800 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200"
              >
                Archive Pool
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void runAdminAction(async () => {
                    await confirmStepUp({});
                    await restorePool({ poolId });
                  })
                }
                className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
              >
                Restore Pool
              </button>
            )}
          </div>
        </section>
      ) : null}

      {members.canManageInvites && !members.archived ? (
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
        </section>
      ) : null}

      {ownership?.pending ? (
        <section className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Ownership transfer pending
          </h2>
          {ownership.pending.canAccept ? (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void runAdminAction(async () => {
                  await acceptOwnership({
                    offerId: ownership.pending!.offerId,
                  });
                })
              }
              className="self-start rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
            >
              Accept ownership
            </button>
          ) : null}
          {ownership.pending.canCancel ? (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void runAdminAction(async () => {
                  await cancelOwnership({
                    offerId: ownership.pending!.offerId,
                  });
                })
              }
              className="self-start text-sm font-medium text-zinc-700 underline dark:text-zinc-300"
            >
              Cancel offer
            </button>
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
              className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between"
            >
              <div>
                <p className="font-medium text-zinc-900 dark:text-zinc-50">
                  {m.displayName}
                </p>
                <p className="text-xs uppercase tracking-wide text-zinc-500">
                  {m.role}
                  {m.status !== "active" ? ` · ${m.status}` : ""}
                </p>
                {"email" in m || "phone" in m ? (
                  <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                    {m.email ? <p>{m.email}</p> : null}
                    {m.phone ? <p>{m.phone}</p> : null}
                  </div>
                ) : null}
              </div>
              {!members.archived && m.status === "active" ? (
                <div className="flex flex-wrap gap-2">
                  {isOwner && m.role === "member" ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void runAdminAction(async () => {
                          await confirmStepUp({});
                          await promoteAdmin({
                            poolId,
                            participantId: m.participantId,
                          });
                        })
                      }
                      className="text-xs font-medium text-zinc-700 underline dark:text-zinc-300"
                    >
                      Promote Admin
                    </button>
                  ) : null}
                  {isOwner && m.role === "admin" ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void runAdminAction(async () => {
                          await confirmStepUp({});
                          await demoteAdmin({
                            poolId,
                            participantId: m.participantId,
                          });
                        })
                      }
                      className="text-xs font-medium text-zinc-700 underline dark:text-zinc-300"
                    >
                      Demote
                    </button>
                  ) : null}
                  {isAdmin && m.role === "member" ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void runAdminAction(async () => {
                          const reason = window.prompt(
                            "Short reason for removal",
                          );
                          if (!reason) return;
                          await removeMember({
                            poolId,
                            participantId: m.participantId,
                            reason,
                          });
                        })
                      }
                      className="text-xs font-medium text-red-700 underline dark:text-red-400"
                    >
                      Remove
                    </button>
                  ) : null}
                  {isOwner && m.role === "admin" ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void runAdminAction(async () => {
                          const reason = window.prompt(
                            "Short reason for removal",
                          );
                          if (!reason) return;
                          await removeMember({
                            poolId,
                            participantId: m.participantId,
                            reason,
                          });
                        })
                      }
                      className="text-xs font-medium text-red-700 underline dark:text-red-400"
                    >
                      Remove Admin
                    </button>
                  ) : null}
                </div>
              ) : null}
              {isOwner && m.status === "active" && m.role === "admin" ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void runAdminAction(async () => {
                      await confirmStepUp({});
                      await offerOwnership({
                        poolId,
                        toParticipantId: m.participantId,
                      });
                    })
                  }
                  className="text-xs font-medium text-zinc-700 underline dark:text-zinc-300"
                >
                  Offer ownership
                </button>
              ) : null}
              {!members.archived &&
              isOwner &&
              m.status === "removed" ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void runAdminAction(async () => {
                      const reason = window.prompt(
                        "Short reason for reinstatement",
                      );
                      if (!reason) return;
                      await reinstateMember({
                        poolId,
                        participantId: m.participantId,
                        reason,
                      });
                    })
                  }
                  className="text-xs font-medium text-zinc-700 underline dark:text-zinc-300"
                >
                  Reinstate as Member
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        {!isOwner ? (
          <button
            type="button"
            disabled={busy || members.archived}
            onClick={() =>
              void runAdminAction(async () => {
                if (!window.confirm("Leave this Pool?")) return;
                await leavePool({ poolId });
              })
            }
            className="self-start text-sm font-medium text-zinc-700 underline dark:text-zinc-300 disabled:opacity-50"
          >
            Leave Pool
          </button>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Abuse Report
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Private report to support. Creates no automatic penalty. Do not include
          Hidden Pick values or invite links.
        </p>
        {abuseSent ? (
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            Report submitted.
          </p>
        ) : (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void runAdminAction(async () => {
                await createAbuseReport({
                  poolId,
                  reason: abuseReason,
                  description: abuseDescription || undefined,
                });
                setAbuseSent(true);
                setAbuseReason("");
                setAbuseDescription("");
              });
            }}
          >
            <input
              type="text"
              required
              minLength={3}
              maxLength={280}
              value={abuseReason}
              onChange={(e) => setAbuseReason(e.target.value)}
              placeholder="Reason"
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
            <textarea
              maxLength={2000}
              value={abuseDescription}
              onChange={(e) => setAbuseDescription(e.target.value)}
              placeholder="Optional description"
              rows={3}
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
            <button
              type="submit"
              disabled={busy || abuseReason.trim().length < 3}
              className="self-start rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-800 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200"
            >
              Submit report
            </button>
          </form>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Pool Audit
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Sanitized role, membership, invite, and archive events.
        </p>
        {audit === undefined ? (
          <p className="text-sm text-zinc-500">Loading audit…</p>
        ) : audit.events.length === 0 ? (
          <p className="text-sm text-zinc-500">No events yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            {audit.events.map((e, i) => (
              <li key={`${e.action}-${e.atMs}-${i}`} className="py-2">
                <p className="font-medium text-zinc-900 dark:text-zinc-50">
                  {e.action}
                </p>
                <p className="text-xs text-zinc-500">
                  {new Intl.DateTimeFormat(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(e.atMs))}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
    </PoolShell>
  );
}
