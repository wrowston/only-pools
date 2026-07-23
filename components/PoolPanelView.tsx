"use client";

import posthog from "posthog-js";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { convexErrorMessage } from "@/lib/convexErrorMessage";
import { formatPoolAuditEvent } from "@/lib/poolAuditDisplay";
import { EmptyState } from "./EmptyState";
import {
  PoolAuditSkeleton,
  PoolPanelSkeleton,
} from "./PoolPanelSkeleton";
import { usePoolChromeName } from "./PoolChrome";

function absoluteInviteUrl(path: string): string {
  if (typeof window === "undefined") return path;
  return `${window.location.origin}${path}`;
}

const textareaClassName =
  "flex min-h-20 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30";

function PoolPanelSection({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section
      className="flex flex-col gap-3 rounded-xl border border-op-border bg-op-surface p-4"
      aria-labelledby={id}
    >
      <div className="flex flex-col gap-1">
        <h2 id={id} className="text-base font-medium text-op-text">
          {title}
        </h2>
        {description ? (
          <p className="text-sm text-op-secondary">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

type ConfirmState =
  | { kind: "leave" }
  | { kind: "archive" }
  | { kind: "restore" }
  | {
      kind: "remove";
      participantId: Id<"participants">;
      removedRole: "member" | "admin";
      displayName: string;
    }
  | {
      kind: "reinstate";
      participantId: Id<"participants">;
      displayName: string;
    };

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
  const updateMaxEntriesPerUser = useMutation(
    api.pools.updateMaxEntriesPerUser,
  );
  const [entriesNowMs] = useState(() => Date.now());
  const myEntries = useQuery(
    api.pools.listMyPoolEntries,
    isAuthenticated ? { poolId, nowMs: entriesNowMs } : "skip",
  );

  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [expiresAtMs, setExpiresAtMs] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [abuseReason, setAbuseReason] = useState("");
  const [abuseDescription, setAbuseDescription] = useState("");
  const [abuseSent, setAbuseSent] = useState(false);
  const [maxEntriesDraft, setMaxEntriesDraft] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reasonDraft, setReasonDraft] = useState("");

  function openConfirm(next: ConfirmState) {
    setReasonDraft("");
    setConfirm(next);
    setConfirmOpen(true);
  }

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
      posthog.capture("pool_invite_retrieved", { pool_id: poolId });
    });
  }

  async function withStepUpRotate() {
    await runAdminAction(async () => {
      setCopied(false);
      await confirmStepUp({});
      const result = await rotateInvite({ poolId });
      setInviteUrl(absoluteInviteUrl(result.url));
      setExpiresAtMs(result.expiresAtMs);
      posthog.capture("pool_invite_rotated", { pool_id: poolId });
    });
  }

  async function copyLink() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      posthog.capture("pool_invite_link_copied", { pool_id: poolId });
    } catch {
      setError("Could not copy link");
    }
  }

  async function confirmAction() {
    if (!confirm) return;
    const current = confirm;
    const reason = reasonDraft.trim();
    if (
      (current.kind === "remove" || current.kind === "reinstate") &&
      !reason
    ) {
      return;
    }
    setConfirmOpen(false);

    if (current.kind === "leave") {
      await runAdminAction(async () => {
        await leavePool({ poolId });
        posthog.capture("pool_left", { pool_id: poolId });
      });
      return;
    }

    if (current.kind === "archive") {
      await runAdminAction(async () => {
        await confirmStepUp({});
        await archivePool({ poolId });
        posthog.capture("pool_archived", { pool_id: poolId });
      });
      return;
    }

    if (current.kind === "restore") {
      await runAdminAction(async () => {
        await confirmStepUp({});
        await restorePool({ poolId });
        posthog.capture("pool_restored", { pool_id: poolId });
      });
      return;
    }

    if (current.kind === "remove") {
      await runAdminAction(async () => {
        await removeMember({
          poolId,
          participantId: current.participantId,
          reason,
        });
        posthog.capture("member_removed", {
          pool_id: poolId,
          removed_role: current.removedRole,
        });
      });
      return;
    }

    if (current.kind === "reinstate") {
      await runAdminAction(async () => {
        await reinstateMember({
          poolId,
          participantId: current.participantId,
          reason,
        });
      });
    }
  }

  usePoolChromeName(members?.poolName);

  if (isLoading || (isAuthenticated && members === undefined)) {
    return <PoolPanelSkeleton />;
  }

  if (!isAuthenticated) {
    return (
      <EmptyState
        title="Sign in to open this Pool"
        action={
          <Button render={<Link href="/sign-in" />}>Sign in</Button>
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
          <Button variant="secondary" render={<Link href="/my-pools" />}>
            Back to My Pools
          </Button>
        }
      />
    );
  }

  const isOwner = members.callerRole === "owner";
  const isAdmin =
    members.callerRole === "owner" || members.callerRole === "admin";
  const needsReason =
    confirm?.kind === "remove" || confirm?.kind === "reinstate";

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 py-8 min-[900px]:px-8">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-medium tracking-tight text-op-text">
            Pool
          </h1>
          <Link
            href="/guides/members-roles-and-ownership"
            className="text-xs font-medium text-op-selected-fg underline underline-offset-4"
          >
            Management guide
          </Link>
        </div>
        <p className="text-sm text-op-secondary">
          Members, roles, and Pool Invite
          {members.archived ? " · Archived" : ""}
        </p>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-4">
        {isOwner && myEntries && !myEntries.admissionClosed && !members.archived ? (
          <PoolPanelSection
            id="pool-max-entries"
            title="Max entries per person"
            description="Editable while admission is open. Cannot go below what anyone already holds."
          >
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={maxEntriesDraft ?? myEntries.maxEntriesPerUser}
                onValueChange={(value) => {
                  if (typeof value === "number") {
                    setMaxEntriesDraft(value);
                  }
                }}
              >
                <SelectTrigger aria-label="Max entries per person">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                    <SelectItem key={n} value={n}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="secondary"
                disabled={
                  busy ||
                  (maxEntriesDraft ?? myEntries.maxEntriesPerUser) ===
                    myEntries.maxEntriesPerUser
                }
                onClick={() =>
                  void runAdminAction(async () => {
                    const next =
                      maxEntriesDraft ?? myEntries.maxEntriesPerUser;
                    await updateMaxEntriesPerUser({
                      poolId,
                      maxEntriesPerUser: next,
                    });
                    setMaxEntriesDraft(null);
                  })
                }
              >
                Save
              </Button>
            </div>
          </PoolPanelSection>
        ) : null}

        {members.canManageInvites && !members.archived ? (
          <PoolPanelSection
            id="pool-invite"
            title="Pool Invite"
            description="Retrieve or rotate the reusable invite after Step-up Verification."
          >
            {members.admissionClosed ? (
              <Alert>
                <AlertTitle>Admission closed</AlertTitle>
                <AlertDescription>
                  Membership admission is closed for this Pool.
                </AlertDescription>
              </Alert>
            ) : (
              <>
                <Alert>
                  <AlertTitle>Invite status</AlertTitle>
                  <AlertDescription>
                    {inviteStatus?.hasActiveInvite
                      ? "An active invite already exists."
                      : "No active invite yet."}
                  </AlertDescription>
                </Alert>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    disabled={busy}
                    onClick={() => void withStepUpRetrieve()}
                  >
                    {busy ? "Working…" : "Create / retrieve invite"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy || !inviteStatus?.hasActiveInvite}
                    onClick={() => void withStepUpRotate()}
                  >
                    Rotate invite
                  </Button>
                </div>
                {inviteUrl ? (
                  <div className="flex flex-col gap-2 rounded-[10px] border border-op-border bg-op-canvas p-3">
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
                    <Button
                      type="button"
                      variant="link"
                      className="h-auto self-start px-0"
                      onClick={() => void copyLink()}
                    >
                      {copied ? "Copied" : "Copy link"}
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </PoolPanelSection>
        ) : null}

        {ownership?.pending ? (
          <PoolPanelSection
            id="pool-ownership"
            title="Ownership transfer pending"
          >
            <Alert>
              <AlertTitle>Ownership transfer pending</AlertTitle>
              <AlertDescription>
                {ownership.pending.canAccept
                  ? "Offered to you."
                  : `Offered to ${ownership.pending.toDisplayName}.`}
              </AlertDescription>
            </Alert>
            {ownership.pending.canAccept ? (
              <Button
                type="button"
                disabled={busy}
                className="self-start"
                onClick={() =>
                  void runAdminAction(async () => {
                    await acceptOwnership({
                      offerId: ownership.pending!.offerId,
                    });
                  })
                }
              >
                Accept ownership
              </Button>
            ) : null}
            {ownership.pending.canCancel ? (
              <Button
                type="button"
                variant="link"
                disabled={busy}
                className="h-auto self-start px-0"
                onClick={() =>
                  void runAdminAction(async () => {
                    await cancelOwnership({
                      offerId: ownership.pending!.offerId,
                    });
                  })
                }
              >
                Cancel offer
              </Button>
            ) : null}
          </PoolPanelSection>
        ) : null}

        <PoolPanelSection id="pool-members" title="Members">
          <ul className="divide-y divide-op-border">
            {members.members.map((m) => {
              const canPromote =
                !members.archived &&
                m.status === "active" &&
                isOwner &&
                m.role === "member";
              const canDemote =
                !members.archived &&
                m.status === "active" &&
                isOwner &&
                m.role === "admin";
              const canRemoveMember =
                !members.archived &&
                m.status === "active" &&
                isAdmin &&
                m.role === "member";
              const canRemoveAdmin =
                !members.archived &&
                m.status === "active" &&
                isOwner &&
                m.role === "admin";
              const canOfferOwnership =
                isOwner && m.status === "active" && m.role === "admin";
              const canReinstate =
                !members.archived && isOwner && m.status === "removed";
              const hasActions =
                canPromote ||
                canDemote ||
                canRemoveMember ||
                canRemoveAdmin ||
                canOfferOwnership ||
                canReinstate;

              return (
                <li
                  key={m.participantId}
                  className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div>
                    <p className="font-medium text-op-text">{m.displayName}</p>
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
                  {hasActions ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={busy}
                          />
                        }
                      >
                        Actions
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-44">
                        {canPromote ? (
                          <DropdownMenuItem
                            onClick={() =>
                              void runAdminAction(async () => {
                                await confirmStepUp({});
                                await promoteAdmin({
                                  poolId,
                                  participantId: m.participantId,
                                });
                              })
                            }
                          >
                            Promote Admin
                          </DropdownMenuItem>
                        ) : null}
                        {canDemote ? (
                          <DropdownMenuItem
                            onClick={() =>
                              void runAdminAction(async () => {
                                await confirmStepUp({});
                                await demoteAdmin({
                                  poolId,
                                  participantId: m.participantId,
                                });
                              })
                            }
                          >
                            Demote
                          </DropdownMenuItem>
                        ) : null}
                        {canRemoveMember ? (
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() =>
                              openConfirm({
                                kind: "remove",
                                participantId: m.participantId,
                                removedRole: "member",
                                displayName: m.displayName,
                              })
                            }
                          >
                            Remove
                          </DropdownMenuItem>
                        ) : null}
                        {canRemoveAdmin ? (
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() =>
                              openConfirm({
                                kind: "remove",
                                participantId: m.participantId,
                                removedRole: "admin",
                                displayName: m.displayName,
                              })
                            }
                          >
                            Remove Admin
                          </DropdownMenuItem>
                        ) : null}
                        {canOfferOwnership ? (
                          <DropdownMenuItem
                            onClick={() =>
                              void runAdminAction(async () => {
                                await confirmStepUp({});
                                await offerOwnership({
                                  poolId,
                                  toParticipantId: m.participantId,
                                });
                              })
                            }
                          >
                            Offer ownership
                          </DropdownMenuItem>
                        ) : null}
                        {canReinstate ? (
                          <DropdownMenuItem
                            onClick={() =>
                              openConfirm({
                                kind: "reinstate",
                                participantId: m.participantId,
                                displayName: m.displayName,
                              })
                            }
                          >
                            Reinstate as Member
                          </DropdownMenuItem>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {!isOwner ? (
            <Button
              type="button"
              variant="link"
              disabled={busy || members.archived}
              className="h-auto self-start px-0"
              onClick={() => openConfirm({ kind: "leave" })}
            >
              Leave Pool
            </Button>
          ) : null}
        </PoolPanelSection>

        <PoolPanelSection
          id="pool-abuse-report"
          title="Abuse Report"
          description="Private report to support. Creates no automatic penalty. Do not include Hidden Pick values or invite links."
        >
          {abuseSent ? (
            <p className="text-sm text-op-text">Report submitted.</p>
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
              <Input
                type="text"
                required
                minLength={3}
                maxLength={280}
                value={abuseReason}
                onChange={(e) => setAbuseReason(e.target.value)}
                placeholder="Reason"
              />
              <textarea
                maxLength={2000}
                value={abuseDescription}
                onChange={(e) => setAbuseDescription(e.target.value)}
                placeholder="Optional description"
                rows={3}
                className={textareaClassName}
              />
              <Button
                type="submit"
                disabled={busy || abuseReason.trim().length < 3}
                className="self-start"
              >
                Submit report
              </Button>
            </form>
          )}
        </PoolPanelSection>

        <PoolPanelSection
          id="pool-audit"
          title="Pool Audit"
          description="Sanitized role, membership, invite, and archive events."
        >
          {audit === undefined ? (
            <PoolAuditSkeleton />
          ) : audit.events.length === 0 ? (
            <EmptyState
              title="No audit events yet"
              description="Role changes, invites, archive, and restore actions will show up here."
            />
          ) : (
            <ul className="divide-y divide-op-border text-sm">
              {audit.events.map((e, i) => {
                const { title, details } = formatPoolAuditEvent(e);
                return (
                  <li key={`${e.action}-${e.atMs}-${i}`} className="py-2 first:pt-0 last:pb-0">
                    <p className="font-medium text-op-text">{title}</p>
                    {details.map((line, detailIndex) => (
                      <p
                        key={`${e.action}-detail-${detailIndex}`}
                        className="text-sm text-op-secondary"
                      >
                        {line}
                      </p>
                    ))}
                    <p className="mt-0.5 text-xs text-op-muted">
                      {new Intl.DateTimeFormat(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(e.atMs))}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </PoolPanelSection>
      </div>

      {isOwner ? (
        <section
          className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50/70 p-4"
          aria-labelledby="pool-danger-zone"
        >
          <h2
            id="pool-danger-zone"
            className="text-lg font-semibold text-red-800"
          >
            Danger Zone
          </h2>
          {!members.archived ? (
            <>
              <p className="text-sm text-red-900/80">
                Archiving hides this Pool from normal My Pools lists and locks
                ordinary membership, invite, and role changes. Locks, sync, and
                scoring still continue. You can restore later, but Members will
                lose day-to-day access until you do.
              </p>
              <Button
                type="button"
                variant="destructive"
                disabled={busy}
                className="self-start"
                onClick={() => openConfirm({ kind: "archive" })}
              >
                Archive Pool
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm text-red-900/80">
                This Pool is archived. Restoring returns normal access and
                eligible administrative actions.
              </p>
              <Button
                type="button"
                variant="destructive"
                disabled={busy}
                className="self-start"
                onClick={() => openConfirm({ kind: "restore" })}
              >
                Restore Pool
              </Button>
            </>
          )}
        </section>
      ) : null}

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          setConfirmOpen(open);
          if (!open) setConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === "leave"
                ? "Leave this Pool?"
                : confirm?.kind === "archive"
                  ? "Archive this Pool?"
                  : confirm?.kind === "restore"
                    ? "Restore this Pool?"
                    : confirm?.kind === "remove"
                      ? confirm.removedRole === "admin"
                        ? `Remove admin ${confirm.displayName}?`
                        : `Remove ${confirm.displayName}?`
                      : confirm?.kind === "reinstate"
                        ? `Reinstate ${confirm.displayName}?`
                        : "Confirm"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === "leave"
                ? "You will lose access to this Pool until invited again."
                : confirm?.kind === "archive"
                  ? "This hides the Pool from normal My Pools lists and locks ordinary membership, invite, and role changes until you restore it. Locks, sync, and scoring continue."
                  : confirm?.kind === "restore"
                    ? "The Pool will leave the archived overlay and become editable again."
                    : confirm?.kind === "remove"
                      ? "Provide a short reason for removal. This is recorded in the Pool audit."
                      : confirm?.kind === "reinstate"
                        ? "Provide a short reason for reinstatement. They will return as a Member."
                        : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {needsReason ? (
            <Input
              type="text"
              value={reasonDraft}
              onChange={(e) => setReasonDraft(e.target.value)}
              placeholder={
                confirm?.kind === "reinstate"
                  ? "Short reason for reinstatement"
                  : "Short reason for removal"
              }
              autoFocus
            />
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant={
                confirm?.kind === "remove" ||
                confirm?.kind === "leave" ||
                confirm?.kind === "archive"
                  ? "destructive"
                  : "default"
              }
              disabled={busy || (needsReason && reasonDraft.trim().length === 0)}
              onClick={() => void confirmAction()}
            >
              {confirm?.kind === "leave"
                ? "Leave Pool"
                : confirm?.kind === "archive"
                  ? "Archive Pool"
                  : confirm?.kind === "restore"
                    ? "Restore Pool"
                    : confirm?.kind === "remove"
                      ? confirm.removedRole === "admin"
                        ? "Remove Admin"
                        : "Remove"
                      : confirm?.kind === "reinstate"
                        ? "Reinstate"
                        : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
