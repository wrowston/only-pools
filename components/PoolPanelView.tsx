"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { convexErrorMessage } from "@/lib/convexErrorMessage";
import { EmptyState } from "./EmptyState";
import { usePoolChromeName } from "./PoolChrome";

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
      setError(convexErrorMessage(e, "Action failed"));
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

  usePoolChromeName(members?.poolName);

  if (isLoading || (isAuthenticated && members === undefined)) {
    return (
      <EmptyState title="Loading Pool" description="Loading members…" />
    );
  }

  if (!isAuthenticated) {
    return (
      <EmptyState
        title="Sign in to open this Pool"
        action={
          <Link
            href="/sign-in"
            className="op-btn op-btn-primary"
          >
            Sign in
          </Link>
        }
      />
    );
  }

  if (!members) {
    return (
      <EmptyState
        title="Pool not available"
        description="Members could not be loaded. You may not have access to this Pool."
        action={
          <Link
            href="/my-pools"
            className="op-btn op-btn-secondary"
          >
            Back to My Pools
          </Link>
        }
      />
    );
  }

  const isOwner = members.callerRole === "owner";
  const isAdmin =
    members.callerRole === "owner" || members.callerRole === "admin";

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 py-8 min-[900px]:px-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-medium tracking-tight text-op-text">
          Pool
        </h1>
        <p className="text-sm text-op-secondary">
          Members, roles, and Pool Invite
          {members.archived ? " · Archived" : ""}
        </p>
      </div>

      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      {isOwner ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-op-text">
            Archive
          </h2>
          <p className="text-sm text-op-secondary">
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
                className="op-btn op-btn-secondary"
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
                className="op-btn op-btn-primary"
              >
                Restore Pool
              </button>
            )}
          </div>
        </section>
      ) : null}

      {members.canManageInvites && !members.archived ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-op-text">
            Pool Invite
          </h2>
          {members.admissionClosed ? (
            <p className="text-sm text-op-secondary">
              Membership admission is closed for this Pool.
            </p>
          ) : (
            <>
              <p className="text-sm text-op-secondary">
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
                  className="op-btn op-btn-primary"
                >
                  {busy ? "Working…" : "Create / retrieve invite"}
                </button>
                <button
                  type="button"
                  disabled={busy || !inviteStatus?.hasActiveInvite}
                  onClick={() => void withStepUpRotate()}
                  className="op-btn op-btn-secondary h-9"
                >
                  Rotate invite
                </button>
              </div>
              {inviteUrl ? (
                <div className="flex flex-col gap-2 rounded-[10px] border border-op-border bg-op-surface p-3">
                  <code className="break-all text-xs text-op-text">
                    {inviteUrl}
                  </code>
                  {expiresAtMs ? (
                    <p className="text-xs text-op-muted">
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
                    className="self-start text-sm font-medium text-op-text underline"
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
        <section className="flex flex-col gap-2 rounded-[10px] border border-op-border bg-op-surface p-3">
          <h2 className="text-sm font-semibold text-op-text">
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
              className="op-btn op-btn-primary self-start"
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
              className="self-start text-sm font-medium text-op-text underline"
            >
              Cancel offer
            </button>
          ) : null}
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-op-text">
          Members
        </h2>
        <ul className="divide-y divide-op-border">
          {members.members.map((m) => (
            <li
              key={m.participantId}
              className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between"
            >
              <div>
                <p className="font-medium text-op-text">
                  {m.displayName}
                </p>
                <p className="text-xs uppercase tracking-wide text-op-muted">
                  {m.role}
                  {m.status !== "active" ? ` · ${m.status}` : ""}
                </p>
                {"email" in m || "phone" in m ? (
                  <div className="mt-1 text-sm text-op-secondary">
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
                      className="text-xs font-medium text-op-text underline"
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
                      className="text-xs font-medium text-op-text underline"
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
                      className="text-xs font-medium text-red-700 underline"
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
                      className="text-xs font-medium text-red-700 underline"
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
                  className="text-xs font-medium text-op-text underline"
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
                  className="text-xs font-medium text-op-text underline"
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
            className="self-start text-sm font-medium text-op-text underline disabled:opacity-50"
          >
            Leave Pool
          </button>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-op-text">
          Abuse Report
        </h2>
        <p className="text-sm text-op-secondary">
          Private report to support. Creates no automatic penalty. Do not include
          Hidden Pick values or invite links.
        </p>
        {abuseSent ? (
          <p className="text-sm text-op-text">
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
              className="op-input"
            />
            <textarea
              maxLength={2000}
              value={abuseDescription}
              onChange={(e) => setAbuseDescription(e.target.value)}
              placeholder="Optional description"
              rows={3}
              className="op-input"
            />
            <button
              type="submit"
              disabled={busy || abuseReason.trim().length < 3}
              className="op-btn op-btn-primary self-start"
            >
              Submit report
            </button>
          </form>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-op-text">
          Pool Audit
        </h2>
        <p className="text-sm text-op-secondary">
          Sanitized role, membership, invite, and archive events.
        </p>
        {audit === undefined ? (
          <p className="text-sm text-op-muted">Loading audit…</p>
        ) : audit.events.length === 0 ? (
          <EmptyState
            title="No audit events yet"
            description="Role changes, invites, archive, and restore actions will show up here."
          />
        ) : (
          <ul className="divide-y divide-op-border text-sm">
            {audit.events.map((e, i) => (
              <li key={`${e.action}-${e.atMs}-${i}`} className="py-2">
                <p className="font-medium text-op-text">
                  {e.action}
                </p>
                <p className="text-xs text-op-muted">
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
  );
}
